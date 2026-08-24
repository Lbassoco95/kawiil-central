import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import { PipelineModalHeader } from "@/components/pipeline/modals/PipelineModalHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RichTextEditor } from "@/components/microsoft/RichTextEditor";
import { supabase } from "@/integrations/supabase/client";
import { pipelineQueryKeys, useEmailTemplates } from "@/hooks/usePipeline";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MailPlus, AlertTriangle } from "lucide-react";

export interface BulkEmailLead {
  id: string;
  full_name: string;
  email: string | null;
  company_name?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  leads: BulkEmailLead[];
  /** Se llama al terminar un envío con al menos un correo enviado. */
  onSent?: () => void;
}

type SendFailure = { leadName: string; message: string };

function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: string }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return "Error desconocido";
}

/**
 * Envío masivo de correos a los leads seleccionados en el tablero.
 *
 * El correo se envía por lead (uno por uno) a través de `send-pipeline-email`,
 * que ya personaliza las variables `{{nombre}}`, `{{empresa}}`, `{{email}}`,
 * `{{pais}}` y `{{campana}}` con los datos de cada lead y deja el registro en
 * `email_log` + `lead_activities`. Así cada prospecto recibe un correo
 * individual (no una copia con todos los destinatarios visibles).
 */
export function BulkEmailModal({ open, onClose, leads, onSent }: Props) {
  const qc = useQueryClient();
  const { data: templates = [] } = useEmailTemplates();
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [editorSeed, setEditorSeed] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failures, setFailures] = useState<SendFailure[]>([]);
  const cancelRef = useRef(false);

  const withEmail = useMemo(
    () => leads.filter((l) => (l.email || "").trim().length > 0),
    [leads],
  );
  const withoutEmail = useMemo(
    () => leads.filter((l) => !(l.email || "").trim()),
    [leads],
  );

  useEffect(() => {
    if (!open) return;
    setTemplateId(undefined);
    setSubject("");
    setBodyHtml("");
    setEditorSeed("");
    setProgress(0);
    setFailures([]);
    cancelRef.current = false;
  }, [open]);

  const activeTemplates = useMemo(() => templates.filter((t) => t.is_active), [templates]);

  const applyTemplate = (id: string) => {
    const tpl = activeTemplates.find((t) => t.id === id);
    if (!tpl) return;
    setTemplateId(id);
    setSubject(tpl.subject || "");
    setBodyHtml(tpl.body_html || "");
    // Fuerza el remount del editor para cargar el HTML de la plantilla.
    setEditorSeed(`${id}-${Date.now()}`);
  };

  const send = async () => {
    if (withEmail.length === 0) {
      toast.error("Ninguno de los leads seleccionados tiene correo");
      return;
    }
    if (!subject.trim() || !bodyHtml.replace(/<[^>]*>/g, "").trim()) {
      toast.error("Asunto y contenido son requeridos");
      return;
    }
    setSending(true);
    setProgress(0);
    setFailures([]);
    cancelRef.current = false;

    const localFailures: SendFailure[] = [];
    let sent = 0;

    for (let i = 0; i < withEmail.length; i++) {
      if (cancelRef.current) break;
      const lead = withEmail[i];
      try {
        const { data, error } = await supabase.functions.invoke("send-pipeline-email", {
          body: {
            lead_id: lead.id,
            template_id: templateId,
            subject,
            body_html: bodyHtml,
            to_email: (lead.email || "").trim(),
          },
        });
        const fnBodyError =
          data && typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "";
        if (error || fnBodyError) {
          localFailures.push({
            leadName: lead.full_name,
            message: (fnBodyError || error?.message || "Error desconocido").slice(0, 180),
          });
        } else {
          sent++;
          qc.invalidateQueries({ queryKey: pipelineQueryKeys.emailLog(lead.id) });
          qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(lead.id) });
        }
      } catch (e: unknown) {
        localFailures.push({ leadName: lead.full_name, message: errorMessage(e).slice(0, 180) });
      }
      setProgress(i + 1);
    }

    setFailures(localFailures);
    setSending(false);
    qc.invalidateQueries({ queryKey: pipelineQueryKeys.leads });

    if (sent > 0) {
      toast.success(
        localFailures.length === 0
          ? `Correo enviado a ${sent} lead(s)`
          : `Enviados ${sent}; ${localFailures.length} con error`,
      );
      onSent?.();
    } else {
      toast.error("No se pudo enviar ningún correo");
    }
    if (localFailures.length === 0) onClose();
  };

  const total = withEmail.length;
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !sending && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden p-0 [&>button.absolute]:text-white [&>button.absolute]:hover:bg-white/15 [&>button.absolute]:top-3 [&>button.absolute]:right-3 flex flex-col">
        <PipelineModalHeader
          icon={<MailPlus className="h-4 w-4" />}
          title={`Enviar correo a ${leads.length} lead(s)`}
          subtitle="Un correo individual por prospecto, con variables personalizadas"
        />
        <div className="space-y-4 overflow-y-auto px-4 pb-4 pt-3 sm:px-5">
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Destinatarios
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {withEmail.slice(0, 12).map((l) => (
                <Badge key={l.id} variant="secondary" className="text-[10px] max-w-[220px] truncate">
                  {l.full_name} · {l.email}
                </Badge>
              ))}
              {withEmail.length > 12 ? (
                <Badge variant="outline" className="text-[10px]">
                  +{withEmail.length - 12} más
                </Badge>
              ) : null}
              {withEmail.length === 0 ? (
                <span className="text-xs text-muted-foreground">Sin destinatarios válidos.</span>
              ) : null}
            </div>
            {withoutEmail.length > 0 ? (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  {withoutEmail.length} lead(s) sin correo se omiten:{" "}
                  {withoutEmail.slice(0, 5).map((l) => l.full_name).join(", ")}
                  {withoutEmail.length > 5 ? "…" : ""}
                </span>
              </p>
            ) : null}
          </div>

          {activeTemplates.length > 0 ? (
            <div>
              <Label>Usar plantilla</Label>
              <Select
                value={templateId || "__none__"}
                onValueChange={(v) => {
                  if (v === "__none__") {
                    setTemplateId(undefined);
                    return;
                  }
                  applyTemplate(v);
                }}
                disabled={sending}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar plantilla…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin plantilla</SelectItem>
                  {activeTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div>
            <Label>Asunto *</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Seguimiento a tu solicitud, {{nombre}}"
              disabled={sending}
            />
          </div>

          <div>
            <Label>Contenido *</Label>
            <div className="rounded-md border border-input">
              <RichTextEditor
                key={editorSeed}
                initialHtml={bodyHtml}
                placeholder="Hola {{nombre}}, …"
                onHtmlChange={setBodyHtml}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Variables disponibles: <code>{"{{nombre}}"}</code>, <code>{"{{empresa}}"}</code>,{" "}
              <code>{"{{email}}"}</code>, <code>{"{{pais}}"}</code>, <code>{"{{campana}}"}</code>. Se
              reemplazan con los datos de cada lead.
            </p>
          </div>

          {sending || progress > 0 ? (
            <div className="space-y-1.5">
              <Progress value={pct} />
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {progress} de {total} procesados
              </p>
            </div>
          ) : null}

          {failures.length > 0 ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-xs font-semibold text-destructive">
                {failures.length} envío(s) con error
              </p>
              <ul className="mt-1.5 space-y-1">
                {failures.map((f, i) => (
                  <li key={`${f.leadName}-${i}`} className="text-[11px] text-muted-foreground">
                    <strong className="text-foreground">{f.leadName}</strong>: {f.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <DialogFooter className="border-t border-border/60 px-4 py-3 sm:px-5">
          {sending ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                cancelRef.current = true;
              }}
            >
              Detener
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>
              Cerrar
            </Button>
          )}
          <Button type="button" onClick={() => void send()} disabled={sending || total === 0}>
            {sending ? `Enviando… ${pct}%` : `Enviar a ${total} lead(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
