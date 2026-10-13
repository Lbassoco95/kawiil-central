/**
 * Memoria de personas en la minuta: quiénes estuvieron en la junta, por empresa,
 * con rol y notas que se acumulan junta tras junta (y alimentan los resúmenes).
 */

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, UserCheck, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useClients } from "@/hooks/useClients";
import { useMtgPeople, type MtgPersonWithHistory } from "@/hooks/useMtgPeople";
import type { MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";
import {
  parseParticipantNames,
  personMatches,
  savePersonToMemory,
  unlinkPersonFromMeeting,
} from "@/lib/mtg/people";

const NO_CLIENT = "__none__";
const KAWIIL = "__kawiil__";

type Draft = {
  personId: string | null;
  name: string;
  company: string;
  role: string;
  email: string;
  notes: string;
  meetingNote: string;
};

const EMPTY: Draft = { personId: null, name: "", company: NO_CLIENT, role: "", email: "", notes: "", meetingNote: "" };

export function MtgPeoplePanel(props: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
  minutesMd: string;
}) {
  const qc = useQueryClient();
  const { data: clients = [] } = useClients();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const clientIds = useMemo(
    () =>
      [...new Set([props.meeting.client_id, ...(props.series?.entities ?? []).map((e) => e.client_id)].filter(Boolean))] as string[],
    [props.meeting.client_id, props.series],
  );
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? null;
  const { data: people = [] } = useMtgPeople(props.meeting.id, clientIds);

  const linked = people.filter((p) => p.linked);
  const memory = people.filter((p) => !p.linked);
  const suggestions = useMemo(
    () => parseParticipantNames(props.minutesMd).filter((n) => !people.some((p) => personMatches(p, n))),
    [props.minutesMd, people],
  );
  const defaultCompany = clientIds.length === 1 ? clientIds[0] : NO_CLIENT;

  const openNew = (name = "") => setDraft({ ...EMPTY, name, company: defaultCompany });
  const openEdit = (p: MtgPersonWithHistory) =>
    setDraft({
      personId: p.id,
      name: p.name,
      company: p.side === "kawiil" ? KAWIIL : (p.client_id ?? NO_CLIENT),
      role: p.role ?? "",
      email: p.email ?? "",
      notes: p.notes ?? "",
      meetingNote: p.meetingNote ?? "",
    });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["mtg-people", props.meeting.id] });

  const save = async () => {
    if (!draft || !draft.name.trim()) {
      toast.error("Escribe el nombre");
      return;
    }
    setBusy(true);
    try {
      await savePersonToMemory({
        organizationId: props.organizationId,
        actorUserId: props.actorUserId,
        meetingId: props.meeting.id,
        personId: draft.personId,
        name: draft.name,
        clientId: draft.company === NO_CLIENT || draft.company === KAWIIL ? null : draft.company,
        side: draft.company === KAWIIL ? "kawiil" : draft.company === NO_CLIENT ? "other" : "client",
        role: draft.role,
        email: draft.email,
        notes: draft.notes,
        meetingNote: draft.meetingNote,
      });
      toast.success("Guardado en la memoria de personas");
      setDraft(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar (¿migración aplicada?)");
    } finally {
      setBusy(false);
    }
  };

  const addToMeeting = async (p: MtgPersonWithHistory) => {
    try {
      await savePersonToMemory({
        organizationId: props.organizationId,
        actorUserId: props.actorUserId,
        meetingId: props.meeting.id,
        personId: p.id,
        name: p.name,
        clientId: p.client_id,
        side: p.side,
        role: p.role ?? "",
        email: p.email ?? "",
        notes: p.notes ?? "",
        meetingNote: "",
      });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo agregar");
    }
  };

  const remove = async (p: MtgPersonWithHistory) => {
    try {
      await unlinkPersonFromMeeting(props.meeting.id, p.id);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo quitar");
    }
  };

  const card = (p: MtgPersonWithHistory, action: React.ReactNode) => (
    <div key={p.id} className="border rounded-md p-2.5 text-sm space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">{p.name}</p>
          <p className="text-xs text-muted-foreground">
            {[p.role, p.side === "kawiil" ? "Kawiil" : clientName(p.client_id), `${p.meetingsCount} junta${p.meetingsCount === 1 ? "" : "s"}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openEdit(p)}>
            Editar
          </Button>
          {action}
        </div>
      </div>
      {p.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{p.notes}</p>}
      {p.linked && p.meetingNote && (
        <p className="text-xs border-l-2 border-primary/40 pl-2 whitespace-pre-wrap">Esta junta: {p.meetingNote}</p>
      )}
    </div>
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm">Personas de la junta</h2>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => openNew()}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Agregar persona
        </Button>
      </div>

      {suggestions.length > 0 && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 space-y-1.5">
          <p className="text-xs text-muted-foreground">Identificadas en el resumen — guárdalas en la memoria:</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((n) => (
              <Button key={n} type="button" size="sm" variant="secondary" className="h-7 text-xs" onClick={() => openNew(n)}>
                <UserPlus className="h-3.5 w-3.5 mr-1" />
                {n}
              </Button>
            ))}
          </div>
        </div>
      )}

      {linked.length === 0 && suggestions.length === 0 && (
        <p className="text-sm text-muted-foreground">Aún no hay personas registradas en esta junta.</p>
      )}
      {linked.map((p) =>
        card(
          p,
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Quitar de esta junta" onClick={() => void remove(p)}>
            <X className="h-3.5 w-3.5" />
          </Button>,
        ),
      )}

      {memory.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Memoria de la empresa (otras juntas)</p>
          {memory.map((p) =>
            card(
              p,
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void addToMeeting(p)}>
                <UserCheck className="h-3.5 w-3.5 mr-1" />
                Estuvo
              </Button>,
            ),
          )}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.personId ? "Editar persona" : "Guardar persona en la memoria"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Nombre</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Empresa</Label>
                <Select value={draft.company} onValueChange={(v) => setDraft({ ...draft, company: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={KAWIIL}>Kawiil (equipo interno)</SelectItem>
                    {clientIds.map((id) => (
                      <SelectItem key={id} value={id}>
                        {clientName(id) ?? "Cliente"}
                      </SelectItem>
                    ))}
                    <SelectItem value={NO_CLIENT}>Sin empresa / otra</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Rol / puesto</Label>
                  <Input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="Director financiero" />
                </div>
                <div className="space-y-1">
                  <Label>Correo</Label>
                  <Input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Memoria (siempre)</Label>
                <Textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Quién es, qué decide, cómo prefiere trabajar, temas que lleva…"
                />
              </div>
              <div className="space-y-1">
                <Label>Qué se trabajó en esta junta</Label>
                <Textarea rows={2} value={draft.meetingNote} onChange={(e) => setDraft({ ...draft, meetingNote: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  Cancelar
                </Button>
                <Button type="button" disabled={busy} onClick={() => void save()}>
                  {busy ? "Guardando…" : "Guardar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
