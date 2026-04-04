UPDATE leads SET last_activity_at = sub.max_at
FROM (
  SELECT la.lead_id, MAX(la.created_at) as max_at
  FROM lead_activities la
  GROUP BY la.lead_id
) sub
WHERE leads.id = sub.lead_id
AND leads.last_activity_at IS NULL;
