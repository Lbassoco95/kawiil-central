import type { ReactNode } from "react";
import { GlassPanel, KwButton } from "../design/primitives";

export default function DemoModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="kw-more-panel" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <GlassPanel tone="strong" className="kw-modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="kw-title">{title}</h2>
          <KwButton variant="text" onClick={onClose}>
            Cerrar
          </KwButton>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </GlassPanel>
    </div>
  );
}
