import { useMemo, useState } from "react";
import {
  useProjectTeam,
  useAddProjectTeamMember,
  useRemoveProjectTeamMember,
  useUpdateProjectTeamMember,
  PROJECT_TEAM_ROLE_LABELS,
  type ProjectTeamRole,
} from "@/hooks/useProjectTeam";
import { useProfiles } from "@/hooks/useTasks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Users, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  /** Modo "compact" para usar en sidebar; "full" para usar dentro de la pestaña General. */
  variant?: "compact" | "full";
}

const ROLE_BADGE_CLASS: Record<ProjectTeamRole, string> = {
  lead: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  senior: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  revision: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  junior: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  colaborador: "bg-muted text-muted-foreground",
};

export function ProjectTeamCard({ projectId, variant = "full" }: Props) {
  const { data: team = [], isLoading } = useProjectTeam(projectId);
  const { data: profiles = [] } = useProfiles();
  const addMember = useAddProjectTeamMember();
  const updateMember = useUpdateProjectTeamMember();
  const removeMember = useRemoveProjectTeamMember();
  const [adding, setAdding] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<ProjectTeamRole>("colaborador");

  const candidates = useMemo(() => {
    const taken = new Set(team.map((m) => m.user_id));
    return profiles
      .filter((p) => !taken.has(p.user_id))
      .map((p) => ({ value: p.user_id, label: p.full_name || p.email || p.user_id }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [team, profiles]);

  const compact = variant === "compact";

  const submitAdd = () => {
    if (!pendingUserId) return;
    addMember.mutate(
      { projectId, userId: pendingUserId, role: pendingRole },
      {
        onSuccess: () => {
          setAdding(false);
          setPendingUserId(null);
          setPendingRole("colaborador");
        },
      },
    );
  };

  const body = (
    <div className={cn("space-y-2", compact ? "text-xs" : "text-sm")}>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Cargando equipo…</p>
      ) : team.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Sin miembros explícitos. Agrega Lead, Senior, Revisión, Junior o Colaboradores.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {team.map((m) => {
            const name = m.profile?.full_name || m.profile?.email || m.user_id;
            return (
              <li key={m.id} className="flex items-center gap-2 group">
                <UserAvatar
                  name={m.profile?.full_name}
                  email={m.profile?.email}
                  avatarUrl={m.profile?.avatar_url}
                  userId={m.user_id}
                  size={compact ? "sm" : "md"}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{name}</p>
                  {!compact && m.profile?.email && (
                    <p className="truncate text-[10px] text-muted-foreground">
                      {m.profile.email}
                    </p>
                  )}
                </div>
                <Select
                  value={m.role}
                  onValueChange={(v) =>
                    updateMember.mutate({ id: m.id, role: v as ProjectTeamRole, projectId })
                  }
                >
                  <SelectTrigger
                    className={cn(
                      "h-7 px-2 text-[10px] font-semibold uppercase tracking-wider w-[110px] border-0",
                      ROLE_BADGE_CLASS[m.role],
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROJECT_TEAM_ROLE_LABELS) as ProjectTeamRole[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {PROJECT_TEAM_ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => removeMember.mutate({ id: m.id, projectId })}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  aria-label="Quitar miembro"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <div className="space-y-2 rounded-md border border-dashed p-2">
          <SearchableSelect
            options={candidates}
            value={pendingUserId || ""}
            onValueChange={(uid) => setPendingUserId(uid || null)}
            placeholder="Buscar persona…"
            searchPlaceholder="Buscar…"
            className="h-8 w-full text-xs"
          />
          <div className="flex items-center gap-1.5">
            <Select value={pendingRole} onValueChange={(v) => setPendingRole(v as ProjectTeamRole)}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROJECT_TEAM_ROLE_LABELS) as ProjectTeamRole[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {PROJECT_TEAM_ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8"
              disabled={!pendingUserId || addMember.isPending}
              onClick={submitAdd}
            >
              Agregar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => {
                setAdding(false);
                setPendingUserId(null);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 w-full"
          onClick={() => setAdding(true)}
          disabled={candidates.length === 0}
        >
          <Plus className="h-3 w-3" />
          {candidates.length === 0 ? "Sin personas disponibles" : "Agregar miembro"}
        </Button>
      )}
    </div>
  );

  if (compact) {
    return (
      <section className="rounded-lg border bg-background p-3 space-y-2.5">
        <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Users className="h-3 w-3" /> Equipo del proyecto
          {team.length > 0 && <span className="ml-auto text-[10px] font-normal">{team.length}</span>}
        </h5>
        {body}
      </section>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> Equipo del proyecto
          {team.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({team.length})</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
