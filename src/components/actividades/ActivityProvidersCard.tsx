import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Store, ExternalLink } from "lucide-react";
import { formatMxn } from "@/lib/pipelineFormat";
import {
  PROVIDER_CATEGORY_OPTIONS, providerCategoryLabel,
  PROVIDER_STATUS_OPTIONS, PROVIDER_STATUS_STYLES, providerStatusLabel,
  type ProviderStatus,
} from "@/lib/activityTypes";
import {
  useActivityProviders, useCreateActivityProvider, useUpdateActivityProvider,
  useDeleteActivityProvider, type ActivityProvider,
} from "@/hooks/useActivityExtras";

const emptyNum = (s: string) => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const providerTotal = (p: ActivityProvider) => (p.unit_price ?? 0) * (p.quantity ?? 0);
const providerBalance = (p: ActivityProvider) => providerTotal(p) - (p.advance ?? 0);

function ProviderDialog({
  activityId, provider, trigger,
}: { activityId: string; provider?: ActivityProvider; trigger: React.ReactNode }) {
  const isEdit = !!provider;
  const [open, setOpen] = useState(false);
  const createProvider = useCreateActivityProvider();
  const updateProvider = useUpdateActivityProvider();

  const [category, setCategory] = useState("otro");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [advance, setAdvance] = useState("");
  const [status, setStatus] = useState("cotizacion");
  const [link, setLink] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setCategory(provider?.category ?? "otro");
    setName(provider?.name ?? "");
    setDescription(provider?.description ?? "");
    setUnitPrice(provider?.unit_price != null ? String(provider.unit_price) : "");
    setQuantity(provider?.quantity != null ? String(provider.quantity) : "");
    setAdvance(provider?.advance != null ? String(provider.advance) : "");
    setStatus(provider?.status ?? "cotizacion");
    setLink(provider?.link ?? "");
    setNotes(provider?.notes ?? "");
  }, [open, provider]);

  const isPending = createProvider.isPending || updateProvider.isPending;

  const handleSubmit = () => {
    const payload = {
      category,
      name: name.trim(),
      description: description.trim() || null,
      unit_price: emptyNum(unitPrice),
      quantity: emptyNum(quantity),
      advance: emptyNum(advance),
      status,
      link: link.trim() || null,
      notes: notes.trim() || null,
    };
    if (isEdit) {
      updateProvider.mutate({ id: provider!.id, ...payload }, { onSuccess: () => setOpen(false) });
    } else {
      createProvider.mutate({ activity_id: activityId, ...payload }, { onSuccess: () => setOpen(false) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar proveedor" : "Nuevo proveedor / cotización"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Rubro</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDER_CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Estatus</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDER_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prov-name">Proveedor *</Label>
            <Input id="prov-name" placeholder="Ej: DELIFOOD"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prov-desc">Descripción / Menú</Label>
            <Textarea id="prov-desc" placeholder="Ej: Parrillada de carnes"
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="prov-unit">Precio unitario</Label>
              <Input id="prov-unit" type="number" min="0" step="1" placeholder="0"
                value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prov-qty">Cantidad</Label>
              <Input id="prov-qty" type="number" min="0" step="1" placeholder="0"
                value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prov-adv">Adelanto</Label>
              <Input id="prov-adv" type="number" min="0" step="1" placeholder="0"
                value={advance} onChange={(e) => setAdvance(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prov-link">Link</Label>
            <Input id="prov-link" placeholder="https://..."
              value={link} onChange={(e) => setLink(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prov-notes">Notas</Label>
            <Input id="prov-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || isPending}>
            {isEdit ? "Guardar" : "Agregar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ActivityProvidersCard({ activityId }: { activityId: string }) {
  const { data: providers, isLoading } = useActivityProviders(activityId);
  const updateProvider = useUpdateActivityProvider();
  const deleteProvider = useDeleteActivityProvider();

  const list = providers ?? [];
  const totalGeneral = list.reduce((s, p) => s + providerTotal(p), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Store className="h-4 w-4" />
          Proveedores y cotizaciones
        </CardTitle>
        <ProviderDialog
          activityId={activityId}
          trigger={
            <Button size="sm" variant="outline">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Agregar
            </Button>
          }
        />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Cargando...</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Sin proveedores aún. Agrega cotizaciones por rubro (casas, alimentos, souvenirs, obsequios).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rubro</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Estatus</TableHead>
                  <TableHead className="text-right">Unit.</TableHead>
                  <TableHead className="text-right">Cant.</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{providerCategoryLabel(p.category)}</TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {p.name}
                        {p.link && (
                          <a href={p.link} target="_blank" rel="noreferrer" className="text-primary">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      {p.description && (
                        <span className="block text-xs text-muted-foreground truncate max-w-[220px]">
                          {p.description}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={p.status}
                        onValueChange={(v) => updateProvider.mutate({ id: p.id, status: v })}
                      >
                        <SelectTrigger className="h-8 w-[125px] text-xs">
                          <Badge
                            variant="outline"
                            className={PROVIDER_STATUS_STYLES[p.status as ProviderStatus]}
                          >
                            {providerStatusLabel(p.status)}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {PROVIDER_STATUS_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">{formatMxn(p.unit_price, { compact: false })}</TableCell>
                    <TableCell className="text-right">{p.quantity ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatMxn(providerTotal(p), { compact: false })}</TableCell>
                    <TableCell className="text-right">{formatMxn(providerBalance(p), { compact: false })}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <ProviderDialog
                          activityId={activityId}
                          provider={p}
                          trigger={
                            <Button size="icon" variant="ghost" className="h-7 w-7">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                          onClick={() => deleteProvider.mutate({ id: p.id, activityId })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell colSpan={5} className="text-right font-semibold">Total general</TableCell>
                  <TableCell className="text-right font-semibold">{formatMxn(totalGeneral, { compact: false })}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
