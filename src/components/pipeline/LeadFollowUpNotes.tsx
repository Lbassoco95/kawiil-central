import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfiles } from "@/hooks/useTasks";
import { pipelineQueryKeys } from "@/hooks/usePipeline";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { avatarBgFromName, initialsFromName } from "@/lib/pipelineFormat";
import { renderTextWithMentionHighlights } from "@/lib/renderMentionHighlights";
import type { Json } from "@/integrations/supabase/types";

interface ActivityLike {
  id: string;
  type: string;
  metadata: Json | null;
  created_at: string;
  user_id: string | null;
}

interface Props {
  leadId: string;
  activities: ActivityLike[];
  /** Propietario del lead (quien tiene el seguimiento asignado). */
  ownerName?: string | null;
}

/**
 * Comentarios de seguimiento del lead.
 *
 * A diferencia del campo `notes` del lead (que se sobreescribe al editarlo y no
 * guarda autoría), cada comentario queda como una actividad `note` con el
 * usuario que lo escribió y la fecha: así se ve **quién** está dando
 * seguimiento y qué dijo, sin borrar lo anterior.
 */
export function LeadFollowUpNotes({ leadId, activities, ownerName }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: profiles = [] } = useProfiles();
  const [content, setContent] = useState("");
  const [important, setImportant] = useState(false);
  const [saving, setSaving] = useState(false);

  const nameByUserId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) {
      if (p.user_id) m.set(p.user_id, p.full_name || p.email || "Usuario");
    }
    return m;
  }, [profiles]);

  const notes = useMemo(
    () =>
      activities
        .filter((a) => a.type === "note")
        .map((a) => {
          const meta = (a.metadata as Record<string, unknown> | null) || {};
          return {
            id: a.id,
            created_at: a.created_at,
            author: a.user_id ? nameByUserId.get(a.user_id) || "Usuario" : "Sistema",
            content: typeof meta.content === "string" ? meta.content : "",
            important: !!meta.is_important,
          };
        })
        .filter((n) => n.content.trim().length > 0),
    [activities, nameByUserId],
  );

  const submit = async () => {
    if (!user) return;
    const text = content.trim();
    if (!text) {
      toast.error("Escribe un comentario");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("lead_activities").insert({
        lead_id: leadId,
        user_id: user.id,
        type: "note",
        metadata: { content: text, is_important: important },
      } as never);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(leadId) });
      setContent("");
      setImportant(false);
      toast.success("Comentario agregado");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el comentario");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4" />
          Comentarios de seguimiento
          <Badge variant="secondary" className="text-[10px]">
            {notes.length}
          </Badge>
        </CardTitle>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <UserCheck className="h-3 w-3 shrink-0" />
          {ownerName
            ? `Seguimiento a cargo de ${ownerName}`
            : "Sin responsable asignado — asígnalo en Propietario"}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
          <Textarea
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Ej. Hablé con el cliente, pide propuesta con dos escenarios…"
            className="bg-background"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`note-important-${leadId}`}
                checked={important}
                onCheckedChange={(v) => setImportant(!!v)}
              />
              <Label htmlFor={`note-important-${leadId}`} className="cursor-pointer text-xs">
                Marcar como importante
              </Label>
            </div>
            <Button type="button" size="sm" onClick={() => void submit()} disabled={saving}>
              <Send className="mr-1 h-3.5 w-3.5" />
              {saving ? "Guardando…" : "Comentar"}
            </Button>
          </div>
        </div>

        {notes.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Aún no hay comentarios. El primero queda con tu nombre y fecha.
          </p>
        ) : (
          <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {notes.map((n) => (
              <li
                key={n.id}
                className="rounded-lg border border-border/60 bg-card p-2.5 shadow-sm"
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: avatarBgFromName(n.author) }}
                    aria-hidden
                  >
                    {initialsFromName(n.author)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold">{n.author}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: es })}
                      </span>
                      {n.important ? (
                        <Badge variant="destructive" className="text-[9px]">
                          Importante
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-snug">
                      {renderTextWithMentionHighlights(n.content, `lead-note-${n.id}`)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
