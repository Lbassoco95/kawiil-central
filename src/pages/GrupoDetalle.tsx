/**
 * Vista mínima de grupo — /grupos/:groupId (B2).
 */

import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { mtgDb } from "@/lib/mtg/db";
import { CADENCE, MEETING_STATUS } from "@/lib/mtg/constants";
import { formatDateMX } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function GrupoDetalle() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();

  const q = useQuery({
    queryKey: ["mtg-group", groupId],
    enabled: !!user && !!groupId,
    queryFn: async () => {
      const { data: group, error } = await supabase
        .from("client_groups")
        .select("*")
        .eq("id", groupId!)
        .single();
      if (error) throw error;

      const { data: members } = await supabase
        .from("client_group_members")
        .select("client_id, clients(id, name)")
        .eq("group_id", groupId!);

      const { data: series } = await mtgDb
        .from("mtg_series")
        .select("*")
        .eq("anchor_type", "group")
        .eq("anchor_id", groupId!)
        .eq("active", true);

      const seriesIds = (series ?? []).map((s) => s.id);
      let meetings: {
        id: string;
        scheduled_at: string;
        status: string;
        series_id: string | null;
        agreementsConfirmed: number;
        openTasksCount: number;
      }[] = [];
      if (seriesIds.length > 0) {
        const { data: m } = await mtgDb
          .from("mtg_meetings")
          .select("id, scheduled_at, status, series_id")
          .in("series_id", seriesIds)
          .order("scheduled_at", { ascending: false })
          .limit(40);
        const list = m ?? [];
        const meetingIds = list.map((x) => x.id);
        const stats = new Map<string, number>();
        const openTasks = new Map<string, number>();
        if (meetingIds.length > 0) {
          const { data: agreements } = await mtgDb
            .from("mtg_agreements")
            .select("meeting_id, status")
            .in("meeting_id", meetingIds)
            .eq("status", "confirmed");
          for (const a of agreements ?? []) {
            stats.set(a.meeting_id, (stats.get(a.meeting_id) ?? 0) + 1);
          }
          const { data: tasks } = await supabase
            .from("tasks")
            .select("mtg_meeting_id, status")
            .in("mtg_meeting_id", meetingIds)
            .not("status", "in", '("completada","cancelada")');
          for (const t of tasks ?? []) {
            if (!t.mtg_meeting_id) continue;
            openTasks.set(t.mtg_meeting_id, (openTasks.get(t.mtg_meeting_id) ?? 0) + 1);
          }
        }
        meetings = list.map((x) => ({
          ...x,
          agreementsConfirmed: stats.get(x.id) ?? 0,
          openTasksCount: openTasks.get(x.id) ?? 0,
        }));
      }

      const { data: docs } = await supabase
        .from("documents")
        .select("id, name, document_type, created_at, metadata")
        .contains("metadata", { client_group_id: groupId })
        .order("created_at", { ascending: false })
        .limit(30);

      return { group, members: members ?? [], series: series ?? [], meetings, docs: docs ?? [] };
    },
  });

  if (q.isLoading) {
    return (
      <AppLayout>
        <div className="flex gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando grupo…
        </div>
      </AppLayout>
    );
  }

  if (!q.data) {
    return (
      <AppLayout>
        <p className="p-8 text-sm text-destructive">Grupo no encontrado.</p>
      </AppLayout>
    );
  }

  const { group, members, series, meetings, docs } = q.data;

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon">
            <Link to="/clientes">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-xl font-bold">{group.name}</h1>
        </div>
        {group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}

        <section>
          <h2 className="font-semibold mb-2">Miembros</h2>
          <ul className="space-y-1 text-sm">
            {members.map((m) => {
              const c = m.clients as { id: string; name: string } | null;
              return (
                <li key={m.client_id}>
                  {c ? (
                    <Link className="text-primary underline-offset-2 hover:underline" to={`/clientes/${c.id}`}>
                      {c.name}
                    </Link>
                  ) : (
                    m.client_id
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Series (Juntas)</h2>
          {series.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin series.</p>
          ) : (
            <ul className="space-y-2">
              {series.map((s) => (
                <li key={s.id} className="border rounded-md p-3 text-sm">
                  <div className="font-medium">{s.title}</div>
                  <div className="text-xs text-muted-foreground">{CADENCE[s.cadence].label}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-semibold mb-2">Juntas</h2>
          <ul className="space-y-2">
            {meetings.map((m) => {
              const st = MEETING_STATUS[m.status as keyof typeof MEETING_STATUS];
              return (
                <li key={m.id} className="flex items-center justify-between border rounded-md p-3 text-sm gap-2">
                  <Link to={`/juntas/${m.id}`} className="font-medium hover:underline">
                    {formatDateMX(m.scheduled_at)}
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-muted-foreground">
                      Acuerdos {m.agreementsConfirmed}
                      {m.openTasksCount > 0 ? ` · tareas abiertas ${m.openTasksCount}` : ""}
                    </span>
                    <Badge variant="outline" className={st?.color}>
                      {st?.label ?? m.status}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Documentos del grupo</h2>
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin documentos (minutas de grupo en B4).</p>
          ) : (
            <ul className="text-sm space-y-1">
              {docs.map((d) => (
                <li key={d.id}>
                  {d.name} · {d.document_type}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
