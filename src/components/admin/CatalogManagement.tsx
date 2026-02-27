import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tag, FileText, Receipt, Plus, Pencil, Loader2, Trash2 } from "lucide-react";
import {
  useDocumentTypes, useUpsertDocumentType, useDeleteDocumentType,
  useCatalogTags, useUpsertCatalogTag, useDeleteCatalogTag,
  useTaxObligationTypes, useUpsertTaxObligation, useDeleteTaxObligation,
  type DocumentType, type CatalogTag, type TaxObligationType,
} from "@/hooks/useCatalogs";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";

// ─── Generic list item ───
function CatalogItem({
  name, subtitle, color, isActive, onEdit, onDelete,
}: {
  name: string; subtitle?: string | null; color?: string | null; isActive: boolean; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/30 transition-colors">
      {color && <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{name}</span>
          {!isActive && <Badge variant="outline" className="text-[10px]">Inactivo</Badge>}
        </div>
        {subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>}
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── Document Types ───
function DocumentTypesCatalog() {
  const { data, isLoading } = useDocumentTypes();
  const upsert = useUpsertDocumentType();
  const deleteMut = useDeleteDocumentType();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentType | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [deleteTarget, setDeleteTarget] = useState<DocumentType | null>(null);

  const openNew = () => { setEditing(null); setForm({ name: "", description: "" }); setDialogOpen(true); };
  const openEdit = (dt: DocumentType) => { setEditing(dt); setForm({ name: dt.name, description: dt.description || "" }); setDialogOpen(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    await upsert.mutateAsync({ ...(editing ? { id: editing.id } : {}), name: form.name.trim(), description: form.description || null });
    setDialogOpen(false);
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium flex items-center gap-1.5"><FileText className="h-4 w-4" /> Tipos de documento</h3>
        <Button size="sm" variant="outline" onClick={openNew}><Plus className="h-3.5 w-3.5 mr-1" /> Agregar</Button>
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : !data?.length ? (
        <p className="text-sm text-muted-foreground text-center py-4">Sin tipos de documento</p>
      ) : (
        <div className="space-y-1.5">{data.map((dt) => <CatalogItem key={dt.id} name={dt.name} subtitle={dt.description} isActive={dt.is_active} onEdit={() => openEdit(dt)} onDelete={() => setDeleteTarget(dt)} />)}</div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editing ? "Editar tipo" : "Nuevo tipo de documento"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nombre *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Descripción</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={upsert.isPending}>{upsert.isPending ? "Guardando..." : "Guardar"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`¿Eliminar "${deleteTarget?.name}"?`}
        description="Se eliminará permanentemente este tipo de documento."
        onConfirm={async () => { if (deleteTarget) { await deleteMut.mutateAsync(deleteTarget.id); setDeleteTarget(null); } }}
        isPending={deleteMut.isPending}
      />
    </>
  );
}

// ─── Tags ───
function TagsCatalog() {
  const { data, isLoading } = useCatalogTags();
  const upsert = useUpsertCatalogTag();
  const deleteMut = useDeleteCatalogTag();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogTag | null>(null);
  const [form, setForm] = useState({ name: "", color: "#8b5cf6" });
  const [deleteTarget, setDeleteTarget] = useState<CatalogTag | null>(null);

  const openNew = () => { setEditing(null); setForm({ name: "", color: "#8b5cf6" }); setDialogOpen(true); };
  const openEdit = (tag: CatalogTag) => { setEditing(tag); setForm({ name: tag.name, color: tag.color || "#8b5cf6" }); setDialogOpen(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    await upsert.mutateAsync({ ...(editing ? { id: editing.id } : {}), name: form.name.trim(), color: form.color });
    setDialogOpen(false);
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium flex items-center gap-1.5"><Tag className="h-4 w-4" /> Etiquetas</h3>
        <Button size="sm" variant="outline" onClick={openNew}><Plus className="h-3.5 w-3.5 mr-1" /> Agregar</Button>
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : !data?.length ? (
        <p className="text-sm text-muted-foreground text-center py-4">Sin etiquetas</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.map((tag) => (
            <Badge key={tag.id} variant="outline" className="cursor-pointer hover:bg-muted/50 gap-1.5 pr-1" onClick={() => openEdit(tag)}>
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color || "#8b5cf6" }} />
              {tag.name}
              <Pencil className="h-2.5 w-2.5 ml-1 opacity-50" />
              <button className="ml-1 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(tag); }}>
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editing ? "Editar etiqueta" : "Nueva etiqueta"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nombre *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div>
              <Label>Color</Label>
              <div className="flex items-center gap-2 mt-1">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-8 w-8 rounded border cursor-pointer" />
                <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="flex-1" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={upsert.isPending}>{upsert.isPending ? "Guardando..." : "Guardar"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`¿Eliminar "${deleteTarget?.name}"?`}
        description="Se eliminará permanentemente esta etiqueta."
        onConfirm={async () => { if (deleteTarget) { await deleteMut.mutateAsync(deleteTarget.id); setDeleteTarget(null); } }}
        isPending={deleteMut.isPending}
      />
    </>
  );
}

// ─── Tax Obligations ───
function TaxObligationsCatalog() {
  const { data, isLoading } = useTaxObligationTypes();
  const upsert = useUpsertTaxObligation();
  const deleteMut = useDeleteTaxObligation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaxObligationType | null>(null);
  const [form, setForm] = useState({ name: "", description: "", frequency: "mensual" });
  const [deleteTarget, setDeleteTarget] = useState<TaxObligationType | null>(null);

  const openNew = () => { setEditing(null); setForm({ name: "", description: "", frequency: "mensual" }); setDialogOpen(true); };
  const openEdit = (ob: TaxObligationType) => { setEditing(ob); setForm({ name: ob.name, description: ob.description || "", frequency: ob.frequency || "mensual" }); setDialogOpen(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    await upsert.mutateAsync({ ...(editing ? { id: editing.id } : {}), name: form.name.trim(), description: form.description || null, frequency: form.frequency });
    setDialogOpen(false);
  };

  const freqLabel: Record<string, string> = { mensual: "Mensual", bimestral: "Bimestral", trimestral: "Trimestral", anual: "Anual" };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium flex items-center gap-1.5"><Receipt className="h-4 w-4" /> Obligaciones fiscales</h3>
        <Button size="sm" variant="outline" onClick={openNew}><Plus className="h-3.5 w-3.5 mr-1" /> Agregar</Button>
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : !data?.length ? (
        <p className="text-sm text-muted-foreground text-center py-4">Sin obligaciones fiscales</p>
      ) : (
        <div className="space-y-1.5">
          {data.map((ob) => (
            <CatalogItem key={ob.id} name={ob.name} subtitle={`${freqLabel[ob.frequency || "mensual"] || ob.frequency}${ob.description ? ` · ${ob.description}` : ""}`} isActive={ob.is_active} onEdit={() => openEdit(ob)} onDelete={() => setDeleteTarget(ob)} />
          ))}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editing ? "Editar obligación" : "Nueva obligación fiscal"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nombre *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Descripción</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
            <div>
              <Label>Frecuencia</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mensual">Mensual</SelectItem>
                  <SelectItem value="bimestral">Bimestral</SelectItem>
                  <SelectItem value="trimestral">Trimestral</SelectItem>
                  <SelectItem value="anual">Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={upsert.isPending}>{upsert.isPending ? "Guardando..." : "Guardar"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`¿Eliminar "${deleteTarget?.name}"?`}
        description="Se eliminará permanentemente esta obligación fiscal."
        onConfirm={async () => { if (deleteTarget) { await deleteMut.mutateAsync(deleteTarget.id); setDeleteTarget(null); } }}
        isPending={deleteMut.isPending}
      />
    </>
  );
}

// ─── Main Catalog Management ───
export function CatalogManagement() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Tag className="h-4 w-4" />
          Catálogos del sistema
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="doc-types">
          <TabsList className="w-full">
            <TabsTrigger value="doc-types" className="flex-1">Tipos de documento</TabsTrigger>
            <TabsTrigger value="tags" className="flex-1">Etiquetas</TabsTrigger>
            <TabsTrigger value="tax" className="flex-1">Obligaciones fiscales</TabsTrigger>
          </TabsList>
          <TabsContent value="doc-types" className="mt-4"><DocumentTypesCatalog /></TabsContent>
          <TabsContent value="tags" className="mt-4"><TagsCatalog /></TabsContent>
          <TabsContent value="tax" className="mt-4"><TaxObligationsCatalog /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
