import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, UserPlus, Trash2 } from "lucide-react";
import type { AiProject, AiProjectMemberRow } from "@/hooks/useAiProjects";
import type { OrgUser } from "@/hooks/useOrgUsers";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project: AiProject | null;
  members: AiProjectMemberRow[];
  orgUsers: OrgUser[];
  currentUserId: string | undefined;
  isLoading: boolean;
  onAddMember: (userId: string, role: string) => Promise<void>;
  onRemoveMember: (memberRowId: string) => Promise<void>;
}

export function AiProjectMembersDialog({
  open, onOpenChange, project, members, orgUsers, currentUserId,
  isLoading, onAddMember, onRemoveMember,
}: Props) {
  const [inviteUserId, setInviteUserId] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<string>("editor");
  const [busy, setBusy] = useState(false);

  const isOwner = project?.user_id === currentUserId;

  const memberUserIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);

  const inviteCandidates = useMemo(
    () => orgUsers.filter((u) => u.user_id !== currentUserId && !memberUserIds.has(u.user_id)),
    [orgUsers, currentUserId, memberUserIds]
  );

  const nameByUserId = useMemo(() => {
    const m = new Map<string, string>();
    orgUsers.forEach((u) => m.set(u.user_id, u.full_name || u.email));
    return m;
  }, [orgUsers]);

  const handleInvite = async () => {
    if (!inviteUserId) return;
    setBusy(true);
    try {
      await onAddMember(inviteUserId, inviteRole);
      setInviteUserId("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Miembros — {project?.name}
          </DialogTitle>
          <DialogDescription>
            Los miembros comparten documentos del proyecto y la memoria de equipo (/team/). Cada quien conserva sus chats y memorias personales.
          </DialogDescription>
        </DialogHeader>

        {isOwner && (
          <div className="flex flex-col sm:flex-row gap-2 py-2">
            <Select value={inviteUserId || undefined} onValueChange={setInviteUserId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Invitar Kawiiler…" />
              </SelectTrigger>
              <SelectContent>
                {inviteCandidates.map((u) => (
                  <SelectItem key={u.user_id} value={u.user_id}>
                    {u.full_name || u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={inviteRole} onValueChange={setInviteRole}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Solo lectura</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" disabled={!inviteUserId || busy} onClick={handleInvite}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invitar"}
            </Button>
          </div>
        )}

        <div className="max-h-[240px] overflow-y-auto space-y-1 border rounded-lg p-2">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sin miembros</p>
          ) : (
            members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 text-sm py-1.5 px-2 rounded-md hover:bg-secondary/40">
                <span className="truncate">{nameByUserId.get(m.user_id) || m.user_id}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-muted-foreground uppercase">{m.role}</span>
                  {isOwner && m.role !== "owner" && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive p-0.5"
                      onClick={() => onRemoveMember(m.id)}
                      title="Quitar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
