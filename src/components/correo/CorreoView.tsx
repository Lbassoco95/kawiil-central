import { useState, useCallback } from "react";
import { MailList } from "./MailList";
import { MailContactPanel } from "./MailContactPanel";
import { MailReadingOverlay } from "./MailReadingOverlay";
import { ComposeEmailDialog } from "@/components/microsoft/ComposeEmailDialog";
import { MailTaskDrawer } from "./MailTaskDrawer";
import { MailTranslateDrawer } from "./MailTranslateDrawer";
import { type MailTabId } from "./MailTabs";

interface EmailShape {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  importance?: string;
}

export function CorreoView() {
  const [activeTab, setActiveTab] = useState<MailTabId>("inbox");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [readingOpen, setReadingOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [taskEmail, setTaskEmail] = useState<EmailShape | null>(null);
  const [translateEmail, setTranslateEmail] = useState<EmailShape | null>(null);

  const handleSelectEmail = useCallback((id: string) => {
    setSelectedEmailId(id);
    setReadingOpen(true);
  }, []);

  const handleSelectTab = useCallback((tab: MailTabId) => {
    setActiveTab(tab);
    setSelectedEmailId(null);
    setReadingOpen(false);
  }, []);

  const handleCreateTask = useCallback((email: EmailShape) => {
    setTaskEmail(email);
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
        />
        <MailReadingOverlay
          emailId={selectedEmailId}
          open={readingOpen}
          onClose={() => setReadingOpen(false)}
          onCompose={() => setComposeOpen(true)}
          onCreateTask={handleCreateTask}
        />
      </div>

      {/* Right: contact panel */}
      <div className="w-[290px] shrink-0 border-l border-border/30 overflow-hidden">
        <MailContactPanel
          emailId={selectedEmailId}
          onAskAI={() => {/* TODO */}}
        />
      </div>

      {/* Keyboard hint strip */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-4 px-4 py-1.5 bg-card/90 backdrop-blur-sm border-t border-border/30 text-[11px] text-muted-foreground/50 pointer-events-none">
        {[
          { key: "C", label: "Redactar" },
          { key: "R", label: "Responder" },
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

      {/* Dialogs */}
      <ComposeEmailDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        showAccountingTemplates
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
