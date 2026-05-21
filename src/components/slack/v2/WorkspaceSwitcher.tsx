interface Workspace {
  id: string;
  name: string;
  initial: string;
  colorClass: string;
  unread?: number;
  isActive: boolean;
}

interface Props {
  workspaces: Workspace[];
  onSelect: (id: string) => void;
}

export function WorkspaceSwitcher({ workspaces, onSelect }: Props) {
  return (
    <div className="sl-workspaces">
      {workspaces.map((ws, i) => (
        <div key={ws.id}>
          {i > 0 && i === 1 && <div className="sl-ws-sep" />}
          <div
            className={`sl-ws sl-ws-${ws.colorClass} ${ws.isActive ? "active" : ""}`}
            title={ws.name}
            onClick={() => onSelect(ws.id)}
          >
            {ws.initial}
            {(ws.unread ?? 0) > 0 && (
              <span className="dot-unread">{(ws.unread ?? 0) > 99 ? "99+" : ws.unread}</span>
            )}
          </div>
        </div>
      ))}

      <div className="sl-ws-add" title="Añadir workspace">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
      </div>
    </div>
  );
}
