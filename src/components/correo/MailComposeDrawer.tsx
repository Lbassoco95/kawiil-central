import { useState, useRef } from "react";
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
            <input
              placeholder="destinatario@empresa.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              autoFocus={open}
            />
            <button
              onClick={() => setShowCc((p) => !p)}
              style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", background: "transparent", border: 0, cursor: "pointer" }}
            >
              CC
            </button>
          </div>

          {showCc && (
            <div className="mc-field">
              <span className="mc-field-label">CC</span>
              <input
                placeholder="copia@empresa.com"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
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
          <button className="mc-fmt-btn" title="Mejorar con AI" style={{ color: "hsl(280 80% 55%)" }}>
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
