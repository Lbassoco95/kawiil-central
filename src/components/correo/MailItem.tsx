import { Paperclip } from "lucide-react";
import {
  getAvatarGradient,
  getInitials,
  inferEmailChips,
  formatEmailDate,
  emailListTimestamp,
} from "@/lib/emailChips";

interface Props {
  email: Record<string, unknown>;
  isActive: boolean;
  onClick: () => void;
}

export function MailItem({ email, isActive, onClick }: Props) {
  const from = email.from as { emailAddress?: { name?: string; address?: string } } | undefined;
  const senderName = from?.emailAddress?.name || from?.emailAddress?.address || "Sin remitente";
  const senderEmail = from?.emailAddress?.address || "";
  const subject = (email.subject as string) || "(sin asunto)";
  const bodyPreview = (email.bodyPreview as string) || "";
  const unread = !(email.isRead as boolean);
  const hasAttachments = !!(email.hasAttachments as boolean);
  const ts = emailListTimestamp({
    receivedDateTime: email.receivedDateTime as string | undefined,
    sentDateTime: email.sentDateTime as string | undefined,
    createdDateTime: email.createdDateTime as string | undefined,
  });

  const chips = inferEmailChips({
    from: email.from as { emailAddress?: { address?: string } },
    subject: email.subject as string | undefined,
    importance: email.importance as string | undefined,
  });

  const avatarBg = getAvatarGradient(senderEmail, senderName);
  const initials = getInitials(senderName, senderEmail);
  const timeLabel = formatEmailDate(ts);

  return (
    <div
      className={["mail-item", isActive ? "active" : "", unread ? "unread" : ""].filter(Boolean).join(" ")}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      {/* Avatar */}
      <div
        className="mi-avatar"
        style={{ background: avatarBg }}
        aria-hidden
      >
        {initials}
      </div>

      {/* Cuerpo */}
      <div className="mi-body">
        <div className="mi-row1">
          <span className="mi-from">{senderName}</span>
          <span className="mi-time">{timeLabel}</span>
        </div>
        <div className="mi-subj">{subject}</div>
        {bodyPreview && bodyPreview !== "…" && (
          <div className="mi-preview">{bodyPreview}</div>
        )}
        {chips.length > 0 && (
          <div className="mi-chips">
            {chips.map((chip) => (
              <span key={chip.label} className={`mi-chip ${chip.tone}`}>
                {chip.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Meta derecha */}
      {hasAttachments && (
        <div className="mi-meta-right">
          <span className="mi-attach">
            <Paperclip size={11} />
          </span>
        </div>
      )}
    </div>
  );
}
