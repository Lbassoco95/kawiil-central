import { useState, useCallback, useEffect } from "react";
import { MailList } from "./MailList";
import { MailSidebar } from "./MailSidebar";
import { MailContactPanel } from "./MailContactPanel";
import { MailPreviewPanel } from "./MailPreviewPanel";
import { MailReadingOverlay } from "./MailReadingOverlay";
import { MailFoldersSheet } from "./MailFoldersSheet";
import { MailRulesSheet } from "./MailRulesSheet";
import { ComposeEmailDialog } from "@/components/microsoft/ComposeEmailDialog";
import { CreateMailRuleDialog } from "@/components/microsoft/CreateMailRuleDialog";
import { SendEmailToSlackDialog } from "@/components/microsoft/SendEmailToSlackDialog";
import { CreateEventFromEmailDialog } from "./CreateEventFromEmailDialog";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { MailTranslateDrawer } from "./MailTranslateDrawer";
import { type MailTabId } from "./MailTabs";
import { useMailFolders, useMarkEmailRead, useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { useMarkLinkedOutlookEmailRead, useMarkGmailRead, useRoutedEmailDetail } from "@/hooks/useLinkedAccounts";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface EmailShape {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  importance?: string;
}

interface ForwardState {
  subject: string;
  bodyHtml: string;
  /** Destinatario precargado (respuesta). Vacío en reenviar. */
  to?: string;
  /** Copia precargada (responder a todos). */
  cc?: string;
  /** Id del correo original (solo cuenta principal): envía como respuesta y se engancha al hilo. */
  replyMessageId?: string;
  /** Responder a todos (para el borrador de respuesta de Graph). */
  replyAll?: boolean;
}

/** Los ids de la cuenta principal no llevan prefijo "outlook:"/"gmail:" (esos son cuentas vinculadas). */
function isPrimaryMessageId(id: string | null): boolean {
  return !!id && !id.startsWith("outlook:") && !id.startsWith("gmail:");
}

export function CorreoView() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<MailTabId>("inbox");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  // Correo ya cargado en la lista: alimenta la vista previa al instante (metadatos + snippet)
  // mientras se descarga el cuerpo completo, para que la previsualización no se sienta lenta.
  const [selectedEmailSeed, setSelectedEmailSeed] = useState<Record<string, unknown> | null>(null);
  const [readingOpen, setReadingOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [forwardState, setForwardState] = useState<ForwardState | null>(null);
  const [taskEmail, setTaskEmail] = useState<EmailShape | null>(null);
  const [translateEmail, setTranslateEmail] = useState<EmailShape | null>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [ruleSenderEmail, setRuleSenderEmail] = useState("");
  const [ruleSenderName, setRuleSenderName] = useState("");
  const [customFolderOverride, setCustomFolderOverride] = useState<string | null>(null);
  const [customFolderName, setCustomFolderName] = useState<string | null>(null);
  const [activeLabelId, setActiveLabelId] = useState<string | null>(null);
  const [slackEmailOpen, setSlackEmailOpen] = useState(false);
  const [eventFromEmailOpen, setEventFromEmailOpen] = useState(false);

  const { data: foldersQueryData } = useMailFolders();
  const folders = (foldersQueryData?.folders ?? []) as { id: string; displayName: string }[];
  // Detalle ruteado por prefijo de ID: funciona con la cuenta principal Y las vinculadas
  // (necesario para Reenviar, crear regla, Slack, crear evento desde correos vinculados).
  const { data: selectedEmailDetail } = useRoutedEmailDetail(selectedEmailId);
  const { profile: msProfile } = useMicrosoftConnection();
  const myEmail = ((msProfile?.mail || msProfile?.userPrincipalName || "") as string).toLowerCase();
  const markRead = useMarkEmailRead();
  const markLinkedOutlookRead = useMarkLinkedOutlookEmailRead();
  const markGmailRead = useMarkGmailRead();

  const handleAfterSendTemplate = useCallback(async (info: { templateCategory?: string; clientId?: string; clientName?: string }) => {
    const declarationCategories = ["pagos_provisionales", "declaracion_ceros", "envio_anuales", "previos_provisionales", "isn_imss", "envio_nominas"];
    if (!info.templateCategory || !declarationCategories.includes(info.templateCategory)) return;
    if (!info.clientId) return;
    try {
      const { data: projects } = await supabase.from("projects").select("id").eq("client_id", info.clientId);
      if (!projects?.length) return;
      const now = new Date();
      for (const project of projects) {
        const { data: period } = await supabase
          .from("accounting_periods")
          .select("id, steps")
          .eq("project_id", project.id)
          .eq("year", now.getFullYear())
          .eq("month", now.getMonth() + 1)
          .maybeSingle();
        if (!period) continue;
        const steps = period.steps as Array<{ key: string; completed: boolean; label: string }>;
        const step = steps.find((s) => s.key === "envio_acuses");
        if (!step || step.completed) continue;
        toast.success(`Plantilla enviada a ${info.clientName || "cliente"}. ¿Marcar "${step.label}" como completado?`, {
          action: {
            label: "Marcar completo",
            onClick: async () => {
              const updatedSteps = steps.map((s) =>
                s.key === "envio_acuses"
                  ? { ...s, completed: true, completed_at: new Date().toISOString(), completed_by: user?.id, step_status: "completado" }
                  : s,
              );
              const { error } = await supabase.from("accounting_periods").update({ steps: updatedSteps as any }).eq("id", period.id);
              if (!error) {
                queryClient.invalidateQueries({ queryKey: ["accounting-periods", project.id] });
                toast.success("Paso marcado como completado");
              }
            },
          },
          duration: 10000,
        });
        break;
      }
    } catch {
      // silent — no interrumpir el flujo de correo
    }
  }, [user?.id, queryClient]);

  const markEmailReadRouted = useCallback((id: string) => {
    // Route mark-read to the correct account based on email ID prefix
    const parts = id.split(":");
    const prefix = parts[0];
    const accountId = parts.length >= 3 ? parts[1] : "";
    if (prefix === "outlook" && accountId) {
      markLinkedOutlookRead.mutate({ accountId, emailId: id });
    } else if (prefix === "gmail" && accountId) {
      markGmailRead.mutate({ accountId, emailId: id });
    } else {
      markRead.mutate(id);
    }
  }, [markRead, markLinkedOutlookRead, markGmailRead]);

  /** Un clic: solo selecciona y previsualiza — NO marca como leído (eso pasa al abrir). */
  const handleSelectEmail = useCallback((id: string, seed?: Record<string, unknown>) => {
    setSelectedEmailId(id);
    setSelectedEmailSeed(seed ?? null);
    setReadingOpen(false);
  }, []);

  /** Doble clic / botón Abrir: vista completa con respuesta; aquí sí se marca como leído. */
  const handleOpenEmail = useCallback((id: string, seed?: Record<string, unknown>) => {
    setSelectedEmailId(id);
    if (seed) setSelectedEmailSeed(seed);
    setReadingOpen(true);
    markEmailReadRouted(id);
  }, [markEmailReadRouted]);

  const handleSelectTab = useCallback((tab: MailTabId) => {
    setActiveTab(tab);
    setSelectedEmailId(null);
    setReadingOpen(false);
    setCustomFolderOverride(null);
    setCustomFolderName(null);
  }, []);

  const handleSelectFolder = useCallback((folderId: string, folderName: string) => {
    setCustomFolderOverride(folderId);
    setCustomFolderName(folderName);
    setSelectedEmailId(null);
    setReadingOpen(false);
    setFoldersOpen(false);
  }, []);

  const handleCreateTask = useCallback((email: EmailShape) => {
    setTaskEmail(email);
  }, []);

  const handleCreateRule = useCallback(() => {
    const email = (selectedEmailDetail as any)?.from?.emailAddress?.address || "";
    const name = (selectedEmailDetail as any)?.from?.emailAddress?.name || "";
    setRuleSenderEmail(email);
    setRuleSenderName(name);
    setRuleDialogOpen(true);
  }, [selectedEmailDetail]);

  const handleForward = useCallback(() => {
    const detail = selectedEmailDetail as any;
    if (!detail) return;
    const origSubject = detail.subject || "(sin asunto)";
    const origFrom = detail.from?.emailAddress?.name || detail.from?.emailAddress?.address || "";
    const origDate = detail.receivedDateTime
      ? new Date(detail.receivedDateTime).toLocaleString("es-MX")
      : "";
    const origBody = detail.body?.content || detail.bodyPreview || "";
    const bodyHtml = `<br/><br/>---------- Mensaje reenviado ----------<br/>
<b>De:</b> ${origFrom}<br/>
<b>Fecha:</b> ${origDate}<br/>
<b>Asunto:</b> ${origSubject}<br/><br/>
${detail.body?.contentType === "html" ? origBody : `<pre style="font-family:inherit">${origBody}</pre>`}`;
    setForwardState({ subject: `Fwd: ${origSubject}`, bodyHtml });
    setComposeOpen(true);
  }, [selectedEmailDetail]);

  const handleReply = useCallback(() => {
    const detail = selectedEmailDetail as any;
    if (!detail) return;
    const origSubject = detail.subject || "(sin asunto)";
    const replyTo =
      detail.replyTo?.[0]?.emailAddress?.address ||
      detail.from?.emailAddress?.address ||
      "";
    // "Re:" sin duplicar si el asunto ya lo trae.
    const subject = /^re:/i.test(origSubject.trim()) ? origSubject : `Re: ${origSubject}`;
    // Respuesta limpia: NO citamos el correo original en el cuerpo (se ve más limpio y se puede
    // minimizar para leerlo). Cuerpo vacío → el redactor coloca la firma automáticamente.
    // replyMessageId (solo cuenta principal) → el envío se engancha al hilo de la conversación.
    const primaryId = isPrimaryMessageId(selectedEmailId) ? selectedEmailId! : undefined;
    setForwardState({ subject, bodyHtml: "", to: replyTo, replyMessageId: primaryId, replyAll: false });
    setComposeOpen(true);
  }, [selectedEmailDetail, selectedEmailId]);

  const handleReplyAll = useCallback(() => {
    const detail = selectedEmailDetail as any;
    if (!detail) return;
    const origSubject = detail.subject || "(sin asunto)";
    const subject = /^re:/i.test(origSubject.trim()) ? origSubject : `Re: ${origSubject}`;
    const addr = (r: any) => r?.emailAddress?.address as string | undefined;
    const senderAddr = detail.replyTo?.[0]?.emailAddress?.address || detail.from?.emailAddress?.address || "";
    const toAddrs = ((detail.toRecipients ?? []) as any[]).map(addr);
    const ccAddrs = ((detail.ccRecipients ?? []) as any[]).map(addr);
    // Para = remitente + destinatarios originales; CC = copiados originales. Sin mí ni duplicados.
    const toSet = new Set<string>();
    [senderAddr, ...toAddrs].forEach((a) => {
      const l = (a || "").toLowerCase();
      if (l && l !== myEmail) toSet.add(a as string);
    });
    const ccSet = new Set<string>();
    ccAddrs.forEach((a) => {
      const l = (a || "").toLowerCase();
      if (l && l !== myEmail && !toSet.has(a as string)) ccSet.add(a as string);
    });
    const primaryId = isPrimaryMessageId(selectedEmailId) ? selectedEmailId! : undefined;
    setForwardState({
      subject,
      bodyHtml: "",
      to: [...toSet].join(", "),
      cc: [...ccSet].join(", "),
      replyMessageId: primaryId,
      replyAll: true,
    });
    setComposeOpen(true);
  }, [selectedEmailDetail, myEmail, selectedEmailId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // No interceptar campos editables (editor de redacción, contenteditable).
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || el?.closest("[contenteditable='true'], input, textarea")) return;
      // Escape siempre cierra la lectura.
      if (e.key === "Escape") { setReadingOpen(false); return; }
      // "Redactar" con la tecla "c" SOLO como atajo simple: si hay Cmd/Ctrl/Alt (copiar, etc.)
      // o hay texto seleccionado, no abrimos redacción para no pisar el copiado del usuario.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((window.getSelection?.()?.toString() ?? "").length > 0) return;
      if (e.key === "c" || e.key === "C") { setForwardState(null); setComposeOpen(true); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex h-full min-h-0 bg-card relative">
      {/* Sidebar */}
      <MailSidebar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onCompose={() => { setForwardState(null); setComposeOpen(true); }}
        onSelectFolder={handleSelectFolder}
        activeCustomFolderId={customFolderOverride ?? undefined}
        activeLabelId={activeLabelId}
        onSelectLabel={(id) => { setActiveLabelId(id); setCustomFolderOverride(null); setCustomFolderName(null); }}
      />

      {/* Left: email list + reading overlay */}
      <div className="relative flex flex-col flex-1 min-w-0 border-r border-border/30 overflow-hidden">
        <MailList
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          selectedEmailId={selectedEmailId}
          onSelectEmail={handleSelectEmail}
          onOpenEmail={handleOpenEmail}
          onCompose={() => { setForwardState(null); setComposeOpen(true); }}
          onOpenFolders={() => setFoldersOpen(true)}
          onOpenRules={() => setRulesOpen(true)}
          onSuggestRule={(senderEmail, senderName) => {
            setRuleSenderEmail(senderEmail);
            setRuleSenderName(senderName);
            setRuleDialogOpen(true);
          }}
          customFolderOverride={customFolderOverride ?? undefined}
          customFolderName={customFolderName ?? undefined}
          onClearCustomFolder={() => { setCustomFolderOverride(null); setCustomFolderName(null); }}
          externalLabelFilter={activeLabelId}
        />
        <MailReadingOverlay
          emailId={selectedEmailId}
          open={readingOpen}
          onClose={() => setReadingOpen(false)}
          onCompose={() => { setForwardState(null); setComposeOpen(true); }}
          onReply={handleReply}
          onReplyAll={handleReplyAll}
          onForward={handleForward}
          onCreateTask={handleCreateTask}
          onCreateRule={handleCreateRule}
          onSendToSlack={() => {
            const sens = (selectedEmailDetail as any)?.sensitivity;
            if (sens === "confidential" || sens === "private") {
              toast.error("Este correo es confidencial y no puede reenviarse a Slack.");
              return;
            }
            setSlackEmailOpen(true);
          }}
          onCreateEvent={() => setEventFromEmailOpen(true)}
        />
      </div>

      {/* Right: vista previa del correo seleccionado; con la vista completa abierta, panel de contacto */}
      <div className="w-[290px] shrink-0 border-l border-border/30 overflow-hidden">
        {selectedEmailId && !readingOpen ? (
          <MailPreviewPanel
            emailId={selectedEmailId}
            seed={selectedEmailSeed}
            onOpen={() => handleOpenEmail(selectedEmailId)}
            onReply={handleReply}
          />
        ) : (
          <MailContactPanel
            emailId={selectedEmailId}
            onAskAI={() => {}}
            onCreateTask={() => selectedEmailDetail && handleCreateTask(selectedEmailDetail as EmailShape)}
            onCreateRule={handleCreateRule}
          />
        )}
      </div>

      {/* Keyboard hint strip — solo sobre la lista de correos; no tapar sidebar (200px) ni panel de contacto */}
      <div className="absolute bottom-0 left-[200px] right-[290px] z-20 flex items-center gap-4 px-4 py-1.5 bg-card/90 backdrop-blur-sm border-t border-border/30 text-[11px] text-muted-foreground/50 pointer-events-none">
        {[
          { key: "C", label: "Redactar" },
          { key: "F", label: "Reenviar" },
          { key: "E", label: "Archivar" },
          { key: "Enter", label: "Abrir" },
          { key: "Esc", label: "Cerrar" },
        ].map(({ key, label }) => (
          <span key={key} className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded text-[10px] bg-muted border border-border/50">{key}</kbd>
            {label}
          </span>
        ))}
      </div>

      {/* Sheets */}
      <MailFoldersSheet
        open={foldersOpen}
        onOpenChange={setFoldersOpen}
        onSelectFolder={handleSelectFolder}
      />
      <MailRulesSheet
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        folders={folders}
        onNewRule={() => { setRulesOpen(false); setRuleDialogOpen(true); }}
      />

      {/* Dialogs */}
      <ComposeEmailDialog
        open={composeOpen}
        onOpenChange={(o) => { setComposeOpen(o); if (!o) setForwardState(null); }}
        initialTo={forwardState?.to}
        initialCc={forwardState?.cc}
        initialSubject={forwardState?.subject}
        initialBodyHtml={forwardState?.bodyHtml}
        replyContext={forwardState?.replyMessageId ? { messageId: forwardState.replyMessageId, replyAll: forwardState.replyAll } : null}
        showAccountingTemplates
        onAfterSend={handleAfterSendTemplate}
      />
      <CreateMailRuleDialog
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        senderEmail={ruleSenderEmail}
        senderName={ruleSenderName}
        folders={folders}
      />
      <TaskFormDialog
        open={!!taskEmail}
        onOpenChange={(o) => { if (!o) setTaskEmail(null); }}
        sourceEmailId={taskEmail?.id || undefined}
        sourceEmailSubject={taskEmail?.subject || undefined}
        sourceEmailFrom={taskEmail?.from?.emailAddress?.address || taskEmail?.from?.emailAddress?.name || undefined}
        defaultTitle={taskEmail?.subject || ""}
        defaultDescription={(() => {
          if (!taskEmail) return "";
          const from = taskEmail.from?.emailAddress;
          const remitente = from?.name || from?.address || "";
          const snippet = (taskEmail.bodyPreview || "").slice(0, 500).trim();
          const partes = [
            remitente ? `Correo de: ${remitente}${from?.address && from?.address !== remitente ? ` <${from.address}>` : ""}` : "",
            taskEmail.subject ? `Asunto: ${taskEmail.subject}` : "",
            snippet ? `\n${snippet}` : "",
          ].filter(Boolean);
          return partes.join("\n");
        })()}
      />
      <MailTranslateDrawer
        open={!!translateEmail}
        email={translateEmail}
        onClose={() => setTranslateEmail(null)}
      />
      <SendEmailToSlackDialog
        open={slackEmailOpen}
        onOpenChange={setSlackEmailOpen}
        subject={(selectedEmailDetail as any)?.subject || ""}
        senderLabel={
          (selectedEmailDetail as any)?.from?.emailAddress?.name ||
          (selectedEmailDetail as any)?.from?.emailAddress?.address ||
          ""
        }
        webLink={(selectedEmailDetail as any)?.webLink ?? null}
      />
      <CreateEventFromEmailDialog
        open={eventFromEmailOpen}
        onOpenChange={setEventFromEmailOpen}
        emailSubject={(selectedEmailDetail as any)?.subject || ""}
        emailFrom={
          (selectedEmailDetail as any)?.from?.emailAddress
            ? {
                email: (selectedEmailDetail as any).from.emailAddress.address || "",
                name: (selectedEmailDetail as any).from.emailAddress.name,
              }
            : null
        }
        emailTo={(((selectedEmailDetail as any)?.toRecipients ?? []) as any[]).map((r: any) => ({
          email: r.emailAddress?.address || "",
          name: r.emailAddress?.name,
        }))}
        emailCc={(((selectedEmailDetail as any)?.ccRecipients ?? []) as any[]).map((r: any) => ({
          email: r.emailAddress?.address || "",
          name: r.emailAddress?.name,
        }))}
        myEmail={user?.email ?? undefined}
      />
    </div>
  );
}
