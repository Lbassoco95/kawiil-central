import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  FolderKanban, Layers, CheckSquare, ExternalLink, ArrowRight,
} from "lucide-react";

interface ProjectPreviewCardProps {
  project: {
    id?: string;
    name: string;
    area?: string;
    status?: string;
    url?: string;
  };
  phases?: { name: string; order?: number }[];
  tasks?: { title: string; phase_name?: string; priority?: string }[];
  tasksCreated?: number;
}

export function ProjectPreviewCard({ project, phases, tasks, tasksCreated }: ProjectPreviewCardProps) {
  const navigate = useNavigate();
  const projectUrl = project.url || (project.id ? `/proyectos/${project.id}` : null);

  return (
    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-4 space-y-3 my-2">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FolderKanban className="h-4.5 w-4.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{project.name}</h4>
          <div className="flex items-center gap-2 mt-1">
            {project.area && <Badge variant="secondary" className="text-[10px]">{project.area}</Badge>}
            {project.status && <Badge variant="outline" className="text-[10px]">{project.status}</Badge>}
          </div>
        </div>
      </div>

      {phases && phases.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
            <Layers className="h-3 w-3" /> {phases.length} fase{phases.length > 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {phases.map((p, i) => (
              <span key={i} className="text-[10px] bg-secondary/60 px-2 py-0.5 rounded-full">
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {tasks && tasks.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
            <CheckSquare className="h-3 w-3" /> {tasksCreated ?? tasks.length} tarea{(tasksCreated ?? tasks.length) > 1 ? "s" : ""} creada{(tasksCreated ?? tasks.length) > 1 ? "s" : ""}
          </p>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {tasks.slice(0, 8).map((t, i) => (
              <div key={i} className="text-[11px] text-muted-foreground flex items-center gap-1.5 pl-1">
                <span className="h-1 w-1 rounded-full bg-muted-foreground/40 shrink-0" />
                <span className="truncate">{t.title}</span>
                {t.priority && t.priority !== "media" && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0">{t.priority}</Badge>
                )}
              </div>
            ))}
            {tasks.length > 8 && (
              <p className="text-[10px] text-muted-foreground/60 pl-3">
                ... y {tasks.length - 8} más
              </p>
            )}
          </div>
        </div>
      )}

      {projectUrl && (
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs gap-1.5 mt-2"
          onClick={() => navigate(projectUrl)}
        >
          <ExternalLink className="h-3 w-3" />
          Ver proyecto
          <ArrowRight className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
