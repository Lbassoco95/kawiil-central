import { useState, useCallback, useEffect } from "react";
import { MailList } from "./MailList";
import { MailContactPanel } from "./MailContactPanel";
import { MailReadingOverlay } from "./MailReadingOverlay";
import { MailFoldersSheet } from "./MailFoldersSheet";
import { MailRulesSheet } from "./MailRulesSheet";
import { ComposeEmailDialog } from "@/components/microsoft/ComposeEmailDialog";
import { CreateMailRuleDialog } from "@/components/microsoft/CreateMailRuleDialog";
import { MailTaskDrawer } from "./MailTaskDrawer";
import { MailTranslateDrawer } from "./MailTranslateDrawer";
import { type MailTabId } from "./MailTabs";
import { useEmailDetail, useMailFolders, useMarkEmailRead } from "@/hooks/useMicrosoft";

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
}

export function CorreoView() {
  const [activeTab, setActiveTab] = useState<MailTabId>("inbox");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
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

  const { data: foldersQueryData } = useMailFolders();
  const folders = (foldersQueryData?.folders ?? []) as { id: string; displayName: string }[];
  const { data: selectedEmailDetail } = useEmailDetail(selectedEmailId);
  const markRead = useMarkEmailRead();

  const handleSelectEmail = useCallback((id: string) => {
    setSelectedEmailId(id);
    setReadingOpen(true);
    // Auto-mark as read when opening
    markRead.mutate(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "c" || e.key === "C") { setForwardState(null); setComposeOpen(true); }
      if (e.key === "Escape") setReadingOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex h-full min-h-0 bg-card relative">
      {/* Left: email list + reading overlay */}
      <div className="relative flex flex-col flex-1 min-w-0 border-r border-border/30 overflow-hidden">
        <MailList
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          selectedEmailId={selectedEmailId}
          onSelectEmail={handleSelectEmail}
          onCompose={() => { setForwardState(null); setComposeOpen(true); }}
          onOpenFolders={() => setFoldersOpen(true)}
          onOpenRules={() => setRulesOpen(true)}
          customFolderOverride={customFolderOverride ?? undefined}
          customFolderName={customFolderName ?? undefined}
          onClearCustomFolder={() => { setCustomFolderOverride(null); setCustomFolderName(null); }}
        />
        <MailReadingOverlay
          emailId={selectedEmailId}
          open={readingOpen}
          onClose={() => setReadingOpen(false)}
          onCompose={() => { setForwardState(null); setComposeOpen(true); }}
          onForward={handleForward}
          onCreateTask={handleCreateTask}
          onCreateRule={handleCreateRule}
        />
      </div>

      {/* Right: contact panel */}
      <div className="w-[290px] shrink-0 border-l border-border/30 overflow-hidden">
        <MailContactPanel
          emailId={selectedEmailId}
          onAskAI={() => {}}
          onCreateTask={() => selectedEmailDetail && handleCreateTask(selectedEmailDetail as EmailShape)}
          onCreateRule={handleCreateRule}
        />
      </div>

      {/* Keyboard hint strip */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-4 px-4 py-1.5 bg-card/90 backdrop-blur-sm border-t border-border/30 text-[11px] text-muted-foreground/50 pointer-events-none">
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
        initialSubject={forwardState?.subject}
        initialBodyHtml={forwardState?.bodyHtml}
        showAccountingTemplates
      />
      <CreateMailRuleDialog
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        senderEmail={ruleSenderEmail}
        senderName={ruleSenderName}
        folders={folders}
      />
      <MailTaskDrawer
        open={!!taskEmail}
        email={taskEmail}
        onClose={() => setTaskEmail(null)}
      />
      <MailTranslateDrawer
        open={!!translateEmail}
        email={translateEmail}
        onClose={() => setTranslateEmail(null)}
      />
    </div>
  );
}
