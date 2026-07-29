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
import { Plus, Pencil, Trash2, ListChecks } from "lucide-react";
import { formatMxn } from "@/lib/pipelineFormat";
import { formatDateMX } from "@/lib/dateUtils";
import {
  ACTIVITY_ITEM_STATUS_OPTIONS, ACTIVITY_ITEM_STATUS_STYLES, activityItemStatusLabel,
  type ActivityItemStatus,
} from "@/lib/activityTypes";
import {
  useActivityItems, useCreateActivityItem, useUpdateActivityItem, useDeleteActivityItem,
  type ActivityItem,
} from "@/hooks/useActivities";

const emptyNum = (s: string) => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

interface ItemDialogProps {
  activityId: string;
  item?: ActivityItem;
  trigger: React.ReactNode;
}

function ItemDialog({ activityId, item, trigger }: ItemDialogProps) {
  const isEdit = !!item;
  const [open, setOpen] = useState(false);
  const createItem = useCreateActivityItem();
  const updateItem = useUpdateActivityItem();

  const [title, setTitle] = useState("");
  const [responsible, setResponsible] = useState("");
  const [status, setStatus] = useState<string>("pendiente");
  const [dueDate, setDueDate] = useState("");
  const [budgetEstimated, setBudgetEstimated] = useState("");
  const [budgetSpent, setBudgetSpent] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(item?.title ?? "");
    setResponsible(item?.responsible ?? "");
    setStatus(item?.status ?? "pendiente");
    setDueDate(item?.due_date ?? "");
    setBudgetEstimated(item?.budget_estimated != null ? String(item.budget_estimated) : "");
    setBudgetSpent(item?.budget_spent != null ? String(item.budget_spent) : "");
    setNotes(item?.notes ?? "");
  }, [open, item]);

  const isPending = createItem.isPending || updateItem.isPending;

  const handleSubmit = () => {
    const payload = {
      title: title.trim(),
      responsible: responsible.trim() || null,
      status,
      due_date: dueDate || null,
      budget_estimated: emptyNum(budgetEstimated),
      budget_spent: emptyNum(budgetSpent),
      notes: notes.trim() || null,
    };
    if (isEdit) {
      updateItem.mutate({ id: item!.id, ...payload }, { onSuccess: () => setOpen(false) });
    } else {
      createItem.mutate({ activity_id: activityId, ...payload }, { onSuccess: () => setOpen(false) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar pendiente" : "Nuevo pendiente"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="item-title">Pendiente *</Label>
            <Input id="item-title" placeholder="Ej: Buscar casa / sede"
              value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="item-resp">Responsable</Label>
              <Input id="item-resp" placeholder="Ej: Jesús"
                value={responsible} onChange={(e) => setResponsible(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Estatus</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVITY_ITEM_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-due">Fecha límite</Label>
            <Input id="item-due" type="date"
              value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="item-est">Presup. estimado</Label>
              <Input id="item-est" type="number" min="0" step="1" placeholder="0"
                value={budgetEstimated} onChange={(e) => setBudgetEstimated(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-real">Gasto real</Label>
              <Input id="item-real" type="number" min="0" step="1" placeholder="0"
                value={budgetSpent} onChange={(e) => setBudgetSpent(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-notes">Notas</Label>
            <Textarea id="item-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || isPending}>
            {isEdit ? "Guardar" : "Agregar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ActivityItemsCard({ activityId }: { activityId: string }) {
  const { data: items, isLoading } = useActivityItems(activityId);
  const updateItem = useUpdateActivityItem();
  const deleteItem = useDeleteActivityItem();

  const list = items ?? [];
  const totalEst = list.reduce((s, i) => s + (i.budget_estimated ?? 0), 0);
  const totalReal = list.reduce((s, i) => s + (i.budget_spent ?? 0), 0);
  const done = list.filter((i) => i.status === "hecho").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="h-4 w-4" />
          Pendientes y seguimiento
          {list.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {done}/{list.length} hechos
            </span>
          )}
        </CardTitle>
        <ItemDialog
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
            Sin pendientes aún. Agrega el primero (ej. buscar sede, cotizar comida, comprar souvenirs).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pendiente</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead>Estatus</TableHead>
                  <TableHead>Fecha límite</TableHead>
                  <TableHead className="text-right">Estimado</TableHead>
                  <TableHead className="text-right">Real</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell>{item.responsible || "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={item.status}
                        onValueChange={(v) => updateItem.mutate({ id: item.id, status: v })}
                      >
                        <SelectTrigger className="h-8 w-[130px] text-xs">
                          <Badge
                            variant="outline"
                            className={ACTIVITY_ITEM_STATUS_STYLES[item.status as ActivityItemStatus]}
                          >
                            {activityItemStatusLabel(item.status)}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {ACTIVITY_ITEM_STATUS_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>{item.due_date ? formatDateMX(item.due_date) : "—"}</TableCell>
                    <TableCell className="text-right">{formatMxn(item.budget_estimated, { compact: false })}</TableCell>
                    <TableCell className="text-right">{formatMxn(item.budget_spent, { compact: false })}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <ItemDialog
                          activityId={activityId}
                          item={item}
                          trigger={
                            <Button size="icon" variant="ghost" className="h-7 w-7">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                          onClick={() => deleteItem.mutate({ id: item.id, activityId })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell colSpan={4} className="text-right font-semibold">Totales</TableCell>
                  <TableCell className="text-right font-semibold">{formatMxn(totalEst, { compact: false })}</TableCell>
                  <TableCell className="text-right font-semibold">{formatMxn(totalReal, { compact: false })}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
