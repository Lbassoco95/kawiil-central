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
import { providerStatusLabel } from "@/lib/activityTypes";
import { useProfiles } from "@/hooks/useTasks";
import { useAuth } from "@/contexts/AuthContext";
import {
  useUpdateActivityProvider, useActivityProviderItems, useCreateProviderItem,
  useUpdateProviderItem, useDeleteProviderItem, useProviderComments,
  useAddProviderComment, useDeleteProviderComment, type ActivityProvider,
} from "@/hooks/useActivityExtras";

const todayYmd = () => new Date().toISOString().slice(0, 10);

/** Seguimiento de un proveedor/cotización: responsable, fecha límite, subtareas y comentarios. */
export function ProviderTrackingDialog({
  provider, open, onOpenChange,
}: { provider: ActivityProvider; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const { data: profiles } = useProfiles();
  const updateProvider = useUpdateActivityProvider();
  const { data: items } = useActivityProviderItems(open ? provider.id : undefined);
  const createItem = useCreateProviderItem();
  const updateItem = useUpdateProviderItem();
  const deleteItem = useDeleteProviderItem();
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

  const list = items ?? [];
  const done = list.filter((i) => i.completed).length;
  const today = todayYmd();

  const addItem = () => {
    const title = newTitle.trim();
    if (!title) return;
    createItem.mutate(
      {
        provider_id: provider.id, title,
        assigned_to: newAssignee || null, due_date: newDue || null,
        sort_order: list.length,
      },
      { onSuccess: () => { setNewTitle(""); setNewAssignee(""); setNewDue(""); } },
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
            <Badge variant="outline">{providerStatusLabel(provider.status)}</Badge>
          </DialogTitle>
          <DialogDescription>
            {provider.description || "Seguimiento del proveedor / cotización"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-1">
          {/* Responsable y fecha límite */}
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

          {/* Subtareas */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Subtareas</h3>
              {list.length > 0 && (
                <span className="text-xs text-muted-foreground">{done}/{list.length} hechas</span>
              )}
            </div>
            {list.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Sin subtareas. Divide el seguimiento en pasos (pedir muestra, confirmar diseño, pagar anticipo…).
              </p>
            )}
            <ul className="space-y-1.5">
              {list.map((i) => {
                const late = !!i.due_date && i.due_date < today && !i.completed;
                return (
                  <li key={i.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                    <Checkbox
                      checked={i.completed}
                      onCheckedChange={(c) => updateItem.mutate({ id: i.id, completed: c === true })}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${i.completed ? "line-through text-muted-foreground" : ""}`}>{i.title}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        {i.assigned_to && <span>{nameFor(i.assigned_to)}</span>}
                        {i.due_date && (
                          <span className={`flex items-center gap-1 ${late ? "text-destructive font-medium" : ""}`}>
                            <CalendarDays className="h-3 w-3" />{formatDateMX(i.due_date)}
                          </span>
                        )}
                      </p>
                    </div>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                      onClick={() => deleteItem.mutate({ id: i.id, providerId: provider.id })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_150px_auto] gap-2 items-center">
              <Input
                placeholder="Nueva subtarea…" value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
              />
              <SearchableSelect
                options={profileOptions} value={newAssignee} onValueChange={setNewAssignee}
                placeholder="Responsable" searchPlaceholder="Buscar persona..."
              />
              <Input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} />
              <Button size="sm" onClick={addItem} disabled={!newTitle.trim() || createItem.isPending}>
                <Plus className="mr-1 h-3.5 w-3.5" />Agregar
              </Button>
            </div>
          </section>

          {/* Comentarios */}
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
