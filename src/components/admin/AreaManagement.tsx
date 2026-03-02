import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, Loader2, Pencil, Trash2, ChevronDown, ChevronUp, Mail, User, Palette } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAreas, useUpsertArea, useDeleteArea, type Area } from "@/hooks/useCatalogs";
import { useOrgProfiles } from "@/hooks/useClients";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function AreaManagement() {
  const { data: areas, isLoading } = useAreas();
  const { data: profiles } = useOrgProfiles();
  const upsert = useUpsertArea();
  const deleteArea = useDeleteArea();
  const [editing, setEditing] = useState<Area | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Area | null>(null);
  const [expandedArea, setExpandedArea] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", slug: "", description: "", color: "#6366f1", responsible_user_id: "" });

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", slug: "", description: "", color: "#6366f1", responsible_user_id: "" });
    setDialogOpen(true);
  };

  const openEdit = (area: Area) => {
    setEditing(area);
    setForm({
      name: area.name,
      slug: area.slug,
      description: area.description || "",
      color: area.color || "#6366f1",
      responsible_user_id: area.responsible_user_id || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    await upsert.mutateAsync({
      ...(editing ? { id: editing.id } : {}),
      name: form.name.trim(),
      slug,
      description: form.description || null,
      color: form.color,
      responsible_user_id: form.responsible_user_id || null,
    });
    setDialogOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteArea.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  };

  const responsibleName = (userId: string | null) => {
    if (!userId || !profiles) return null;
    return profiles.find((p) => p.user_id === userId)?.full_name;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Áreas de servicio
        </CardTitle>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> Nueva área
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !areas?.length ? (
          <p className="text-center text-sm text-muted-foreground py-8">No hay áreas configuradas</p>
        ) : (
          <div className="space-y-2">
            {areas.map((area) => (
              <Collapsible
                key={area.id}
                open={expandedArea === area.id}
                onOpenChange={(open) => setExpandedArea(open ? area.id : null)}
              >
                <div className="rounded-lg border hover:bg-muted/30 transition-colors">
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-3 w-full p-3 text-left">
                      <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: area.color || "#6366f1" }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{area.name}</span>
                          {!area.is_active && <Badge variant="outline" className="text-[10px]">Inactiva</Badge>}
                        </div>
                        {area.description && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{area.description}</p>
                        )}
                      </div>
                      {expandedArea === area.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="px-3 pb-3 border-t pt-3 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Slug</span>
                          <p className="font-medium">{area.slug}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Estado</span>
                          <p>
                            <Badge variant={area.is_active ? "default" : "outline"}>
                              {area.is_active ? "Activa" : "Inactiva"}
                            </Badge>
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs flex items-center gap-1"><Palette className="h-3 w-3" /> Color</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <div className="h-4 w-4 rounded border" style={{ backgroundColor: area.color || "#6366f1" }} />
                            <span className="font-mono text-xs">{area.color || "#6366f1"}</span>
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs flex items-center gap-1"><User className="h-3 w-3" /> Responsable</span>
                          <p className="font-medium">{responsibleName(area.responsible_user_id) || "Sin asignar"}</p>
                        </div>
                        {area.description && (
                          <div className="col-span-2">
                            <span className="text-muted-foreground text-xs">Descripción</span>
                            <p className="text-sm">{area.description}</p>
                          </div>
                        )}
                        <div>
                          <span className="text-muted-foreground text-xs">Creada</span>
                          <p className="text-xs">{format(new Date(area.created_at), "dd MMM yyyy", { locale: es })}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2 pt-1">
                        <Button variant="outline" size="sm" onClick={() => openEdit(area)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                        </Button>
                        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(area)}>
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Eliminar
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar área" : "Nueva área"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nombre *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre del área" />
            </div>
            <div>
              <Label>Slug</Label>
              <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="identificador_unico" />
            </div>
            <div>
              <Label>Descripción</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Color</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-8 w-8 rounded border cursor-pointer" />
                  <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="flex-1" />
                </div>
              </div>
              <div>
                <Label>Responsable</Label>
                <Select value={form.responsible_user_id} onValueChange={(v) => setForm({ ...form, responsible_user_id: v })}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                  <SelectContent>
                    {profiles?.map((p) => (
                      <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={upsert.isPending}>
                {upsert.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`¿Eliminar el área "${deleteTarget?.name}"?`}
        description="Se eliminará permanentemente. Si hay proyectos o tareas asociados, la eliminación podría fallar."
        onConfirm={handleDelete}
        isPending={deleteArea.isPending}
      />
    </Card>
  );
}
