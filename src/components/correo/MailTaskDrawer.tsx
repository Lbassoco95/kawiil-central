import { useState, useEffect } from "react";
import { X, Sparkles, Calendar, User, Flag, AlignLeft } from "lucide-react";
import { getAvatarGradient, getInitials } from "@/lib/emailChips";
import { useCreateTask } from "@/hooks/useTasks";

interface EmailShape {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
}

interface Props {
  open: boolean;
  email: EmailShape | null;
  onClose: () => void;
}

const PRIORITIES = [
  { id: "urgent",   label: "Urgente", color: "hsl(0 84% 55%)" },
  { id: "high",     label: "Alta",    color: "hsl(38 85% 50%)" },
  { id: "medium",   label: "Media",   color: "hsl(217 91% 55%)" },
  { id: "low",      label: "Baja",    color: "hsl(142 71% 45%)" },
];

export function MailTaskDrawer({ open, email, onClose }: Props) {
  const createTaskMut = useCreateTask();

  const [title, setTitle]         = useState("");
  const [description, setDesc]    = useState("");
  const [dueDate, setDueDate]     = useState("");
  const [priority, setPriority]   = useState("medium");
  const [assignee, setAssignee]   = useState("");
  const [isSaving, setIsSaving]   = useState(false);

  // Prellenar cuando cambia el correo fuente
  useEffect(() => {
    if (!email) return;
    setTitle(email.subject || "");
    setDesc(email.bodyPreview ? email.bodyPreview.slice(0, 300) : "");
    setDueDate("");
    setPriority("medium");
    setAssignee("");
  }, [email]);

  const senderName  = email?.from?.emailAddress?.name || email?.from?.emailAddress?.address || "";
  const senderEmail = email?.from?.emailAddress?.address || "";
  const avatarBg    = getAvatarGradient(senderEmail, senderName);
  const initials    = getInitials(senderName, senderEmail);

  const handleSave = () => {
    if (!title.trim()) return;
    setIsSaving(true);
    createTaskMut.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        due_date: dueDate || undefined,
        priority: priority,
        status: "pending",
      },
      {
        onSuccess: () => {
          setIsSaving(false);
          onClose();
        },
        onError: (err) => {
          console.error("[MailTaskDrawer] Error creando tarea", err);
          setIsSaving(false);
        },
      }
    );
  };

  return (
    <>
      <div
        className={`mt-drawer-backdrop ${open ? "open" : ""}`}
        onClick={onClose}
      />
      <div
        className={`mt-drawer ${open ? "open" : ""}`}
        role="dialog"
        aria-modal
        aria-label="Crear tarea desde correo"
      >
        {/* Encabezado */}
        <div className="mt-head">
          <div className="mt-head-top">
            <span className="mt-ai-badge">
              <Sparkles size={11} /> Kawiil AI
            </span>
            <button className="mt-close" onClick={onClose}><X size={14} /></button>
          </div>
          <div className="mt-title">Crear tarea desde correo</div>

          {/* Correo fuente */}
          {email && (
            <div className="mt-source">
              <span className="mt-source-lbl">Fuente</span>
              <div className="mt-source-mail">
                <div
                  className="mt-source-avatar"
                  style={{ background: avatarBg }}
                >
                  {initials}
                </div>
                <div className="mt-source-info">
                  <div className="mt-source-from">{senderName}</div>
                  <div className="mt-source-subj">{email.subject}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Cuerpo del formulario */}
        <div className="mt-body">
          {/* Título */}
          <div className="mt-field">
            <label className="mt-lbl"><AlignLeft size={12} /> Título</label>
            <input
              className="mt-input"
              placeholder="Nombre de la tarea"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus={open}
            />
          </div>

          {/* Prioridad y Fecha en grid */}
          <div className="mt-grid">
            <div className="mt-field">
              <label className="mt-lbl"><Flag size={12} /> Prioridad</label>
              <select
                className="mt-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                style={{ appearance: "none" }}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="mt-field">
              <label className="mt-lbl"><Calendar size={12} /> Fecha límite</label>
              <input
                className="mt-input"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {/* Asignado */}
          <div className="mt-field">
            <label className="mt-lbl"><User size={12} /> Asignado a</label>
            <input
              className="mt-input"
              placeholder="Nombre o correo"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            />
          </div>

          {/* Descripción */}
          <div className="mt-field">
            <label className="mt-lbl"><AlignLeft size={12} /> Descripción</label>
            <textarea
              className="mt-desc"
              placeholder="Detalle de la tarea…"
              value={description}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-foot">
          <button className="mt-foot-btn ghost" onClick={onClose}>Cancelar</button>
          <button
            className="mt-foot-btn primary"
            onClick={handleSave}
            disabled={!title.trim() || isSaving}
          >
            <Sparkles size={13} />
            {isSaving ? "Guardando…" : "Crear tarea"}
          </button>
        </div>
      </div>
    </>
  );
}
