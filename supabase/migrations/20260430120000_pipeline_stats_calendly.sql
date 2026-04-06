-- Calendly fields on leads + extended pipeline stats (by country, email reply metrics)
-- + service_role RPC for Calendly webhook (stage move + sequences cancel)

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS calendly_booked_at timestamptz,
  ADD COLUMN IF NOT EXISTS calendly_event_uri text,
  ADD COLUMN IF NOT EXISTS calendly_status text;

COMMENT ON COLUMN public.leads.calendly_status IS 'booked | canceled (from Calendly webhook)';

CREATE OR REPLACE FUNCTION public.pipeline_calendly_apply_system(
  p_organization_id uuid,
  p_lead_id uuid,
  p_event_uri text,
  p_booked_at timestamptz,
  p_status text,
  p_new_stage_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_stage uuid;
  v_stage_org uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT l.stage_id INTO v_old_stage
  FROM public.leads l
  WHERE l.id = p_lead_id AND l.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  IF p_status = 'booked' THEN
    IF p_new_stage_id IS NOT NULL THEN
      SELECT organization_id INTO v_stage_org
      FROM public.pipeline_stages
      WHERE id = p_new_stage_id;

      IF v_stage_org IS NULL OR v_stage_org <> p_organization_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_stage');
      END IF;
    END IF;

    UPDATE public.leads
    SET
      calendly_booked_at = COALESCE(p_booked_at, now()),
      calendly_event_uri = COALESCE(p_event_uri, calendly_event_uri),
      calendly_status = 'booked',
      stage_id = COALESCE(p_new_stage_id, stage_id),
      updated_at = now()
    WHERE id = p_lead_id;

    IF p_new_stage_id IS NOT NULL AND p_new_stage_id IS DISTINCT FROM v_old_stage THEN
      PERFORM public.cancel_sequence_emails_system(p_organization_id, p_lead_id, NULL);
      INSERT INTO public.lead_activities (lead_id, user_id, type, metadata)
      VALUES (
        p_lead_id,
        NULL,
        'stage_change',
        jsonb_build_object('from_stage_id', v_old_stage, 'to_stage_id', p_new_stage_id, 'source', 'calendly')
      );
    END IF;

    INSERT INTO public.lead_activities (lead_id, user_id, type, metadata)
    VALUES (
      p_lead_id,
      NULL,
      'calendly_booked',
      jsonb_build_object(
        'event_uri', p_event_uri,
        'booked_at', p_booked_at
      )
    );

    RETURN jsonb_build_object('ok', true, 'lead_id', p_lead_id, 'status', 'booked');
  END IF;

  IF p_status = 'canceled' THEN
    UPDATE public.leads
    SET
      calendly_status = 'canceled',
      updated_at = now()
    WHERE id = p_lead_id;

    INSERT INTO public.lead_activities (lead_id, user_id, type, metadata)
    VALUES (
      p_lead_id,
      NULL,
      'calendly_canceled',
      jsonb_build_object('event_uri', p_event_uri)
    );

    RETURN jsonb_build_object('ok', true, 'lead_id', p_lead_id, 'status', 'canceled');
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
END;
$$;

REVOKE ALL ON FUNCTION public.pipeline_calendly_apply_system(uuid, uuid, text, timestamptz, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pipeline_calendly_apply_system(uuid, uuid, text, timestamptz, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_pipeline_stats(
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  df timestamptz;
  dt timestamptz;
BEGIN
  v_org := public.user_pipeline_org_id();
  IF v_org IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  df := COALESCE(p_date_from, now() - interval '30 days');
  dt := COALESCE(p_date_to, now());

  RETURN (
    WITH bounds AS (
      SELECT df AS d0, dt AS d1
    ),
    lead_counts AS (
      SELECT
        COUNT(*) FILTER (WHERE l.created_at >= (SELECT d0 FROM bounds) AND l.created_at <= (SELECT d1 FROM bounds)) AS new_leads,
        COUNT(*) FILTER (WHERE l.is_active) AS active_leads
      FROM public.leads l
      WHERE l.organization_id = v_org
    ),
    by_stage AS (
      SELECT COALESCE(
        (SELECT jsonb_object_agg(sub.slug, sub.cnt)
         FROM (
           SELECT ps.slug, COUNT(l.id)::bigint AS cnt
           FROM public.pipeline_stages ps
           LEFT JOIN public.leads l ON l.stage_id = ps.id AND l.organization_id = v_org AND l.is_active
           WHERE ps.organization_id = v_org
           GROUP BY ps.slug
         ) sub),
        '{}'::jsonb
      ) AS stages
    ),
    email_rates AS (
      SELECT
        COUNT(*) FILTER (WHERE el.status IN ('opened', 'clicked'))::float
          / NULLIF(COUNT(*) FILTER (WHERE el.status IN ('sent', 'delivered', 'opened', 'clicked')), 0) AS open_rate
      FROM public.email_log el
      WHERE el.organization_id = v_org
        AND el.created_at >= (SELECT d0 FROM bounds)
        AND el.created_at <= (SELECT d1 FROM bounds)
    ),
    by_country AS (
      SELECT COALESCE(
        (SELECT jsonb_object_agg(sub.country_key, sub.cnt)
         FROM (
           SELECT
             COALESCE(
               NULLIF(trim(l.country_name), ''),
               NULLIF(trim(l.country_origin), ''),
               NULLIF(trim(l.country_code), ''),
               'Sin país'
             ) AS country_key,
             COUNT(*)::bigint AS cnt
           FROM public.leads l
           WHERE l.organization_id = v_org
             AND l.is_active
           GROUP BY 1
           ORDER BY 1
         ) sub),
        '{}'::jsonb
      ) AS countries
    ),
    first_outbound AS (
      SELECT DISTINCT ON (el.lead_id)
        el.lead_id,
        el.sent_at AS first_sent,
        el.conversation_id AS conv_id
      FROM public.email_log el
      INNER JOIN public.leads l ON l.id = el.lead_id AND l.organization_id = v_org
      WHERE el.direction = 'outbound'
        AND el.sent_at IS NOT NULL
        AND el.sent_at >= (SELECT d0 FROM bounds)
        AND el.sent_at <= (SELECT d1 FROM bounds)
      ORDER BY el.lead_id, el.sent_at ASC
    ),
    first_reply AS (
      SELECT
        fo.lead_id,
        fo.first_sent,
        (
          SELECT MIN(el2.received_at)
          FROM public.email_log el2
          WHERE el2.lead_id = fo.lead_id
            AND el2.organization_id = v_org
            AND el2.direction = 'inbound'
            AND el2.received_at IS NOT NULL
            AND el2.received_at > fo.first_sent
            AND (
              fo.conv_id IS NULL
              OR el2.conversation_id IS NOT DISTINCT FROM fo.conv_id
            )
        ) AS first_reply_at
      FROM first_outbound fo
    ),
    reply_stats AS (
      SELECT
        COUNT(*)::bigint AS contacted,
        COUNT(*) FILTER (WHERE fr.first_reply_at IS NOT NULL)::bigint AS replied,
        AVG(
          EXTRACT(EPOCH FROM (fr.first_reply_at - fr.first_sent)) / 3600.0
        ) FILTER (WHERE fr.first_reply_at IS NOT NULL) AS avg_reply_hours
      FROM first_reply fr
    ),
    reply_median AS (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY rh) AS median_reply_hours
      FROM (
        SELECT EXTRACT(EPOCH FROM (fr.first_reply_at - fr.first_sent)) / 3600.0 AS rh
        FROM first_reply fr
        WHERE fr.first_reply_at IS NOT NULL
      ) x
    ),
    reply_hist AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object('label', h.bucket_label, 'count', h.cnt)
          ORDER BY h.ord
        ),
        '[]'::jsonb
      ) AS histogram
      FROM (
        SELECT
          bucket_label,
          ord,
          COUNT(*)::bigint AS cnt
        FROM (
          SELECT
            CASE
              WHEN EXTRACT(EPOCH FROM (fr.first_reply_at - fr.first_sent)) / 3600.0 < 24 THEN '0–24 h'
              WHEN EXTRACT(EPOCH FROM (fr.first_reply_at - fr.first_sent)) / 3600.0 < 48 THEN '24–48 h'
              WHEN EXTRACT(EPOCH FROM (fr.first_reply_at - fr.first_sent)) / 3600.0 < 72 THEN '48–72 h'
              ELSE '72+ h'
            END AS bucket_label,
            CASE
              WHEN EXTRACT(EPOCH FROM (fr.first_reply_at - fr.first_sent)) / 3600.0 < 24 THEN 1
              WHEN EXTRACT(EPOCH FROM (fr.first_reply_at - fr.first_sent)) / 3600.0 < 48 THEN 2
              WHEN EXTRACT(EPOCH FROM (fr.first_reply_at - fr.first_sent)) / 3600.0 < 72 THEN 3
              ELSE 4
            END AS ord
          FROM first_reply fr
          WHERE fr.first_reply_at IS NOT NULL
        ) buckets
        GROUP BY bucket_label, ord
      ) h
    )
    SELECT jsonb_build_object(
      'new_leads', (SELECT new_leads FROM lead_counts),
      'active_leads', (SELECT active_leads FROM lead_counts),
      'by_stage', (SELECT stages FROM by_stage),
      'by_country', (SELECT countries FROM by_country),
      'email_open_rate', COALESCE((SELECT open_rate FROM email_rates), 0),
      'email_reply', jsonb_build_object(
        'contacted', COALESCE((SELECT contacted FROM reply_stats), 0),
        'replied', COALESCE((SELECT replied FROM reply_stats), 0),
        'reply_rate',
          CASE
            WHEN COALESCE((SELECT contacted FROM reply_stats), 0) = 0 THEN 0::float
            ELSE (SELECT replied FROM reply_stats)::float / (SELECT contacted FROM reply_stats)::float
          END,
        'avg_reply_hours', COALESCE((SELECT avg_reply_hours FROM reply_stats), 0),
        'median_reply_hours', COALESCE((SELECT median_reply_hours FROM reply_median), 0),
        'histogram', COALESCE((SELECT histogram FROM reply_hist), '[]'::jsonb)
      )
    )
  );
END;
$$;
