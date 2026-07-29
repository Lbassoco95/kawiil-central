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

  useEffect(() => {
    if (!open) return;
    setName(attendee?.name ?? "");
    setConfirmed(attendee?.confirmed ?? "pendiente");
    setDietary(attendee?.dietary_restriction ?? "");
    setNotes(attendee?.notes ?? "");
  }, [open, attendee]);

  const isPending = createAttendee.isPending || updateAttendee.isPending;

  const handleSubmit = () => {
    const payload = {
      name: name.trim(),
      confirmed,
      dietary_restriction: dietary.trim() || null,
      notes: notes.trim() || null,
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
      <DialogContent className="max-w-md">
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

  const list = attendees ?? [];
  const confirmados = list.filter((a) => a.confirmed === "si").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Asistentes
          {list.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {confirmados}/{list.length} confirmados
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
                  <TableHead>Restricción</TableHead>
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
                    <TableCell>{a.dietary_restriction || "—"}</TableCell>
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
