import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarX, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatMX } from "@/lib/dateUtils";
import { formatHearingTime } from "@/lib/lawsuits";
import { useProfiles } from "@/hooks/useTasks";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/integrations/supabase/types";

type LawsuitRow = Database["public"]["Tables"]["project_lawsuits"]["Row"];
type HistoryRow = Database["public"]["Tables"]["project_lawsuit_date_history"]["Row"];

function describe(date: string | null, time: string | null, note: string | null): string {
  if (!date) return "Sin fecha";
  const t = formatHearingTime(time);
  return [formatMX(date, "d MMM yyyy") + (t ? `, ${t}` : ""), note].filter(Boolean).join(" · ");
}

export function LawsuitDatesHistoryPanel({ lawsuit }: { lawsuit: LawsuitRow }) {
  const { user } = useAuth();
  const { data: profiles = [] } = useProfiles();
  const nameOf = (id: string | null) =>
    id ? profiles.find((p) => p.user_id === id)?.full_name || "Usuario" : null;

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["lawsuit-date-history", lawsuit.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_lawsuit_date_history")
        .select("*")
        .eq("lawsuit_id", lawsuit.id)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data as HistoryRow[];
    },
  });

  const current = [
    {
      label: "Próxima audiencia",
      value: describe(lawsuit.next_hearing_date, lawsuit.next_hearing_time, null),
      has: !!lawsuit.next_hearing_date,
      eventOwner: lawsuit.hearing_event_id ? lawsuit.hearing_event_owner : undefined,
    },
    {
      label: "Próximo plazo",
      value: describe(lawsuit.next_deadline_date, null, lawsuit.next_deadline_note),
      has: !!lawsuit.next_deadline_date,
      eventOwner: lawsuit.deadline_event_id ? lawsuit.deadline_event_owner : undefined,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {current.map((c) => (
          <div key={c.label} className="rounded-md border p-3 space-y-1">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="text-sm font-medium">{c.value}</div>
            {c.has && (
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {c.eventOwner !== undefined ? (
                  <>
                    <CalendarCheck className="h-3 w-3 text-emerald-600" />
                    En Outlook{c.eventOwner === user?.id ? " (tu calendario)" : c.eventOwner ? ` (calendario de ${nameOf(c.eventOwner)})` : ""}
                  </>
                ) : (
                  <>
                    <CalendarX className="h-3 w-3" /> Sin evento en Outlook
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" /> Historial de cambios
        </h4>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay cambios registrados en la audiencia ni en el plazo.</p>
        ) : (
          <ol className="space-y-2">
            {history.map((h) => {
              const before = h.old_date || h.old_note ? describe(h.old_date, h.old_time, h.old_note) : null;
              const after = describe(h.new_date, h.new_time, h.new_note);
              return (
                <li key={h.id} className="rounded-md border p-3 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[11px]">
                      {h.kind === "audiencia" ? "Audiencia" : "Plazo"}
                    </Badge>
                    <span className="text-sm">
                      {before ? (
                        <>
                          <span className="text-muted-foreground line-through">{before}</span> → {after}
                        </>
                      ) : (
                        after
                      )}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {nameOf(h.changed_by) ?? "Registrado al activar el historial"} ·{" "}
                    {formatMX(h.changed_at, "d MMM yyyy, HH:mm")}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
