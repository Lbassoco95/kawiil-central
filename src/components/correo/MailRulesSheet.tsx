import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Plus, Filter, Loader2, Pencil, Trash2, Check, X, Play } from "lucide-react";
import { useListMailRules, useUpdateMailRule, useDeleteMailRule, useApplyAllInboxRules, type EmailInboxRule } from "@/hooks/useMicrosoft";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders?: { id: string; displayName: string }[];
  onNewRule: () => void;
}

interface EditState {
  ruleName: string;
  senderEmail: string;
  folderId: string;
  folderName: string;
  markAsRead: boolean;
  isEnabled: boolean;
}

export function MailRulesSheet({ open, onOpenChange, folders = [], onNewRule }: Props) {
  const { data: rules = [], isLoading } = useListMailRules();
  const updateRule = useUpdateMailRule();
  const deleteRule = useDeleteMailRule();
  const applyAll = useApplyAllInboxRules();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const startEdit = (rule: EmailInboxRule) => {
    setEditingId(rule.id);
    setEditState({
      ruleName: rule.rule_name,
      senderEmail: rule.sender_email,
      folderId: rule.move_to_folder_id ?? "",
      folderName: rule.move_to_folder_name ?? "",
      markAsRead: rule.mark_as_read,
      isEnabled: rule.is_enabled,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditState(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editState) return;
    await updateRule.mutateAsync({
      id: editingId,
      displayName: editState.ruleName,
      senderEmail: editState.senderEmail,
      moveToFolderId: editState.folderId || null,
      moveToFolderName: editState.folderName || null,
      markAsRead: editState.markAsRead,
      isEnabled: editState.isEnabled,
    });
    cancelEdit();
  };

  const handleFolderChange = (folderId: string) => {
    if (!editState) return;
    const folder = folders.find((f) => f.id === folderId);
    setEditState({ ...editState, folderId, folderName: folder?.displayName ?? "" });
  };

  const handleDelete = async (id: string) => {
    await deleteRule.mutateAsync(id);
    setConfirmDeleteId(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[340px] p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border/40 flex-row items-center justify-between gap-2">
          <SheetTitle className="text-sm font-semibold">Reglas de correo</SheetTitle>
          <div className="flex items-center gap-1.5">
            {rules.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyAll.mutate()}
                disabled={applyAll.isPending}
                title="Aplicar todas las reglas a los correos que ya están en la bandeja"
                className="h-7 text-xs gap-1"
              >
                {applyAll.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Aplicar ahora
              </Button>
            )}
            <Button size="sm" onClick={onNewRule} className="h-7 text-xs gap-1">
              <Plus className="w-3 h-3" />
              Nueva regla
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Cargando reglas…</span>
            </div>
          )}
          {!isLoading && rules.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <Filter className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No hay reglas configuradas</p>
              <p className="text-xs text-muted-foreground/60">
                Crea una regla para mover automáticamente los correos de un remitente.
              </p>
            </div>
          )}

          {rules.map((rule) => {
            const isEditing = editingId === rule.id;
            const isConfirmingDelete = confirmDeleteId === rule.id;

            return (
              <div
                key={rule.id}
                className={cn(
                  "rounded-lg border border-border/40 transition-colors",
                  isEditing ? "bg-accent/30" : "bg-card hover:bg-accent/20"
                )}
              >
                {isEditing && editState ? (
                  /* ── Edit form ── */
                  <div className="p-3 space-y-2.5">
                    <div>
                      <label className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Nombre
                      </label>
                      <input
                        value={editState.ruleName}
                        onChange={(e) => setEditState({ ...editState, ruleName: e.target.value })}
                        className="mt-1 w-full h-7 px-2 text-[12.5px] bg-background border border-border/50 rounded outline-none focus:border-primary/50"
                      />
                    </div>
                    <div>
                      <label className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Remitente
                      </label>
                      <input
                        value={editState.senderEmail}
                        onChange={(e) => setEditState({ ...editState, senderEmail: e.target.value })}
                        placeholder="correo@dominio.com"
                        className="mt-1 w-full h-7 px-2 text-[12.5px] bg-background border border-border/50 rounded outline-none focus:border-primary/50"
                      />
                    </div>
                    {folders.length > 0 && (
                      <div>
                        <label className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Mover a carpeta
                        </label>
                        <select
                          value={editState.folderId}
                          onChange={(e) => handleFolderChange(e.target.value)}
                          className="mt-1 w-full h-7 px-2 text-[12.5px] bg-background border border-border/50 rounded outline-none focus:border-primary/50"
                        >
                          <option value="">— Sin mover —</option>
                          {folders.map((f) => (
                            <option key={f.id} value={f.id}>{f.displayName}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        id={`mark-read-${rule.id}`}
                        type="checkbox"
                        checked={editState.markAsRead}
                        onChange={(e) => setEditState({ ...editState, markAsRead: e.target.checked })}
                        className="w-3.5 h-3.5 accent-primary"
                      />
                      <label htmlFor={`mark-read-${rule.id}`} className="text-[12px] text-foreground cursor-pointer">
                        Marcar como leído
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id={`enabled-${rule.id}`}
                        type="checkbox"
                        checked={editState.isEnabled}
                        onChange={(e) => setEditState({ ...editState, isEnabled: e.target.checked })}
                        className="w-3.5 h-3.5 accent-primary"
                      />
                      <label htmlFor={`enabled-${rule.id}`} className="text-[12px] text-foreground cursor-pointer">
                        Regla activa
                      </label>
                    </div>
                    <div className="flex gap-1.5 pt-1">
                      <button
                        onClick={() => { void saveEdit(); }}
                        disabled={updateRule.isPending}
                        className="flex-1 h-7 flex items-center justify-center gap-1 text-[11.5px] font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                      >
                        {updateRule.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Check className="w-3 h-3" /> Guardar</>}
                      </button>
                      <button
                        onClick={cancelEdit}
                        title="Cancelar"
                        className="h-7 w-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ) : isConfirmingDelete ? (
                  /* ── Delete confirmation ── */
                  <div className="p-3">
                    <p className="text-[12.5px] font-medium text-foreground mb-1">¿Eliminar esta regla?</p>
                    <p className="text-[11.5px] text-muted-foreground mb-3">{rule.rule_name}</p>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => { void handleDelete(rule.id); }}
                        disabled={deleteRule.isPending}
                        className="flex-1 h-7 flex items-center justify-center gap-1 text-[11.5px] font-medium bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 disabled:opacity-50"
                      >
                        {deleteRule.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Eliminar"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="flex-1 h-7 text-[11.5px] rounded border border-border text-muted-foreground hover:text-foreground"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Read-only view ── */
                  <div className="flex items-start gap-3 p-3">
                    <Filter className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-medium text-foreground truncate flex-1">{rule.rule_name}</p>
                        {!rule.is_enabled && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">inactiva</span>
                        )}
                      </div>
                      <p className="text-[11.5px] text-muted-foreground">{rule.sender_email}</p>
                      {rule.move_to_folder_name && (
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5">→ {rule.move_to_folder_name}</p>
                      )}
                      {rule.mark_as_read && (
                        <p className="text-[11px] text-muted-foreground/70">✓ Marcar como leído</p>
                      )}
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      <button
                        onClick={() => startEdit(rule)}
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        title="Editar regla"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(rule.id)}
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        title="Eliminar regla"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
