import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Trash2, Plus, Send, CalendarDays } from "lucide-react";
import { formatDateMX } from "@/lib/dateUtils";
import { providerStatusLabel, rubroLabel, pendienteSuggestions } from "@/lib/activityTypes";
import { useProfiles, useCreateTask, useUpdateTask, useDeleteTask } from "@/hooks/useTasks";
import { useActivityTasks } from "@/hooks/useActivities";
import { useAuth } from "@/contexts/AuthContext";
import {
  useUpdateActivityProvider, useProviderComments, useAddProviderComment,
  useDeleteProviderComment, type ActivityProvider,
} from "@/hooks/useActivityExtras";

const todayYmd = () => new Date().toISOString().slice(0, 10);
const isClosed = (s: string) => s === "completada" || s === "cancelada";

/**
 * Seguimiento de un proveedor/cotización. Sus pendientes son TAREAS reales de la
 * actividad (ligadas a este proveedor y a su rubro): aparecen también en la pestaña
 * Pendientes y en las tareas/perfil de la persona asignada.
 */
export function ProviderTrackingDialog({
  provider, open, onOpenChange,
}: { provider: ActivityProvider; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const { data: profiles } = useProfiles();
  const updateProvider = useUpdateActivityProvider();
  const { data: allTasks } = useActivityTasks(open ? provider.activity_id : undefined);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { data: comments } = useProviderComments(open ? provider.id : undefined);
  const addComment = useAddProviderComment();
  const deleteComment = useDeleteProviderComment();

  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newDue, setNewDue] = useState("");
  const [comment, setComment] = useState("");

  const profileOptions = (profiles || []).map((p) => ({ value: p.user_id, label: p.full_name || p.email }));
  const nameFor = (uid: string | null) =>
    uid ? (profiles || []).find((p) => p.user_id === uid)?.full_name || "—" : "—";

  const list = (allTasks ?? []).filter((t) => t.activity_provider_id === provider.id);
  const done = list.filter((t) => t.status === "completada").length;
  const today = todayYmd();
  const taken = new Set(list.map((t) => t.title.trim().toLowerCase()));
  const suggestions = pendienteSuggestions(provider.category).filter((s) => !taken.has(s.toLowerCase()));

  const addTask = (title: string, opts?: { keepForm?: boolean }) => {
    const t = title.trim();
    if (!t) return;
    createTask.mutate(
      {
        title: t,
        status: "pendiente",
        priority: "media",
        assigned_to: (opts?.keepForm ? undefined : newAssignee) || provider.assigned_to || undefined,
        due_date: (opts?.keepForm ? undefined : newDue) || provider.due_date || undefined,
        activity_id: provider.activity_id,
        activity_category: provider.category,
        activity_provider_id: provider.id,
      },
      { onSuccess: () => { if (!opts?.keepForm) { setNewTitle(""); setNewAssignee(""); setNewDue(""); } } },
    );
  };

  const sendComment = () => {
    const content = comment.trim();
    if (!content) return;
    addComment.mutate({ provider_id: provider.id, content }, { onSuccess: () => setComment("") });
  };

  const overdue = !!provider.due_date && provider.due_date < today && provider.status !== "pagado" && provider.status !== "descartado";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {provider.name}
            <Badge variant="outline">{rubroLabel(provider.category)}</Badge>
            <Badge variant="outline">{providerStatusLabel(provider.status)}</Badge>
          </DialogTitle>
          <DialogDescription>
            {provider.description || "Seguimiento del proveedor / cotización"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Responsable</Label>
              <SearchableSelect
                options={profileOptions} value={provider.assigned_to ?? ""}
                onValueChange={(v) => updateProvider.mutate({ id: provider.id, assigned_to: v || null })}
                placeholder="Sin responsable" searchPlaceholder="Buscar persona..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prov-track-due">Fecha límite</Label>
              <Input
                id="prov-track-due" type="date"
                className={overdue ? "border-destructive" : ""}
                value={provider.due_date ?? ""}
                onChange={(e) => updateProvider.mutate({ id: provider.id, due_date: e.target.value || null })}
              />
              {overdue && <p className="text-xs text-destructive">Fecha límite vencida</p>}
            </div>
          </div>

          {/* Pendientes de este proveedor (tareas reales) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Pendientes de {provider.name}</h3>
              {list.length > 0 && (
                <span className="text-xs text-muted-foreground">{done}/{list.length} hechos</span>
              )}
            </div>
            {list.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Aún no hay pendientes para este proveedor. Agrega uno o usa una sugerencia.
              </p>
            )}
            <ul className="space-y-1.5">
              {list.map((t) => {
                const late = !!t.due_date && t.due_date < today && !isClosed(t.status);
                return (
                  <li key={t.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                    <Checkbox
                      checked={t.status === "completada"}
                      onCheckedChange={(c) =>
                        updateTask.mutate({ id: t.id, status: c === true ? "completada" : "pendiente" })
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${t.status === "completada" ? "line-through text-muted-foreground" : ""}`}>
                        {t.title}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        {t.assigned_to && <span>{nameFor(t.assigned_to)}</span>}
                        {t.due_date && (
                          <span className={`flex items-center gap-1 ${late ? "text-destructive font-medium" : ""}`}>
                            <CalendarDays className="h-3 w-3" />{formatDateMX(t.due_date)}
                          </span>
                        )}
                      </p>
                    </div>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                      onClick={() => deleteTask.mutate(t.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>

            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <Button
                    key={s} size="sm" variant="outline" className="h-7 text-xs"
                    disabled={createTask.isPending}
                    onClick={() => addTask(s, { keepForm: true })}
                  >
                    <Plus className="mr-1 h-3 w-3" />{s}
                  </Button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_150px_auto] gap-2 items-center">
              <Input
                placeholder="Nuevo pendiente…" value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTask(newTitle); } }}
              />
              <SearchableSelect
                options={profileOptions} value={newAssignee} onValueChange={setNewAssignee}
                placeholder="Responsable" searchPlaceholder="Buscar persona..."
              />
              <Input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} />
              <Button size="sm" onClick={() => addTask(newTitle)} disabled={!newTitle.trim() || createTask.isPending}>
                <Plus className="mr-1 h-3.5 w-3.5" />Agregar
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Comentarios y seguimiento</h3>
            <div className="flex gap-2 items-end">
              <Textarea
                placeholder="Escribe una actualización: llamada, respuesta del proveedor, acuerdos…"
                value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
              />
              <Button size="icon" onClick={sendComment} disabled={!comment.trim() || addComment.isPending}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {(comments ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay comentarios.</p>
            ) : (
              <ul className="space-y-2">
                {(comments ?? []).map((c) => (
                  <li key={c.id} className="rounded-md bg-muted/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">
                        {nameFor(c.user_id)}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {new Date(c.created_at).toLocaleString("es-MX", {
                            timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short",
                          })}
                        </span>
                      </span>
                      {c.user_id === user?.id && (
                        <Button
                          size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground"
                          onClick={() => deleteComment.mutate({ id: c.id, providerId: provider.id })}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{c.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
