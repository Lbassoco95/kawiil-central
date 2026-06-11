import { useMemo, useState } from "react";
import { useOrgUsers } from "@/hooks/useOrgUsers";
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
import { Search, Users } from "lucide-react";

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

export function TeamDirectory() {
  const { data: orgUsers = [], isLoading } = useOrgUsers();
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

  const getPublicEntries = (userId: string) => {
    const prefs = prefsMap?.[userId];
    if (!prefs) return [];
    return prefs.public_answers.filter((k) => PUBLIC_ANSWER_LABELS[k] && prefs.answers[k]);
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
            const publicEntries = getPublicEntries(member.user_id);
            const prefs = prefsMap?.[member.user_id];

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
                {publicEntries.length > 0 && prefs && (
                  <div className="flex w-full flex-wrap justify-center gap-1">
                    {(() => {
                      const hobbies = prefs.answers["hobbies"];
                      if (Array.isArray(hobbies) && prefs.public_answers.includes("hobbies")) {
                        return (hobbies as string[]).slice(0, 2).map((h) => (
                          <Badge
                            key={h}
                            variant="secondary"
                            className="max-w-full truncate px-1.5 py-0 text-[10px] font-normal"
                          >
                            {h}
                          </Badge>
                        ));
                      }
                      return null;
                    })()}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Detail sheet */}
      <Sheet open={!!selectedUserId} onOpenChange={(open) => !open && setSelectedUserId(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-sm">
          {selectedMember && (
            <>
              <SheetHeader className="border-b border-border/60 p-6 pb-5 text-left">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    name={selectedMember.full_name}
                    email={selectedMember.email}
                    userId={selectedMember.user_id}
                    size="xl"
                    showTooltip={false}
                  />
                  <div className="min-w-0">
                    <SheetTitle className="text-[15px]">{selectedMember.full_name}</SheetTitle>
                    <SheetDescription className="text-left text-xs">
                      {selectedMember.area ?? "Sin célula asignada"}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <ScrollArea className="flex-1">
                <div className="space-y-5 p-6">
                  {!selectedPrefs ||
                  selectedPrefs.public_answers.filter(
                    (k) => PUBLIC_ANSWER_LABELS[k] && selectedPrefs.answers[k],
                  ).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Este miembro aún no ha compartido información de su perfil.
                    </p>
                  ) : (
                    selectedPrefs.public_answers
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
                      })
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
