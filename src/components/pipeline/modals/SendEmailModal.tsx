import { useState, useEffect } from "react";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { Switch } from "@/components/ui/switch";
import { emailLimits, withLimits } from "@/lib/fileIntake/limits";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import DOMPurify from "dompurify";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import { PipelineModalHeader } from "@/components/pipeline/modals/PipelineModalHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { pipelineQueryKeys, useEmailTemplates } from "@/hooks/usePipeline";
import { Mail } from "lucide-react";
import { RichTextEditor } from "@/components/microsoft/RichTextEditor";
import {
  EMAIL_ATTACHMENT_ACCEPT,
  filesToComposerAttachments,
  type ComposerAttachment,
} from "@/lib/emailComposer";

const emailSchema = z
  .object({
    to_email: z.string().min(1, "El correo principal es requerido").email("Email inválido"),
    extra_email_1: z.string().optional(),
    extra_email_2: z.string().optional(),
    extra_email_3: z.string().optional(),
    subject: z.string().min(1, "El asunto es requerido"),
    body_html: z.string().min(1, "El contenido es requerido"),
    template_id: z.string().optional(),
    schedule_follow_up: z.boolean().default(false),
    follow_up_date: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const keys = ["extra_email_1", "extra_email_2", "extra_email_3"] as const;
    const extras: string[] = [];
    for (const k of keys) {
      const v = (data[k] || "").trim();
      if (!v) continue;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Email inválido", path: [k] });
        continue;
      }
      extras.push(v);
    }
    const main = data.to_email.trim();
    const all = [main, ...extras];
    const uniq = new Set(all.map((x) => x.toLowerCase()));
    if (uniq.size !== all.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "No repitas el mismo correo",
        path: ["to_email"],
      });
    }
    if (all.length > 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Máximo 4 destinatarios en total",
        path: ["to_email"],
      });
    }
  });

type EmailForm = z.infer<typeof emailSchema>;

export type ReplyToEmail = {
  graph_message_id: string | null;
  subject: string;
  from_email: string | null;
  body_html?: string | null;
};

interface Props {
  open: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
  leadEmail: string | null;
  replyTo?: ReplyToEmail | null;
}

function replaceVariables(text: string, leadName: string, leadEmail: string | null): string {
  const email = leadEmail || "";
  return text
    .replace(/\{\{nombre\}\}/gi, leadName)
    .replace(/\{\{name\}\}/gi, leadName)
    .replace(/\{\{full_name\}\}/gi, leadName)
    .replace(/\{\{email\}\}/gi, email);
}

function errorMessageFromUnknown(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: string }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return "Error al enviar email";
}

