import { useState, useCallback } from "react";
import { MailFolders }         from "./MailFolders";
import { MailList }            from "./MailList";
import { MailPreview }         from "./MailPreview";
import { ComposeEmailDialog } from "@/components/microsoft/ComposeEmailDialog";
import { MailTaskDrawer }      from "./MailTaskDrawer";
import { MailTranslateDrawer } from "./MailTranslateDrawer";

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
  // ── Estado global del módulo ──────────────────────────────────
  const [selectedFolderId, setSelectedFolderId] = useState("inbox");
  const [selectedEmailId,  setSelectedEmailId]  = useState<string | null>(null);

  // ── Drawers ───────────────────────────────────────────────────
  const [composeOpen,    setComposeOpen]    = useState(false);
  const [taskEmail,      setTaskEmail]      = useState<EmailShape | null>(null);
  const [translateEmail, setTranslateEmail] = useState<EmailShape | null>(null);

  // ── Handlers ─────────────────────────────────────────────────
  const handleSelectFolder = useCallback((id: string) => {
    setSelectedFolderId(id);
    setSelectedEmailId(null);
  }, []);

  const handleSelectEmail = useCallback((id: string) => {
    setSelectedEmailId(id);
  }, []);

  const handleCreateTask = useCallback((email: EmailShape) => {
    setTaskEmail(email);
  }, []);

  const handleTranslate = useCallback((email: EmailShape) => {
    setTranslateEmail(email);
  }, []);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="mail-layout" style={{ flex: 1, minHeight: 0 }}>
        {/* Columna 1 — Carpetas */}
        <MailFolders
          selectedFolderId={selectedFolderId}
          onSelectFolder={handleSelectFolder}
          onCompose={() => setComposeOpen(true)}
        />

        {/* Columna 2 — Lista */}
        <MailList
          folderId={selectedFolderId}
          selectedEmailId={selectedEmailId}
          onSelectEmail={handleSelectEmail}
        />

        {/* Columna 3 — Preview */}
        <MailPreview
          emailId={selectedEmailId}
          onCompose={() => setComposeOpen(true)}
          onCreateTask={handleCreateTask}
          onTranslate={handleTranslate}
        />
      </div>

      {/* Drawers (fuera del grid para no romper layout) */}
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
