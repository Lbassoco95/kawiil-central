import { useState } from "react";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TreeNode {
  key: string;
  label: string;
  count?: number;
  children?: TreeNode[];
}

interface DocumentsTreeNavProps {
  nodes: TreeNode[];
  selectedKey?: string | null;
  onSelect: (key: string | null) => void;
  /** Nodo raíz visible (ej. "Documentos"). Si se pasa, aparece como atajo de "limpiar selección". */
  rootLabel?: string;
  className?: string;
}

interface RowProps {
  node: TreeNode;
  level: number;
  selectedKey?: string | null;
  onSelect: (key: string) => void;
}

function TreeRow({ node, level, selectedKey, onSelect }: RowProps) {
  const [open, setOpen] = useState<boolean>(level === 0);
  const hasChildren = !!node.children && node.children.length > 0;
  const active = selectedKey === node.key;

  return (
    <div className="text-[12px]">
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        )}
        style={{ paddingLeft: `${level * 12 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground/70 hover:text-foreground"
            aria-label={open ? "Colapsar" : "Expandir"}
          >
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform",
                open ? "rotate-90" : "",
              )}
            />
          </button>
        ) : (
          <span className="inline-block h-5 w-5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.key)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {open && hasChildren ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          ) : (
            <Folder
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                active ? "text-primary" : "text-amber-500/80",
              )}
            />
          )}
          <span className="truncate">{node.label}</span>
        </button>
        {typeof node.count === "number" && node.count > 0 ? (
          <span
            className={cn(
              "ml-auto rounded-full px-1.5 py-0 text-[10px] tabular-nums",
              active ? "bg-primary/15" : "bg-muted/60",
            )}
          >
            {node.count}
          </span>
        ) : null}
      </div>
      {hasChildren && open && (
        <div className="mt-0.5">
          {node.children!.map((child) => (
            <TreeRow
              key={child.key}
              node={child}
              level={level + 1}
              selectedKey={selectedKey}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DocumentsTreeNav({
  nodes,
  selectedKey,
  onSelect,
  rootLabel = "Todo",
  className,
}: DocumentsTreeNavProps) {
  return (
    <aside
      className={cn(
        "rounded-2xl border border-border/60 bg-card/60 p-2 backdrop-blur-sm",
        className,
      )}
      aria-label="Navegación de documentos"
    >
      <div className="px-2 pb-2 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        Carpetas
      </div>
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          "mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors",
          !selectedKey
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        )}
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate">{rootLabel}</span>
      </button>
      <div className="space-y-0.5">
        {nodes.map((n) => (
          <TreeRow
            key={n.key}
            node={n}
            level={0}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        ))}
        {nodes.length === 0 && (
          <p className="px-2 py-3 text-[11px] text-muted-foreground">
            No hay carpetas para mostrar.
          </p>
        )}
      </div>
    </aside>
  );
}