export function SendEmailModal({ open, onClose, leadId, leadName, leadEmail, replyTo }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: templates = [] } = useEmailTemplates();
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [keepZips, setKeepZips] = useState(true);

  const form = useForm<EmailForm>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      to_email: leadEmail || "",
      extra_email_1: "",
      extra_email_2: "",
      extra_email_3: "",
      subject: "",
      body_html: "",
      template_id: undefined,
      schedule_follow_up: false,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (leadEmail) form.setValue("to_email", leadEmail);
    form.setValue("extra_email_1", "");
    form.setValue("extra_email_2", "");
    form.setValue("extra_email_3", "");
    if (replyTo?.subject) {
      const base = replyTo.subject.replace(/^Re:\s*/i, "");
      form.setValue("subject", `Re: ${base}`);
    } else {
      form.setValue("subject", "");
    }
    form.setValue("body_html", "");
    form.setValue("template_id", undefined);
    form.setValue("schedule_follow_up", false);
    setPendingFiles([]);
    setKeepZips(true);
  }, [open, leadEmail, replyTo, form]);

  const watchFollowUp = form.watch("schedule_follow_up");
  const watchTemplateId = form.watch("template_id");
  const watchBody = form.watch("body_html");
  const selectedTemplate = templates.find((t) => t.id === watchTemplateId);

  const applyTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    form.setValue("template_id", templateId);
    if (!replyTo) {
      form.setValue("subject", replaceVariables(tpl.subject, leadName, leadEmail));
    }
    form.setValue("body_html", replaceVariables(tpl.body_html || "", leadName, leadEmail));
  };

  const onSubmit = form.handleSubmit(async (data) => {
    if (!user) return;
    setSaving(true);
    try {
      // Incluir plantilla aunque react-hook-form no la devuelva en `data` (Select sin register).
      const templateIdRaw =
        (typeof data.template_id === "string" ? data.template_id : "") ||
        String(form.getValues("template_id") ?? "").trim();
      const template_id = templateIdRaw || undefined;

      const extras = [data.extra_email_1, data.extra_email_2, data.extra_email_3]
        .map((s) => (s || "").trim())
        .filter(Boolean);
      const additional_to_emails = replyTo ? [] : extras;

      const logPayload = {
        lead_id: leadId,
        template_id: template_id ?? null,
        to_email: data.to_email.trim(),
        additional_to_emails,
        subject: data.subject,
        status: "queued" as const,
        in_reply_to: replyTo?.graph_message_id || null,
      };
      let logRes = await supabase.from("email_log").insert(logPayload).select("id").single();
      if (logRes.error && /additional_to_emails|schema cache|column.*email_log/i.test(logRes.error.message || "")) {
        const { additional_to_emails: _a, ...withoutExtra } = logPayload;
        logRes = await supabase.from("email_log").insert(withoutExtra).select("id").single();
      }
      const { data: logEntry, error: emailErr } = logRes;
      if (emailErr) {
        const msg = errorMessageFromUnknown(emailErr);
        throw new Error(
          /additional_to_emails|schema cache/i.test(msg)
            ? `${msg} — En Supabase SQL Editor ejecuta: ALTER TABLE public.email_log ADD COLUMN IF NOT EXISTS additional_to_emails text[] NOT NULL DEFAULT '{}';`
            : msg,
        );
      }
      if (!logEntry) throw new Error("No se pudo crear el registro de envío");

      let attachments: ComposerAttachment[] = [];
      if (pendingFiles.length > 0) {
        try {
          attachments = await filesToComposerAttachments(pendingFiles);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : "No se pudieron adjuntar archivos");
        }
      }

      const { data: result, error: fnErr } = await supabase.functions.invoke(
        "send-pipeline-email",
        {
          body: {
            lead_id: leadId,
            template_id,
            email_log_id: logEntry.id,
            subject: data.subject,
            body_html: data.body_html,
            to_email: data.to_email.trim(),
            additional_to_emails,
            in_reply_to: replyTo?.graph_message_id || undefined,
            attachments,
          },
        },
      );

      const fnBodyError =
        result && typeof result === "object" && result !== null && "error" in result
          ? String((result as { error: unknown }).error)
          : "";

      if (fnErr || fnBodyError) {
        const detail = fnBodyError || fnErr?.message || "Error desconocido";
        await supabase.from("email_log").update({ status: "failed", error_message: detail.slice(0, 500) }).eq("id", logEntry.id);
        throw new Error(
          detail.length > 280 ? `${detail.slice(0, 280)}…` : detail,
        );
      }

      if (data.schedule_follow_up && data.follow_up_date) {
        await supabase.from("lead_tasks" as never).insert({
          lead_id: leadId,
          assigned_to: user.id,
          created_by: user.id,
          title: `Follow-up email con ${leadName}`,
          task_type: "email",
          due_date: data.follow_up_date,
          priority: "medium",
          notes: `Asunto enviado: ${data.subject}`,
        } as never);
      }

      qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(leadId) });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.emailLog(leadId) });
      const n = 1 + additional_to_emails.length;
      toast.success(
        n > 1
          ? `Correo enviado a ${n} destinatarios desde el buzón del sistema.`
          : "Correo enviado correctamente desde el buzón configurado en el sistema.",
      );
      onClose();
      form.reset({
        to_email: leadEmail || "",
        extra_email_1: "",
        extra_email_2: "",
        extra_email_3: "",
        subject: "",
        body_html: "",
        template_id: undefined,
        schedule_follow_up: false,
      });
      setPendingFiles([]);
    } catch (e: unknown) {
      toast.error(errorMessageFromUnknown(e));
    } finally {
      setSaving(false);
    }
  });

  const activeTemplates = templates.filter((t) => t.is_active);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-hidden p-0 [&>button.absolute]:text-white [&>button.absolute]:hover:bg-white/15 [&>button.absolute]:top-3 [&>button.absolute]:right-3 flex flex-col">
        <PipelineModalHeader
          icon={<Mail className="h-4 w-4" />}
          title={replyTo ? "Responder correo" : "Enviar email"}
          subtitle={replyTo ? "Continúa el hilo del lead" : "Queda registrado en el lead"}
        />
        <form onSubmit={onSubmit} className="space-y-4 px-4 pb-4 pt-3 sm:px-5 overflow-y-auto">
          {activeTemplates.length > 0 && (
            <div>
              <Label>Usar plantilla</Label>
              <Select
                value={watchTemplateId || "__none__"}
                onValueChange={(v) => {
                  if (v === "__none__") {
                    form.setValue("template_id", undefined);
                    return;
                  }
                  applyTemplate(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar plantilla…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin plantilla</SelectItem>
                  {activeTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        {t.name}
                        {t.category && (
                          <Badge variant="outline" className="text-[10px]">
                            {t.category}
                          </Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedTemplate?.default_attachment_key === "softlanding_hub_mexico" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/25 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              Esta plantilla adjunta automáticamente el PDF «Kawiil – Softlanding Hub en México». No hace
              falta volver a adjuntarlo aquí salvo que quieras enviar archivos adicionales.
            </div>
          )}

          <div>
            <Label>De</Label>
            <Input
              value="Buzón del sistema (Microsoft 365 / SENDER_EMAIL)"
              disabled
              className="bg-muted text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <div>
              <Label>Para (contacto del lead) *</Label>
              <Input type="email" {...form.register("to_email")} placeholder="correo@ejemplo.com" />
              {form.formState.errors.to_email && (
                <p className="text-xs text-destructive mt-1">{form.formState.errors.to_email.message}</p>
              )}
            </div>
            {!replyTo && (
              <>
                <p className="text-xs text-muted-foreground">
                  Correos adicionales (mismo mensaje para todos). Ideal si en Calendly u otra reunión hay más
                  participantes — hasta <strong>3</strong> extra (<strong>4</strong> destinatarios en total).
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Correo adicional 1</Label>
                    <Input type="email" {...form.register("extra_email_1")} placeholder="Opcional" />
                    {form.formState.errors.extra_email_1 && (
                      <p className="text-xs text-destructive mt-0.5">
                        {form.formState.errors.extra_email_1.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Correo adicional 2</Label>
                    <Input type="email" {...form.register("extra_email_2")} placeholder="Opcional" />
                    {form.formState.errors.extra_email_2 && (
                      <p className="text-xs text-destructive mt-0.5">
                        {form.formState.errors.extra_email_2.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Correo adicional 3</Label>
                    <Input type="email" {...form.register("extra_email_3")} placeholder="Opcional" />
                    {form.formState.errors.extra_email_3 && (
                      <p className="text-xs text-destructive mt-0.5">
                        {form.formState.errors.extra_email_3.message}
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div>
            <Label>Asunto *</Label>
            <Input {...form.register("subject")} placeholder="Asunto del correo…" />
            {form.formState.errors.subject && (
              <p className="text-xs text-destructive mt-1">{form.formState.errors.subject.message}</p>
            )}
          </div>

          <div>
            <Label className="mb-1 block">Contenido *</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Ves el mismo formato que recibirá el destinatario y puedes corregir el texto aquí antes de enviar.
            </p>
            <RichTextEditor
              key={`${leadId}-${watchTemplateId ?? "none"}`}
              initialHtml={watchBody}
              placeholder="Contenido del correo..."
              onHtmlChange={(html) => form.setValue("body_html", html, { shouldValidate: true })}
              className="min-h-[200px] [&_.ProseMirror]:min-h-[160px] bg-muted/10"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Variables en plantillas y cuerpo:{" "}
              <code className="text-[10px]">{"{{nombre}} {{email}} {{empresa}} {{pais}} {{campana}}"}</code>
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <span className="font-medium">Adjuntos</span>
              <span className="hidden sm:inline text-muted-foreground/35 select-none" aria-hidden>
                ·
              </span>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <Switch checked={keepZips} onCheckedChange={setKeepZips} />
                <span>Mantener .zip</span>
              </label>
            </div>
            <FileDropzone
              files={pendingFiles}
              onChange={setPendingFiles}
              limits={withLimits(emailLimits, {
                accept: EMAIL_ATTACHMENT_ACCEPT,
                zipMode: keepZips ? "keep" : "auto",
              })}
              variant="area"
              hint="Arrastra archivos o haz click"
              subhint={keepZips ? "Los .zip se envían tal cual" : "Los .zip se expanden y se envían como archivos"}
              showSize
            />
          </div>

          {replyTo?.body_html ? (
            <div className="border-l-2 border-muted pl-3 space-y-1">
              <p className="text-xs text-muted-foreground">Mensaje original</p>
              <div
                className="text-sm prose prose-sm dark:prose-invert max-w-none opacity-70 max-h-40 overflow-y-auto"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(replyTo.body_html, { USE_PROFILES: { html: true } }),
                }}
              />
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Checkbox
              id="email-follow-up"
              checked={watchFollowUp}
              onCheckedChange={(v) => form.setValue("schedule_follow_up", !!v)}
            />
            <Label htmlFor="email-follow-up" className="cursor-pointer">
              Programar seguimiento si no responde
            </Label>
          </div>
          {watchFollowUp && (
            <div className="pl-6">
              <Label>Fecha de seguimiento</Label>
              <Input type="datetime-local" {...form.register("follow_up_date")} />
              <p className="text-xs text-muted-foreground mt-1">
                Se creará una tarea para dar seguimiento si el lead no responde.
              </p>
            </div>
          )}

          <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-3">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              El correo se envía desde el buzón configurado en Supabase (secret{" "}
              <strong>SENDER_EMAIL</strong>) y queda en el historial del lead. El estado
              (enviado, abierto, clic) aparece en la sección Correos.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              <Mail className="h-4 w-4 mr-1" />
              Enviar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
