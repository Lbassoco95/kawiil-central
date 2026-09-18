/**
 * Sección plegada "Archivo" al final del tablero.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import { mtgDb, type MtgEntity, type MtgMeetingRow, type MtgTopicRow } from "@/lib/mtg/db";
import { filterArchiveTopics, type ArchiveTopic } from "@/lib/mtg/boardArchive";
import { formatDateMX } from "@/lib/dateUtils";
import { reopenTopicInMeeting } from "@/lib/mtg/reopenTopic";
import { toast } from "sonner";

export function MtgArchiveSection(props: {
  seriesId: string;
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  entities: MtgEntity[];
  liveEditable: boolean;
  onOpenHistory: (topic: { id: string; title: string }) => void;
  onReopened?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [entityKey, setEntityKey] = useState("all");
  const [query, setQuery] = useState("");

  const q = useQuery({
    queryKey: ["mtg-archive", props.seriesId],
    enabled: !!props.seriesId,
    queryFn: async () => {
      const { data: topics, error } = await mtgDb
        .from("mtg_topics")
        .select("*")
        .eq("series_id", props.seriesId)
        .in("status", ["resolved", "dropped"]);
      if (error) throw error;

      const meetingIds = [
        ...new Set(
          (topics ?? [])
            .map((t) => t.resolved_in_meeting_id)
            .filter(Boolean) as string[],
        ),
      ];
      let meetingAt = new Map<string, string>();
      if (meetingIds.length > 0) {
        const { data: meetings } = await mtgDb
          .from("mtg_meetings")
          .select("id, scheduled_at")
          .in("id", meetingIds);
        meetingAt = new Map((meetings ?? []).map((m) => [m.id, m.scheduled_at]));
      }

      return ((topics ?? []) as MtgTopicRow[]).map(
        (t): ArchiveTopic => ({
          id: t.id,
          title: t.title,
          entity_key: t.entity_key,
          status: t.status,
          resolved_in_meeting_id: t.resolved_in_meeting_id,
          legacy_key: t.legacy_key,
          client_id: t.client_id,
          closed_in_meeting_id: t.resolved_in_meeting_id,
          closed_at_label: t.resolved_in_meeting_id
            ? meetingAt.get(t.resolved_in_meeting_id) ?? null
            : null,
        }),
      );
    },
  });

  const filtered = useMemo(
    () => filterArchiveTopics(q.data ?? [], { entityKey, query }),
    [q.data, entityKey, query],
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-md">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="font-semibold text-sm">Archivo</span>
        <Badge variant="secondary" className="text-[10px]">
          {q.data?.length ?? "…"}
        </Badge>
        <span className="text-xs text-muted-foreground ml-auto">cerrado por defecto</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select value={entityKey} onValueChange={setEntityKey}>
            <SelectTrigger className="w-[160px] h-8">
              <SelectValue placeholder="Entidad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {props.entities.map((e) => (
                <SelectItem key={e.key} value={e.key}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="max-w-xs h-8"
            placeholder="Buscar tema…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin temas archivados.</p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 border rounded-md p-2 text-sm"
              >
                <button
                  type="button"
                  className="text-left font-medium hover:underline"
                  onClick={() => props.onOpenHistory({ id: t.id, title: t.title })}
                >
                  {t.title}
                </button>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{t.status}</Badge>
                  <span>
                    {t.closed_at_label ? formatDateMX(t.closed_at_label) : "sin junta"}
                  </span>
                  {props.liveEditable && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={async () => {
                        try {
                          await reopenTopicInMeeting({
                            organizationId: props.organizationId,
                            actorUserId: props.actorUserId,
                            topic: t,
                            meeting: props.meeting,
                          });
                          toast.success("Tema reabierto en esta junta");
                          props.onReopened?.();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Error");
                        }
                      }}
                    >
                      Reabrir
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
