import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Users, Check, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { normalizeWhatsappNumber } from "@/lib/whatsapp";
import { FoodCountDialog } from "@/components/actividades/FoodCountDialog";
import { InviteMessageDialog } from "@/components/actividades/InviteMessageDialog";
import { useActivityTasks } from "@/hooks/useActivities";
import { useProfiles } from "@/hooks/useTasks";
import {
  ATTENDEE_CONFIRMED_OPTIONS, ATTENDEE_CONFIRMED_STYLES, ATTENDEE_CONFIRMED_LABELS,
  type AttendeeConfirmed,
} from "@/lib/activityTypes";
import {
  useActivityAttendees, useCreateActivityAttendee, useUpdateActivityAttendee,
  useDeleteActivityAttendee, type ActivityAttendee,
} from "@/hooks/useActivityExtras";
import { buildGuestOverview, type GuestOverview, type GuestStatus } from "@/lib/activityGuestOverview";

function AttendeeDialog({
  activityId, attendee, trigger,
}: { activityId: string; attendee?: ActivityAttendee; trigger: React.ReactNode }) {
  const isEdit = !!attendee;
  const [open, setOpen] = useState(false);
  const createAttendee = useCreateActivityAttendee();
  const updateAttendee = useUpdateActivityAttendee();

  const { data: profiles } = useProfiles();
  const [name, setName] = useState("");
  const [linkedUser, setLinkedUser] = useState<string>("none");
  const [confirmed, setConfirmed] = useState<string>("pendiente");
  const [dietary, setDietary] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [hasPlusOne, setHasPlusOne] = useState(false);
  const [plusName, setPlusName] = useState("");
  const [plusConfirmed, setPlusConfirmed] = useState<string>("pendiente");
  const [plusDietary, setPlusDietary] = useState("");
  const [plusPhone, setPlusPhone] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(attendee?.name ?? "");
    setLinkedUser(attendee?.user_id ?? "none");
    setConfirmed(attendee?.confirmed ?? "pendiente");
    setDietary(attendee?.dietary_restriction ?? "");
    setPhone(attendee?.phone ?? "");
    setNotes(attendee?.notes ?? "");
    setHasPlusOne(attendee?.has_plus_one ?? false);
    setPlusName(attendee?.plus_one_name ?? "");
    setPlusConfirmed(attendee?.plus_one_confirmed ?? "pendiente");
    setPlusDietary(attendee?.plus_one_dietary ?? "");
    setPlusPhone(attendee?.plus_one_phone ?? "");
  }, [open, attendee]);

  const isPending = createAttendee.isPending || updateAttendee.isPending;

  const handleSubmit = () => {
    const payload = {
      name: name.trim(),
      user_id: linkedUser === "none" ? null : linkedUser,
      confirmed,
      dietary_restriction: dietary.trim() || null,
      phone: phone.trim() || null,
      notes: notes.trim() || null,
      has_plus_one: hasPlusOne,
      plus_one_status: hasPlusOne ? "aprobado" : "none",
      plus_one_name: hasPlusOne ? plusName.trim() || null : null,
      plus_one_confirmed: hasPlusOne ? plusConfirmed : "pendiente",
      plus_one_dietary: hasPlusOne ? plusDietary.trim() || null : null,
      plus_one_phone: hasPlusOne ? plusPhone.trim() || null : null,
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
            <Label>Cuenta de Kawiil (para que vea su invitación)</Label>
            <Select value={linkedUser} onValueChange={setLinkedUser}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin cuenta (invitado externo)</SelectItem>
                {(profiles ?? []).map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>
                    {p.full_name || p.email}{p.email && p.full_name ? ` · ${p.email}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Si lo ligas a su cuenta, esa persona verá en “Mis invitaciones” solo la suya, cuando la actividad sea visible para el equipo.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="att-phone">Teléfono / WhatsApp</Label>
            <Input id="att-phone" type="tel" inputMode="tel" placeholder="Ej: 55 1234 5678"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
            {phone.trim() && !normalizeWhatsappNumber(phone) && (
              <p className="text-xs text-destructive">
                No parece un número válido. Usa 10 dígitos (México) o el formato internacional con +.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Se usa para enviarle el mensaje del evento directo por WhatsApp.
            </p>
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
                <div className="space-y-2">
                  <Label htmlFor="att-plus-phone">Teléfono / WhatsApp del acompañante</Label>
                  <Input id="att-plus-phone" type="tel" inputMode="tel" placeholder="Ej: 55 1234 5678"
                    value={plusPhone} onChange={(e) => setPlusPhone(e.target.value)} />
                  {plusPhone.trim() && !normalizeWhatsappNumber(plusPhone) && (
                    <p className="text-xs text-destructive">
                      No parece un número válido. Usa 10 dígitos (México) o el formato internacional con +.
                    </p>
                  )}
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

function ConfirmSelect({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const status = (value === "si" || value === "no" ? value : "pendiente") as AttendeeConfirmed;
  return (
    <Select value={status} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[124px] text-xs">
        <Badge variant="outline" className={ATTENDEE_CONFIRMED_STYLES[status]}>
          {ATTENDEE_CONFIRMED_LABELS[status]}
        </Badge>
      </SelectTrigger>
      <SelectContent>
        {ATTENDEE_CONFIRMED_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const STATUS_TONE: Record<GuestStatus, string> = {
  si: "text-emerald-800",
  no: "text-rose-800",
  pendiente: "text-muted-foreground",
};

function GuestOverviewPanel({ overview }: { overview: GuestOverview }) {
  const total = overview.invitadosTotal;
  const pct = total === 0 ? 0 : Math.round((overview.confirman / total) * 100);
  const approvedExtras = overview.extras.filter((e) => e.status === "aprobado");
  const showCompanions = overview.plusOnes.length > 0 || overview.plusSinNombre > 0 || approvedExtras.length > 0;
  const headline = overview.confirman === 0
    ? `Nadie ha confirmado · ${total} ${total === 1 ? "invitado" : "invitados"}`
    : overview.confirman === total
      ? (total === 1 ? "El invitado confirma" : `Los ${total} invitados confirman`)
      : `${overview.confirman} de ${total} invitados confirman`;

  return (
    <div className="mb-4 space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Cómo vamos</p>
        <p className="text-sm">{headline}</p>
        <p className="text-xs text-muted-foreground">
          Vienen {overview.vienen} {overview.vienen === 1 ? "persona" : "personas"}
          {(overview.plusOnes.length > 0 || overview.plusSinNombre > 0 || approvedExtras.length > 0)
            ? " (con +1 y extras)"
            : ""}
          {overview.porConfirmar > 0 ? ` · ${overview.porConfirmar} por confirmar` : ""}
        </p>
      </div>
      <Progress value={pct} aria-label={`${overview.confirman} de ${total} invitados confirman`} />
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-center">
          <p className="text-lg font-semibold leading-none text-emerald-800">{overview.confirman}</p>
          <p className="mt-1 text-[11px] text-emerald-800/80">Confirman</p>
        </div>
        <div className="rounded-md border bg-background px-2 py-1.5 text-center">
          <p className="text-lg font-semibold leading-none">{overview.pendientes}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Pendientes</p>
        </div>
        <div className={`rounded-md border px-2 py-1.5 text-center ${overview.noAsisten > 0 ? "border-rose-200 bg-rose-50" : "bg-background"}`}>
          <p className={`text-lg font-semibold leading-none ${overview.noAsisten > 0 ? "text-rose-800" : ""}`}>{overview.noAsisten}</p>
          <p className={`mt-1 text-[11px] ${overview.noAsisten > 0 ? "text-rose-800/80" : "text-muted-foreground"}`}>No asisten</p>
        </div>
      </div>

      {showCompanions && (
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">Acompañantes, con nombre</p>
          {overview.plusOnes.length > 0 && (
            <ul className="space-y-1.5">
              {overview.plusOnes.map((p) => (
                <li key={p.attendeeId} className="text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground"> · con {p.host}</span>
                  <span className={`ml-1.5 text-xs ${p.hostDeclined ? "text-rose-800" : STATUS_TONE[p.status]}`}>
                    {p.hostDeclined ? "No viene" : ATTENDEE_CONFIRMED_LABELS[p.status]}
                  </span>
                  {p.dietary && (
                    <span className="block text-xs text-muted-foreground">{p.dietary}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {overview.plusSinNombre > 0 && (
            <p className="text-xs text-muted-foreground">
              {overview.plusSinNombre === 1
                ? "1 acompañante todavía sin nombre"
                : `${overview.plusSinNombre} acompañantes todavía sin nombre`}
            </p>
          )}
          {approvedExtras.length > 0 && (
            <ul className="space-y-1">
              {approvedExtras.map((e) => (
                <li key={`${e.attendeeId}-extra`} className="text-sm">
                  <span className="font-medium">
                    +{e.count} extra {e.count === 1 ? "aprobado" : "aprobados"}
                  </span>
                  <span className="text-muted-foreground"> · de {e.host}</span>
                  {e.note && <span className="block text-xs text-muted-foreground">{e.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AttendeeRow({
  activityId, attendee, pend, onConfirm, onPlusConfirm, onApproveExtra, onRejectExtra, onDelete, busy,
}: {
  activityId: string;
  attendee: ActivityAttendee;
  pend?: { done: number; total: number };
  onConfirm: (v: string) => void;
  onPlusConfirm: (v: string) => void;
  onApproveExtra: () => void;
  onRejectExtra: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const detail = [attendee.phone, attendee.dietary_restriction].filter(Boolean).join(" · ");
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{attendee.name}</p>
          {(detail || pend) && (
            <p className="text-xs text-muted-foreground">
              {detail}
              {detail && pend ? " · " : ""}
              {pend ? `Pendientes ${pend.done}/${pend.total}` : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ConfirmSelect value={attendee.confirmed} onChange={onConfirm} />
          <AttendeeDialog
            activityId={activityId}
            attendee={attendee}
            trigger={
              <Button size="icon" variant="ghost" className="h-7 w-7">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            }
          />
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {attendee.has_plus_one && (
        <div className="mt-2 ml-1 flex flex-wrap items-start justify-between gap-2 border-l pl-3">
          <div className="min-w-0">
            <p className="text-sm">
              <span className="text-muted-foreground">+1 </span>
              {attendee.plus_one_name?.trim() || "Sin nombre"}
            </p>
            {(attendee.plus_one_phone || attendee.plus_one_dietary) && (
              <p className="text-xs text-muted-foreground">
                {[attendee.plus_one_phone, attendee.plus_one_dietary].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <ConfirmSelect value={attendee.plus_one_confirmed} onChange={onPlusConfirm} />
        </div>
      )}

      {attendee.extra_guests_status === "solicitado" && (
        <div className="mt-2 space-y-1.5 rounded-md border border-amber-200 bg-amber-50 p-2">
          <p className="text-xs font-medium text-amber-900">
            Pide {attendee.extra_guests_requested} {attendee.extra_guests_requested === 1 ? "invitado extra" : "invitados extra"}
          </p>
          {attendee.extra_guests_note && (
            <p className="text-xs text-amber-900/80">{attendee.extra_guests_note}</p>
          )}
          <div className="flex gap-1.5">
            <Button size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={onApproveExtra}>
              <Check className="mr-1 h-3 w-3" />Aprobar
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={onRejectExtra}>
              <X className="mr-1 h-3 w-3" />Rechazar
            </Button>
          </div>
        </div>
      )}
      {attendee.extra_guests_status === "aprobado" && (
        <p className="mt-1.5 text-xs text-emerald-800">
          +{attendee.extra_guests_requested} extra {attendee.extra_guests_requested === 1 ? "aprobado" : "aprobados"}
          {attendee.extra_guests_note ? ` · ${attendee.extra_guests_note}` : ""}
        </p>
      )}
      {attendee.extra_guests_status === "rechazado" && (
        <p className="mt-1.5 text-xs text-muted-foreground">Extra rechazado</p>
      )}
    </li>
  );
}

export function ActivityAttendeesCard({ activityId }: { activityId: string }) {
  const { data: attendees, isLoading } = useActivityAttendees(activityId);
  const updateAttendee = useUpdateActivityAttendee();
  const deleteAttendee = useDeleteActivityAttendee();

  const { data: tasks } = useActivityTasks(activityId);
  const list = attendees ?? [];
  const overview = buildGuestOverview(list);
  const pendCount: Record<string, { done: number; total: number }> = {};
  for (const t of tasks ?? []) {
    if (!t.activity_attendee_id) continue;
    const c = (pendCount[t.activity_attendee_id] ??= { done: 0, total: 0 });
    c.total += 1;
    if (t.status === "completada") c.done += 1;
  }
  const groups = [
    { key: "si", title: "Confirman", items: list.filter((a) => a.confirmed === "si") },
    { key: "pendiente", title: "Pendientes", items: list.filter((a) => a.confirmed !== "si" && a.confirmed !== "no") },
    { key: "no", title: "No asisten", items: list.filter((a) => a.confirmed === "no") },
  ].filter((g) => g.items.length > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <Users className="h-4 w-4" />
          Asistentes
          {overview.porAprobar > 0 && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
              {overview.porAprobar} {overview.porAprobar === 1 ? "solicitud" : "solicitudes"} de invitados extra por aprobar
            </Badge>
          )}
        </CardTitle>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <InviteMessageDialog activityId={activityId} />
          <FoodCountDialog activityId={activityId} />
          <AttendeeDialog
            activityId={activityId}
            trigger={
              <Button size="sm" variant="outline">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Agregar
              </Button>
            }
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Cargando...</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Sin asistentes aún. Agrega a las personas del equipo o invitados.
          </p>
        ) : (
          <div>
            <GuestOverviewPanel overview={overview} />
            <div className="space-y-4">
              {groups.map((group) => (
                <section key={group.key}>
                  <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
                    {group.title} · {group.items.length}
                  </h3>
                  <ul className="divide-y rounded-lg border">
                    {group.items.map((a) => (
                      <AttendeeRow
                        key={a.id}
                        activityId={activityId}
                        attendee={a}
                        pend={pendCount[a.id]}
                        busy={updateAttendee.isPending}
                        onConfirm={(v) => updateAttendee.mutate({ id: a.id, confirmed: v })}
                        onPlusConfirm={(v) => updateAttendee.mutate({ id: a.id, plus_one_confirmed: v })}
                        onApproveExtra={() => updateAttendee.mutate({ id: a.id, extra_guests_status: "aprobado" })}
                        onRejectExtra={() => updateAttendee.mutate({ id: a.id, extra_guests_status: "rechazado" })}
                        onDelete={() => deleteAttendee.mutate({ id: a.id, activityId })}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
