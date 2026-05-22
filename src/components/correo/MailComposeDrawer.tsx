import { useState, useRef, useEffect, useMemo } from "react";
import {
  X,
  Minimize2,
  Bold,
  Italic,
  Underline,
  Link,
  List,
  Paperclip,
  Send,
  Sparkles,
} from "lucide-react";
import { useSendNewEmail } from "@/hooks/useMicrosoft";
import { QUICK_DRAFT_TEMPLATES } from "@/components/microsoft/emailComposeAiShared";
import { ComposeRecipientInput } from "@/components/microsoft/ComposeRecipientInput";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useMailDirectoryContacts, useSyncMailDirectory } from "@/hooks/useMailDirectory";

interface Props {
  open: boolean;
  onClose: () => void;
  defaultTo?: string;
  defaultSubject?: string;
  defaultBody?: string;
}

export function MailComposeDrawer({
  open,
  onClose,
  defaultTo = "",
  defaultSubject = "",
  defaultBody = "",
}: Props) {
  const [to, setTo]         = useState(defaultTo);
  const [cc, setCc]         = useState("");
  const [subject, setSubj]  = useState(defaultSubject);
  const [body, setBody]     = useState(defaultBody);
  const [showCc, setShowCc] = useState(false);
  const sendMut             = useSendNewEmail();
  const bodyRef             = useRef<HTMLTextAreaElement>(null);

  const { data: orgUsers = [] }     = useOrgUsers();
  const { data: mailContacts = [] } = useMailDirectoryContacts(open);
  const syncDir                     = useSyncMailDirectory();

  const teamEmailLowerSet = useMemo(
    () => new Set(orgUsers.map((u) => (u.email || "").toLowerCase())),
    [orgUsers]
  );

  // Sincronizar directorio en silencio cada vez que se abre el drawer
  useEffect(() => {
    if (open) syncDir.mutate({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSend = () => {
    if (!to.trim() || !subject.trim()) return;
    sendMut.mutate(
      {
        to: to.split(/[,;]/).map((e) => e.trim()).filter(Boolean),
        cc: cc ? cc.split(/[,;]/).map((e) => e.trim()).filter(Boolean) : [],
        subject,
        bodyHtml: `<p>${body.replace(/\n/g, "</p><p>")}</p>`,
      },
      {
        onSuccess: () => {
          onClose();
          setTo(""); setCc(""); setSubj(""); setBody("");
        },
      }
    );
  };

  return (
    <>
      <div
        className={`mail-compose-backdrop ${open ? "open" : ""}`}
        onClick={onClose}
      />
      <div className={`mail-compose ${open ? "open" : ""}`} role="dialog" aria-modal aria-label="Nuevo correo">
        {/* Encabezado */}
        <div className="mc-head">
          <span className="mc-title">Nuevo correo</span>
          <button className="mc-head-btn" onClick={onClose} title="Minimizar">
            <Minimize2 size={14} />
          </button>
          <button className="mc-head-btn" onClick={onClose} title="Cerrar">
            <X size={14} />
          </button>
        </div>

        {/* Campos */}
        <div className="mc-fields">
          <div className="mc-field">
            <span className="mc-field-label">Para</span>
            <ComposeRecipientInput
              value={to}
              onChange={setTo}
              placeholder="destinatario@empresa.com"
              orgUsers={orgUsers}
              mailContacts={mailContacts}
              teamEmailLowerSet={teamEmailLowerSet}
              inputClassName="mc-field-input"
            />
            <button
              onClick={() => setShowCc((p) => !p)}
              style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", background: "transparent", border: 0, cursor: "pointer", flexShrink: 0 }}
            >
              CC
            </button>
          </div>

          {showCc && (
            <div className="mc-field">
              <span className="mc-field-label">CC</span>
              <ComposeRecipientInput
                value={cc}
                onChange={setCc}
                placeholder="copia@empresa.com"
                orgUsers={orgUsers}
                mailContacts={mailContacts}
                teamEmailLowerSet={teamEmailLowerSet}
                inputClassName="mc-field-input"
              />
            </div>
          )}

          <div className="mc-field">
            <span className="mc-field-label">Asunto</span>
            <input
              placeholder="Asunto del correo"
              value={subject}
              onChange={(e) => setSubj(e.target.value)}
            />
          </div>
        </div>

        {/* Cuerpo */}
        <div className="mc-body">
          {/* Chips de plantillas AI */}
          <div className="mp-reply-templates">
            <span className="mp-tpl-label">Plantillas:</span>
            {QUICK_DRAFT_TEMPLATES.map((tpl) => (
              <button key={tpl.id} className="mp-tpl-chip" onClick={() => setBody(tpl.instruction)}>
                <tpl.icon size={10} /> {tpl.label}
              </button>
            ))}
          </div>
          <textarea
            ref={bodyRef}
            placeholder="Escribe tu mensaje aquí…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        {/* Toolbar inferior */}
        <div className="mc-toolbar">
          <button className="mc-fmt-btn" title="Negrita"><Bold size={13} /></button>
          <button className="mc-fmt-btn" title="Cursiva"><Italic size={13} /></button>
          <button className="mc-fmt-btn" title="Subrayado"><Underline size={13} /></button>
          <button className="mc-fmt-btn" title="Enlace"><Link size={13} /></button>
          <button className="mc-fmt-btn" title="Lista"><List size={13} /></button>
          <button className="mc-fmt-btn" title="Adjuntar"><Paperclip size={13} /></button>
          <button className="mc-fmt-btn" title="Mejorar con AI" style={{ color: "hsl(var(--primary))" }}>
            <Sparkles size={13} />
          </button>

          <div className="mc-send-row">
            <button
              className="mc-send-btn"
              onClick={handleSend}
              disabled={!to.trim() || !subject.trim() || sendMut.isPending}
            >
              <Send size={13} />
              {sendMut.isPending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
