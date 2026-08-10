import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Users, Building2, FolderKanban, ArrowRight } from "lucide-react";
import { gradoLabel, gradoBadgeClass, GRADO_CONFIG, type AppGrado } from "@/lib/gradoLabels";
import { SERVICE_LABELS } from "@/lib/serviceLabels";

const PUBLIC_ANSWER_LABELS: Record<string, string> = {
  hobbies: "Hobbies",
  deporte: "Deporte / actividad",
  equipo_artista: "Equipo / artista favorito",
  figuras_inspiradoras: "Figuras inspiradoras",
  obra_favorita: "Obra favorita",
  meta_anio: "Meta de este año",
};

type MemberPrefs = {
  user_id: string;
  answers: Record<string, unknown>;
  public_answers: string[];
};

type ClientRef = { id: string; name: string };
type ProjectRef = {
  id: string;
  name: string;
  areaLabel: string;
  clientName: string;
  status: string;
};

export function TeamDirectory() {
  const navigate = useNavigate();
  const { data: orgUsers = [], isLoading } = useOrgUsers();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const activeMembers = useMemo(
    () => orgUsers.filter((u) => u.is_active && u.invitation_accepted),
    [orgUsers],
  );

  const userIds = useMemo(() => activeMembers.map((u) => u.user_id), [activeMembers]);

  const { data: prefsMap } = useQuery<Record<string, MemberPrefs>>({
    queryKey: ["team-directory-prefs", userIds.join(",")],
    queryFn: async () => {
      if (userIds.length === 0) return {};
      const { data } = await supabase
        .from("user_preferences")
        .select("user_id, answers, public_answers")
        .in("user_id", userIds);
      if (!data) return {};
      const map: Record<string, MemberPrefs> = {};
      for (const row of data) {
        map[row.user_id] = {
          user_id: row.user_id,
          answers: (row.answers as Record<string, unknown>) ?? {},
          public_answers: (row.public_answers as string[]) ?? [],
        };
      }
      return map;
    },
    enabled: userIds.length > 0,
  });

  // Clientes de los que cada persona es responsable (según la ficha del cliente).
  const clientsByUser = useMemo(() => {
    const map: Record<string, ClientRef[]> = {};
    (clients ?? [])
      .filter((c) => c.status === "activo" && c.responsible_user_id)
      .forEach((c) => {
        const uid = c.responsible_user_id as string;
        (map[uid] ??= []).push({ id: c.id, name: c.name });
      });
    for (const uid of Object.keys(map)) {
      map[uid].sort((a, b) => a.name.localeCompare(b.name, "es"));
    }
    return map;
  }, [clients]);

  // Proyectos de los que cada persona es responsable (excluye cancelados).
  const projectsByUser = useMemo(() => {
    const map: Record<string, ProjectRef[]> = {};
    (projects ?? [])
      .filter((p) => p.status !== "cancelado" && p.responsible_user_id)
      .forEach((p) => {
        const uid = p.responsible_user_id as string;
        const client = p.clients as { name: string } | null;
        (map[uid] ??= []).push({
          id: p.id,
          name: p.name,
          areaLabel:
            (p.area && SERVICE_LABELS[p.area as keyof typeof SERVICE_LABELS]) || p.area || "Sin área",
          clientName: client?.name ?? "—",
          status: p.status,
        });
      });
    for (const uid of Object.keys(map)) {
      map[uid].sort(
        (a, b) => a.areaLabel.localeCompare(b.areaLabel, "es") || a.name.localeCompare(b.name, "es"),
      );
    }
    return map;
  }, [projects]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeMembers;
    return activeMembers.filter(
      (u) =>
        u.full_name?.toLowerCase().includes(q) ||
        u.area?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q),
    );
  }, [activeMembers, search]);

  const selectedMember = useMemo(
    () => (selectedUserId ? activeMembers.find((u) => u.user_id === selectedUserId) ?? null : null),
    [selectedUserId, activeMembers],
  );

  const selectedPrefs = selectedUserId ? (prefsMap?.[selectedUserId] ?? null) : null;
  const selectedClients = selectedUserId ? (clientsByUser[selectedUserId] ?? []) : [];
  const selectedProjects = selectedUserId ? (projectsByUser[selectedUserId] ?? []) : [];
  const selectedGrado = (selectedMember?.role as AppGrado | undefined) ?? "ejecutor";

  const getPublicEntries = (userId: string) => {
    const prefs = prefsMap?.[userId];
    if (!prefs) return [];
    return prefs.public_answers.filter((k) => PUBLIC_ANSWER_LABELS[k] && prefs.answers[k]);
  };

  const goTo = (path: string) => {
    setSelectedUserId(null);
    navigate(path);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-36 animate-pulse rounded-xl bg-secondary/30" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="surface-toolbar flex items-center gap-2 p-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o célula…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {filteredMembers.length === 0 ? (
        <div className="py-16 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">Sin miembros que coincidan.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filteredMembers.map((member) => {
            const grado = (member.role as AppGrado) ?? "ejecutor";
            const clientCount = clientsByUser[member.user_id]?.length ?? 0;
            const projectCount = projectsByUser[member.user_id]?.length ?? 0;

            return (
              <button
                key={member.user_id}
                type="button"
                onClick={() => setSelectedUserId(member.user_id)}
                className="flex flex-col items-center gap-2.5 rounded-xl bg-secondary/30 p-4 text-center transition-all hover:bg-secondary/50 hover:ring-1 hover:ring-primary/30"
              >
                <UserAvatar
                  name={member.full_name}
                  email={member.email}
                  avatarUrl={member.avatar_url}
                  userId={member.user_id}
                  size="xl"
                  showTooltip={false}
                />
                <div className="w-full min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {member.full_name}
                  </p>
                  {member.area && (
                    <p className="truncate text-[11px] text-muted-foreground">{member.area}</p>
                  )}
                </div>
                {/* Grado (nivel G) */}
                <Badge
                  variant="outline"
                  className={`max-w-full truncate px-1.5 py-0 text-[10px] font-normal ${gradoBadgeClass(grado)}`}
                >
                  {gradoLabel(grado)}
                </Badge>
                {/* Carga: clientes / proyectos como responsable */}
                {(clientCount > 0 || projectCount > 0) && (
                  <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    {clientCount > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <Building2 className="h-3 w-3" />
                        {clientCount} {clientCount === 1 ? "cliente" : "clientes"}
                      </span>
                    )}
                    {projectCount > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <FolderKanban className="h-3 w-3" />
                        {projectCount} {projectCount === 1 ? "proyecto" : "proyectos"}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Detail sheet */}
      <Sheet open={!!selectedUserId} onOpenChange={(open) => !open && setSelectedUserId(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          {selectedMember && (
            <>
              <SheetHeader className="border-b border-border/60 p-6 pb-5 text-left">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    name={selectedMember.full_name}
                    email={selectedMember.email}
                    avatarUrl={selectedMember.avatar_url}
                    userId={selectedMember.user_id}
                    size="xl"
                    showTooltip={false}
                  />
                  <div className="min-w-0">
                    <SheetTitle className="text-[15px]">{selectedMember.full_name}</SheetTitle>
                    <SheetDescription className="text-left text-xs">
                      {selectedMember.area ?? "Sin célula asignada"}
                    </SheetDescription>
                    <Badge
                      variant="outline"
                      className={`mt-2 px-1.5 py-0 text-[10px] font-normal ${gradoBadgeClass(selectedGrado)}`}
                    >
                      {gradoLabel(selectedGrado)}
                    </Badge>
                  </div>
                </div>
              </SheetHeader>

              <ScrollArea className="flex-1">
                <div className="space-y-6 p-6">
                  {/* Grado / Nivel G */}
                  <section>
                    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Grado (nivel G)
                    </p>
                    <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base leading-none">{GRADO_CONFIG[selectedGrado].emoji}</span>
                        <span className="text-sm font-medium text-foreground">
                          {GRADO_CONFIG[selectedGrado].label}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {GRADO_CONFIG[selectedGrado].description}
                      </p>
                    </div>
                  </section>

                  {/* Clientes como responsable */}
                  <section>
                    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Clientes como responsable ({selectedClients.length})
                    </p>
                    {selectedClients.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No es responsable de clientes activos.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {selectedClients.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => goTo(`/clientes/${c.id}`)}
                            className="flex w-full items-center gap-2 rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-left transition-colors hover:bg-secondary/50"
                          >
                            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                              {c.name}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Proyectos como responsable */}
                  <section>
                    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Proyectos como responsable ({selectedProjects.length})
                    </p>
                    {selectedProjects.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No es responsable de proyectos activos.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {selectedProjects.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => goTo(`/proyectos/${p.id}`)}
                            className="w-full rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-left transition-colors hover:bg-secondary/50"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <Badge variant="secondary" className="mb-1 text-[10px] font-normal">
                                  {p.areaLabel}
                                </Badge>
                                <p className="truncate text-[13px] font-medium text-foreground">{p.name}</p>
                                <p className="truncate text-[11px] text-muted-foreground">{p.clientName}</p>
                              </div>
                              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Perfil compartido */}
                  <section>
                    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Perfil
                    </p>
                    {!selectedPrefs ||
                    selectedPrefs.public_answers.filter(
                      (k) => PUBLIC_ANSWER_LABELS[k] && selectedPrefs.answers[k],
                    ).length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Este miembro aún no ha compartido información de su perfil.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {selectedPrefs.public_answers
                          .filter((k) => PUBLIC_ANSWER_LABELS[k] && selectedPrefs.answers[k])
                          .map((key) => {
                            const value = selectedPrefs.answers[key];
                            return (
                              <div key={key}>
                                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  {PUBLIC_ANSWER_LABELS[key]}
                                </p>
                                {Array.isArray(value) ? (
                                  <div className="flex flex-wrap gap-1.5">
                                    {(value as string[]).map((v) => (
                                      <Badge key={v} variant="secondary" className="text-[12px] font-normal">
                                        {v}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-foreground">{String(value)}</p>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </section>
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
