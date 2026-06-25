import { useState } from "react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { UserRound, Users, Check, Pencil, UserPlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type TeamProfile = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
};

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
      <UserAvatar
        name={profile?.full_name}
        avatarUrl={profile?.avatar_url}
        userId={userId}
        size="md"
      />
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
  /** Si se proveen, el chip de responsable se vuelve editable (popover con personas). */
  assignableProfiles?: TeamProfile[];
  onAssignResponsible?: (userId: string) => void;
  assigningResponsible?: boolean;
};

/** Chip de responsable editable: clic → popover con buscador de personas de la org. */
function ResponsiblePicker({
  currentUserId,
  currentProfile,
  profiles,
  onAssign,
  assigning,
}: {
  currentUserId: string | null | undefined;
  currentProfile: TeamProfile | undefined;
  profiles: TeamProfile[];
  onAssign: (userId: string) => void;
  assigning?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = currentProfile?.full_name?.trim() || (currentUserId ? "Usuario" : null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors",
            currentUserId
              ? "border-primary/35 bg-primary/10 hover:bg-primary/15"
              : "border-dashed border-border/70 bg-background/40 hover:bg-muted/60",
          )}
          aria-label={currentUserId ? "Cambiar responsable" : "Asignar responsable"}
        >
          {assigning ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : currentUserId ? (
            <UserAvatar
              name={currentProfile?.full_name}
              avatarUrl={currentProfile?.avatar_url}
              userId={currentUserId}
              size="md"
            />
          ) : (
            <span className="grid h-7 w-7 place-items-center rounded-full bg-muted text-muted-foreground">
              <UserPlus className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="text-xs font-medium leading-tight truncate max-w-[140px] sm:max-w-[180px]">
            {label ?? "Asignar responsable"}
          </span>
          <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar persona…" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {profiles.map((p) => (
                <CommandItem
                  key={p.user_id}
                  value={`${p.full_name ?? ""} ${p.user_id}`}
                  onSelect={() => {
                    onAssign(p.user_id);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} userId={p.user_id} size="sm" />
                  <span className="flex-1 truncate text-xs">{p.full_name?.trim() || "Usuario"}</span>
                  {p.user_id === currentUserId ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

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
  assignableProfiles,
  onAssignResponsible,
  assigningResponsible,
}: Props) {
  const editableResponsible = !!onAssignResponsible && !!assignableProfiles;
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
        {editableResponsible ? (
          <ResponsiblePicker
            currentUserId={responsibleUserId}
            currentProfile={responsibleProfile}
            profiles={assignableProfiles!}
            onAssign={onAssignResponsible!}
            assigning={assigningResponsible}
          />
        ) : responsibleUserId ? (
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
