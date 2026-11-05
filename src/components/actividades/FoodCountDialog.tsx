import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Copy, Check, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import { buildFoodCount, foodCountText } from "@/lib/activityFoodCount";
import { useActivity } from "@/hooks/useActivities";
import { useActivityAttendees } from "@/hooks/useActivityExtras";

/** Conteo de comida: confirmados (asistentes + acompañantes), restricciones y lista para el proveedor. */
export function FoodCountDialog({ activityId }: { activityId: string }) {
  const { data: activity } = useActivity(activityId);
  const { data: attendees } = useActivityAttendees(activityId);
  const [open, setOpen] = useState(false);
  const [includePending, setIncludePending] = useState(false);
  const [copied, setCopied] = useState(false);

  const count = buildFoodCount(attendees ?? []);
  const list = includePending ? [...count.confirmed, ...count.pending] : count.confirmed;

  const handleCopy = async () => {
    const ok = await copyText(foodCountText(activity?.name ?? "Actividad", count, { includePending }));
    setCopied(ok);
    if (ok) toast.success("Conteo copiado. Pégalo en WhatsApp o correo para el proveedor.");
    else toast.error("No se pudo copiar. Selecciona el texto y cópialo manualmente.");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setCopied(false); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UtensilsCrossed className="mr-1.5 h-3.5 w-3.5" />
          Conteo de comida
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conteo de comida</DialogTitle>
          <DialogDescription>
            Personas que sí vienen, con sus acompañantes (+1). Quien no asiste no cuenta, ni su acompañante.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border p-3">
            <p className="text-2xl font-bold">{count.confirmed.length}</p>
            <p className="text-xs text-muted-foreground">
              Confirmados ({count.confirmedAttendees} + {count.confirmedCompanions} acomp.)
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-2xl font-bold">{count.pending.length}</p>
            <p className="text-xs text-muted-foreground">Por confirmar</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-2xl font-bold">{count.confirmed.length + count.pending.length}</p>
            <p className="text-xs text-muted-foreground">Máximo posible</p>
          </div>
        </div>

        {count.restrictions.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Restricciones alimentarias (confirmados)</p>
            <ul className="space-y-1 text-sm">
              {count.restrictions.map((r) => (
                <li key={r.label} className="flex items-start gap-2">
                  <Badge variant="secondary">{r.count}</Badge>
                  <span>
                    <span className="font-medium">{r.label}</span>
                    <span className="text-muted-foreground"> — {r.people.join(", ")}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">
            {includePending ? "Lista (incluye por confirmar)" : "Lista de confirmados"}
          </p>
          <div className="flex items-center gap-2">
            <Switch id="food-pending" checked={includePending} onCheckedChange={setIncludePending} />
            <Label htmlFor="food-pending" className="text-xs">Incluir por confirmar</Label>
          </div>
        </div>

        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aún no hay confirmados. Marca la confirmación de cada asistente en la tabla.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Restricción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((p, i) => (
                  <TableRow key={`${p.kind}-${p.name}-${i}`}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">
                      {p.name}
                      {p.status === "pendiente" && (
                        <Badge variant="outline" className="ml-2 text-[10px] font-normal">Por confirmar</Badge>
                      )}
                    </TableCell>
                    <TableCell>{p.kind === "acompañante" ? "Acompañante" : "Asistente"}</TableCell>
                    <TableCell>{p.dietary ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cerrar</Button>
          <Button onClick={handleCopy}>
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? "Copiado" : "Copiar para el proveedor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
