import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, Loader2, Pencil } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAreas, useUpsertArea, type Area } from "@/hooks/useCatalogs";
import { useOrgProfiles } from "@/hooks/useClients";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function AreaManagement() {
  const { data: areas, isLoading } = useAreas();
  const { data: profiles } = useOrgProfiles();
  const upsert = useUpsertArea();
  const [editing, setEditing] = useState<Area | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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
              <div key={area.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/30 transition-colors">
                <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: area.color || "#6366f1" }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{area.name}</span>
                    {!area.is_active && <Badge variant="outline" className="text-[10px]">Inactiva</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {area.description && <span className="truncate">{area.description}</span>}
                    {responsibleName(area.responsible_user_id) && (
                      <span>· Responsable: {responsibleName(area.responsible_user_id)}</span>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(area)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
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
            <div className="grid grid-cols-2 gap-4">
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
    </Card>
  );
}
