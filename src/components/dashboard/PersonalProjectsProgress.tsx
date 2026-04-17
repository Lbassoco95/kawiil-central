import { useNavigate } from "react-router-dom";
import { Progress } from "@/components/ui/progress";
import { FolderKanban, ArrowRight } from "lucide-react";
import { SERVICE_LABELS } from "@/lib/serviceLabels";
import type { MyActiveProjectProgressRow } from "@/hooks/useMyActiveProjectsProgress";

export function PersonalProjectsProgress({
  rows,
  title = "Tus proyectos activos (como responsable)",
  compact = false,
}: {
  rows: MyActiveProjectProgressRow[] | undefined;
  title?: string;
  compact?: boolean;
}) {
  const navigate = useNavigate();

  return (
    <div>
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
        <FolderKanban className="h-3.5 w-3.5" />
        {title}
      </h3>
      {!rows?.length ? (
        <p className="text-sm text-muted-foreground leading-relaxed">
          No tienes proyectos activos como responsable. Cuando te asignen uno, aquí verás el avance del flujo
          (pasos del proyecto) y de las tareas del tablero vinculadas.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => navigate(`/proyectos/${r.id}`)}
                className="w-full text-left rounded-xl border border-border/60 bg-card/30 hover:bg-secondary/25 hover:border-border transition-colors px-3 py-2.5 group"
                style={{ animationDelay: compact ? "0ms" : `${Math.min(i, 6) * 40}ms`, animationFillMode: "both" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {r.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {r.clientName ? `${r.clientName} · ` : ""}
                      {r.area ? ((SERVICE_LABELS as Record<string, string>)[r.area] || r.area) : "Sin área"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className={`text-xs font-semibold tabular-nums ${
                        r.primaryPct >= 75 ? "text-accent" : r.primaryPct >= 40 ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {r.primaryTotal > 0 ? `${r.primaryPct}%` : "—"}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  {r.primaryLabel}
                  {r.primaryTotal > 0 ? ` · ${r.primaryDone}/${r.primaryTotal}` : ""}
                </p>
                {r.primaryTotal > 0 && (
                  <Progress value={r.primaryPct} className="h-1.5 mt-2" />
                )}
                {!compact && r.taskTotal > 0 && r.primaryKind !== "tareas" && (
                  <p className="text-[10px] text-muted-foreground/90 mt-2">
                    Tareas del tablero: {r.taskDone}/{r.taskTotal} ({r.taskPct}%)
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
