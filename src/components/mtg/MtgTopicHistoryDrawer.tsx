/**
 * Drawer: historial de un tema (updates, acuerdos, decisiones).
 */

import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { MOVEMENT } from "@/lib/mtg/constants";
import { formatDateMX } from "@/lib/dateUtils";
import { fetchTopicHistory } from "@/lib/mtg/topicHistory";
import { Loader2 } from "lucide-react";
import type { MtgMovement } from "@/lib/mtg/constants";

export function MtgTopicHistoryDrawer(props: {
  topicId: string | null;
  topicTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const q = useQuery({
    queryKey: ["mtg-topic-history", props.topicId],
    enabled: props.open && !!props.topicId,
    queryFn: () => fetchTopicHistory(props.topicId!),
  });

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="z-[120] w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left pr-6">{props.topicTitle ?? "Historial del tema"}</SheetTitle>
        </SheetHeader>
        {q.isLoading && (
          <div className="flex gap-2 text-sm text-muted-foreground mt-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        )}
        {q.data && (
          <div className="mt-4 space-y-6 text-sm">
            <section>
              <h3 className="font-semibold mb-2">Línea de tiempo</h3>
              {q.data.updates.length === 0 ? (
                <p className="text-muted-foreground text-xs">Sin updates.</p>
              ) : (
                <ol className="space-y-3 border-l pl-3">
                  {q.data.updates.map((u) => {
                    const mov = MOVEMENT[u.movement as MtgMovement];
                    return (
                      <li key={u.id} className="relative">
                        <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-primary" />
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-xs text-muted-foreground">
                            {u.meeting_scheduled_at
                              ? formatDateMX(u.meeting_scheduled_at)
                              : "—"}
                          </span>
                          <Badge variant="outline" className={mov?.color}>
                            {mov?.label ?? u.movement}
                          </Badge>
                        </div>
                        {u.progress_since_last && (
                          <p className="text-xs mt-1">
                            <strong>Avance:</strong> {u.progress_since_last}
                          </p>
                        )}
                        {u.next_step && (
                          <p className="text-xs">
                            <strong>Sigue:</strong> {u.next_step}
                          </p>
                        )}
                        {u.session_notes && (
                          <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                            {u.session_notes}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            <section>
              <h3 className="font-semibold mb-2">Acuerdos ligados</h3>
              {q.data.agreements.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ninguno.</p>
              ) : (
                <ul className="space-y-2">
                  {q.data.agreements.map((a) => (
                    <li key={a.id} className="border rounded-md p-2 text-xs">
                      <div className="font-medium">{a.text}</div>
                      <div className="text-muted-foreground mt-0.5">
                        {a.status}
                        {a.task_id
                          ? ` · tarea ${a.task_status ?? "—"} (${a.task_id.slice(0, 8)}…)`
                          : " · sin tarea"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="font-semibold mb-2">Decisiones ligadas</h3>
              {q.data.decisions.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ninguna.</p>
              ) : (
                <ul className="space-y-2">
                  {q.data.decisions.map((d) => (
                    <li key={d.id} className="border rounded-md p-2 text-xs">
                      <div className="font-medium">{d.text}</div>
                      <div className="text-muted-foreground">
                        {d.status}
                        {d.resolution ? ` → ${d.resolution}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
