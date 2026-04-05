import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import DOMPurify from "dompurify";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Mail, Eye } from "lucide-react";

const emailSchema = z.object({
  to_email: z.string().email("Email inválido"),
  subject: z.string().min(1, "El asunto es requerido"),
  body_html: z.string().min(1, "El contenido es requerido"),
  template_id: z.string().optional(),
  schedule_follow_up: z.boolean().default(false),
  follow_up_date: z.string().optional(),
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

function replaceVariables(text: string, leadName: string): string {
  return text
    .replace(/\{\{nombre\}\}/gi, leadName)
    .replace(/\{\{name\}\}/gi, leadName)
    .replace(/\{\{full_name\}\}/gi, leadName);
}

export function SendEmailModal({ open, onClose, leadId, leadName, leadEmail, replyTo }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: templates = [] } = useEmailTemplates();
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const form = useForm<EmailForm>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      to_email: leadEmail || "",
      subject: "",
      body_html: "",
      schedule_follow_up: false,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (leadEmail) form.setValue("to_email", leadEmail);
    if (replyTo?.subject) {
      const base = replyTo.subject.replace(/^Re:\s*/i, "");
      form.setValue("subject", `Re: ${base}`);
    } else {
      form.setValue("subject", "");
    }
    form.setValue("body_html", "");
    form.setValue("template_id", undefined);
    form.setValue("schedule_follow_up", false);
    setShowPreview(false);
  }, [open, leadEmail, replyTo, form]);

  const watchFollowUp = form.watch("schedule_follow_up");
  const watchTemplateId = form.watch("template_id");
  const watchBody = form.watch("body_html");

  const applyTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    form.setValue("template_id", templateId);
    if (!replyTo) {
      form.setValue("subject", replaceVariables(tpl.subject, leadName));
    }
    form.setValue("body_html", replaceVariables(tpl.body_html || "", leadName));
  };

  const onSubmit = form.handleSubmit(async (data) => {
    if (!user) return;
    setSaving(true);
    try {
      const { data: logEntry, error: emailErr } = await supabase.from("email_log").insert({
        lead_id: leadId,
        template_id: data.template_id || null,
        to_email: data.to_email,
        subject: data.subject,
        status: "sending",
        in_reply_to: replyTo?.graph_message_id || null,
      }).select("id").single();
      if (emailErr) throw emailErr;

      const { data: result, error: fnErr } = await supabase.functions.invoke(
        "send-pipeline-email",
        {
          body: {
            lead_id: leadId,
            template_id: data.template_id || undefined,
            email_log_id: logEntry.id,
            subject: data.subject,
            body_html: data.body_html,
            in_reply_to: replyTo?.graph_message_id || undefined,
          },
        },
      );

      if (fnErr) {
        await supabase.from("email_log").update({ status: "failed", error_message: fnErr.message || "Error desconocido" }).eq("id", logEntry.id);
        throw new Error(fnErr.message || "Error al enviar email");
      }
      if (result?.error) {
        await supabase.from("email_log").update({ status: "failed", error_message: result.error }).eq("id", logEntry.id);
        throw new Error(result.error);
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
      toast.success("Email enviado desde comercial@kawiil.mx");
      onClose();
      form.reset({ to_email: leadEmail || "", subject: "", body_html: "", schedule_follow_up: false });
      setShowPreview(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al enviar email");
    } finally {
      setSaving(false);
    }
  });

  const activeTemplates = templates.filter((t) => t.is_active);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {replyTo ? "Responder correo" : "Enviar email"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
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

          <div>
            <Label>De</Label>
            <Input value="comercial@kawiil.mx" disabled className="bg-muted text-muted-foreground" />
          </div>

          <div>
            <Label>Para *</Label>
            <Input type="email" {...form.register("to_email")} placeholder="correo@ejemplo.com" />
            {form.formState.errors.to_email && (
              <p className="text-xs text-destructive mt-1">{form.formState.errors.to_email.message}</p>
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
            <div className="flex items-center justify-between mb-1">
              <Label>Contenido *</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
                className="h-6 text-xs"
              >
                <Eye className="h-3 w-3 mr-1" />
                {showPreview ? "Editar" : "Vista previa"}
              </Button>
            </div>
            {showPreview ? (
              <div
                className="border rounded-md p-3 min-h-[120px] text-sm prose prose-sm max-w-none bg-muted/20"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(watchBody || "", { USE_PROFILES: { html: true } }),
                }}
              />
            ) : (
              <Textarea
                rows={6}
                {...form.register("body_html")}
                placeholder="Contenido del email (soporta HTML)…"
              />
            )}
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
              El email se enviará desde <strong>comercial@kawiil.mx</strong> y se
              registrará en el historial del lead. Podrás ver su estado (enviado,
              abierto, click) en la sección de Correos.
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
