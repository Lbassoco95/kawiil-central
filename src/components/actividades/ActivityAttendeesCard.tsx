import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useActivityTasks } from "@/hooks/useActivities";
import {
  ATTENDEE_CONFIRMED_OPTIONS, ATTENDEE_CONFIRMED_STYLES, ATTENDEE_CONFIRMED_LABELS,
  type AttendeeConfirmed,
} from "@/lib/activityTypes";
import {
  useActivityAttendees, useCreateActivityAttendee, useUpdateActivityAttendee,
  useDeleteActivityAttendee, type ActivityAttendee,
} from "@/hooks/useActivityExtras";

function AttendeeDialog({
  activityId, attendee, trigger,
}: { activityId: string; attendee?: ActivityAttendee; trigger: React.ReactNode }) {
  const isEdit = !!attendee;
  const [open, setOpen] = useState(false);
  const createAttendee = useCreateActivityAttendee();
  const updateAttendee = useUpdateActivityAttendee();

  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState<string>("pendiente");
  const [dietary, setDietary] = useState("");
  const [notes, setNotes] = useState("");
  const [hasPlusOne, setHasPlusOne] = useState(false);
  const [plusName, setPlusName] = useState("");
  const [plusConfirmed, setPlusConfirmed] = useState<string>("pendiente");
  const [plusDietary, setPlusDietary] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(attendee?.name ?? "");
    setConfirmed(attendee?.confirmed ?? "pendiente");
    setDietary(attendee?.dietary_restriction ?? "");
    setNotes(attendee?.notes ?? "");
    setHasPlusOne(attendee?.has_plus_one ?? false);
    setPlusName(attendee?.plus_one_name ?? "");
    setPlusConfirmed(attendee?.plus_one_confirmed ?? "pendiente");
    setPlusDietary(attendee?.plus_one_dietary ?? "");
  }, [open, attendee]);

  const isPending = createAttendee.isPending || updateAttendee.isPending;

  const handleSubmit = () => {
    const payload = {
      name: name.trim(),
      confirmed,
      dietary_restriction: dietary.trim() || null,
      notes: notes.trim() || null,
      has_plus_one: hasPlusOne,
      plus_one_name: hasPlusOne ? plusName.trim() || null : null,
      plus_one_confirmed: hasPlusOne ? plusConfirmed : "pendiente",
      plus_one_dietary: hasPlusOne ? plusDietary.trim() || null : null,
    };
    if (isEdit) {
      updateAttendee.mutate({ id: attendee!.id, ...payload }, { onSuccess: () => setOpen(false) });
    } else {
      createAttendee.mutate({ activity_id: activityId, ...payload }, { onSuccess: () => setOpen(false) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar asistente" : "Nuevo asistente"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="att-name">Nombre *</Label>
            <Input id="att-name" placeholder="Ej: Viri"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Confirmación</Label>
            <Select value={confirmed} onValueChange={setConfirmed}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ATTENDEE_CONFIRMED_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="att-diet">Restricción alimentaria</Label>
            <Input id="att-diet" placeholder="Ej: vegetariano, sin gluten"
              value={dietary} onChange={(e) => setDietary(e.target.value)} />
          </div>
          <div className="rounded-md border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="att-plus">Lleva acompañante (+1)</Label>
                <p className="text-xs text-muted-foreground">El evento es +1: se confirma por separado.</p>
              </div>
              <Switch id="att-plus" checked={hasPlusOne} onCheckedChange={setHasPlusOne} />
            </div>
            {hasPlusOne && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="att-plus-name">Nombre del acompañante</Label>
                  <Input id="att-plus-name" placeholder="Por definir"
                    value={plusName} onChange={(e) => setPlusName(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Confirmación del acompañante</Label>
                    <Select value={plusConfirmed} onValueChange={setPlusConfirmed}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ATTENDEE_CONFIRMED_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="att-plus-diet">Restricción alimentaria</Label>
                    <Input id="att-plus-diet" value={plusDietary} onChange={(e) => setPlusDietary(e.target.value)} />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="att-notes">Notas</Label>
            <Input id="att-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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

export function ActivityAttendeesCard({ activityId }: { activityId: string }) {
  const { data: attendees, isLoading } = useActivityAttendees(activityId);
  const updateAttendee = useUpdateActivityAttendee();
  const deleteAttendee = useDeleteActivityAttendee();

  const { data: tasks } = useActivityTasks(activityId);
  const list = attendees ?? [];
  // Personas = asistentes + acompañantes (cuenta para comida, lugares, souvenirs).
  const personas = list.reduce((n, a) => n + 1 + (a.has_plus_one ? 1 : 0), 0);
  const confirmados = list.reduce(
    (n, a) => n + (a.confirmed === "si" ? 1 : 0) + (a.has_plus_one && a.plus_one_confirmed === "si" ? 1 : 0), 0);
  const pendCount: Record<string, { done: number; total: number }> = {};
  for (const t of tasks ?? []) {
    if (!t.activity_attendee_id) continue;
    const c = (pendCount[t.activity_attendee_id] ??= { done: 0, total: 0 });
    c.total += 1;
    if (t.status === "completada") c.done += 1;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Asistentes
          {list.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {confirmados}/{personas} personas confirmadas
            </span>
          )}
        </CardTitle>
        <AttendeeDialog
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
            Sin asistentes aún. Agrega a las personas del equipo o invitados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Confirmación</TableHead>
                  <TableHead>Acompañante (+1)</TableHead>
                  <TableHead>Restricción</TableHead>
                  <TableHead>Pendientes</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell>
                      <Select
                        value={a.confirmed}
                        onValueChange={(v) => updateAttendee.mutate({ id: a.id, confirmed: v })}
                      >
                        <SelectTrigger className="h-8 w-[130px] text-xs">
                          <Badge
                            variant="outline"
                            className={ATTENDEE_CONFIRMED_STYLES[a.confirmed as AttendeeConfirmed]}
                          >
                            {ATTENDEE_CONFIRMED_LABELS[a.confirmed as AttendeeConfirmed] ?? a.confirmed}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {ATTENDEE_CONFIRMED_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {a.has_plus_one ? (
                        <div className="space-y-1">
                          <span className="block text-sm">{a.plus_one_name || "Por definir"}</span>
                          <Select
                            value={a.plus_one_confirmed}
                            onValueChange={(v) => updateAttendee.mutate({ id: a.id, plus_one_confirmed: v })}
                          >
                            <SelectTrigger className="h-7 w-[130px] text-xs">
                              <Badge
                                variant="outline"
                                className={ATTENDEE_CONFIRMED_STYLES[a.plus_one_confirmed as AttendeeConfirmed]}
                              >
                                {ATTENDEE_CONFIRMED_LABELS[a.plus_one_confirmed as AttendeeConfirmed] ?? a.plus_one_confirmed}
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              {ATTENDEE_CONFIRMED_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {a.dietary_restriction || "—"}
                      {a.has_plus_one && a.plus_one_dietary && (
                        <span className="block text-xs text-muted-foreground">+1: {a.plus_one_dietary}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {pendCount[a.id] ? `${pendCount[a.id].done}/${pendCount[a.id].total}` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <AttendeeDialog
                          activityId={activityId}
                          attendee={a}
                          trigger={
                            <Button size="icon" variant="ghost" className="h-7 w-7">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                          onClick={() => deleteAttendee.mutate({ id: a.id, activityId })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
