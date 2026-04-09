import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserRound, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type TeamProfile = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
};

function initials(name: string | null | undefined, userId: string): string {
  const n = (name || "").trim();
  if (!n) return userId.slice(0, 2).toUpperCase();
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

function PersonChip({
  profile,
  userId,
  highlight,
}: {
  profile: TeamProfile | undefined;
  userId: string;
  highlight?: boolean;
}) {
  const label = profile?.full_name?.trim() || "Usuario";
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left",
        highlight
          ? "border-primary/35 bg-primary/10"
          : "border-border/60 bg-background/40"
      )}
    >
      <Avatar className="h-7 w-7">
        {profile?.avatar_url ? (
          <AvatarImage src={profile.avatar_url} alt="" />
        ) : null}
        <AvatarFallback className="text-[10px] font-medium">{initials(profile?.full_name, userId)}</AvatarFallback>
      </Avatar>
      <span className="text-xs font-medium leading-tight truncate max-w-[140px] sm:max-w-[180px]">{label}</span>
    </div>
  );
}

type Props = {
  responsibleHeading: string;
  responsibleUserId: string | null | undefined;
  profilesByUserId: Map<string, TeamProfile>;
  collaboratorUserIds: string[];
  secondaryHeading?: string;
  secondaryUserId?: string | null;
  className?: string;
  collaboratorsLoading?: boolean;
  collaboratorsEmptyHint?: string;
};

export function TeamVisibilityBanner({
  responsibleHeading,
  responsibleUserId,
  profilesByUserId,
  collaboratorUserIds,
  secondaryHeading,
  secondaryUserId,
  className,
  collaboratorsLoading,
  collaboratorsEmptyHint = "No hay otras personas asignadas en tareas abiertas ni como colaboradores adicionales en esas tareas.",
}: Props) {
  const responsibleProfile = responsibleUserId ? profilesByUserId.get(responsibleUserId) : undefined;
  const secondaryProfile = secondaryUserId ? profilesByUserId.get(secondaryUserId) : undefined;
  const showSecondary =
    secondaryHeading &&
    secondaryUserId &&
    secondaryUserId !== responsibleUserId;

  return (
    <div
      className={cn(
        "mt-4 pt-4 border-t border-border/50 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-8 sm:gap-y-3",
        className
      )}
    >
      <div className="space-y-1.5 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <UserRound className="h-3 w-3" />
          {responsibleHeading}
        </p>
        {responsibleUserId ? (
          <PersonChip profile={responsibleProfile} userId={responsibleUserId} highlight />
        ) : (
          <p className="text-xs text-muted-foreground">Sin asignar — define responsable en Editar.</p>
        )}
      </div>

      {showSecondary && (
        <div className="space-y-1.5 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <UserRound className="h-3 w-3" />
            {secondaryHeading}
          </p>
          <PersonChip profile={secondaryProfile} userId={secondaryUserId!} />
        </div>
      )}

      <div className="space-y-1.5 min-w-0 flex-1 sm:min-w-[200px]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Users className="h-3 w-3" />
          Colaboradores en curso
        </p>
        {collaboratorsLoading ? (
          <p className="text-xs text-muted-foreground">Cargando…</p>
        ) : collaboratorUserIds.length === 0 ? (
          <p className="text-xs text-muted-foreground">{collaboratorsEmptyHint}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {collaboratorUserIds.map((uid) => (
              <PersonChip key={uid} profile={profilesByUserId.get(uid)} userId={uid} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
