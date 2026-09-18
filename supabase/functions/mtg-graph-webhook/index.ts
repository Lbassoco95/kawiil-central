import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const expected = Deno.env.get("MTG_GRAPH_CLIENT_STATE") ?? "";
  const body = await req.json().catch(() => ({ value: [] }));
  const notifications = body.value ?? [];

  for (const n of notifications) {
    if (expected && n.clientState && n.clientState !== expected) continue;
    const resource = String(n.resource ?? "");
    const meetingMatch = resource.match(/onlineMeetings\('([^']+)'\)/i);
    const onlineMeetingId = meetingMatch?.[1] ?? null;

    let meetingId: string | null = null;
    if (onlineMeetingId) {
      const { data: m } = await admin
        .from("mtg_meetings")
        .select("id, organization_id")
        .eq("teams_online_meeting_id", onlineMeetingId)
        .maybeSingle();
      if (m) {
        meetingId = m.id;
        await admin.from("job_queue").insert({
          organization_id: m.organization_id,
          kind: "mtg.fetch_transcript",
          payload: {
            meeting_id: m.id,
            transcript_id: n.resourceData?.id ?? null,
            online_meeting_id: onlineMeetingId,
          },
          status: "pending",
        });
        await admin
          .from("mtg_meetings")
          .update({ transcript_status: "subscribed" })
          .eq("id", m.id);
      }
    }

    if (!meetingId) {
      await admin.from("mtg_unmatched_transcripts").insert({
        resource,
        organizer_id: n.resourceData?.organizer?.user?.id ?? null,
        payload: n,
      });
    }
  }

  return new Response(JSON.stringify({ accepted: notifications.length }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
});
