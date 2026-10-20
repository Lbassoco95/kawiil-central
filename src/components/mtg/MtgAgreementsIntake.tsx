/**
 * Acuerdos de la minuta → tareas.
 * - Compromisos del resumen: se eligen cuáles cargar, con proyecto, responsable y fecha
 *   por fila, y se crean como acuerdos confirmados + tarea.
 * - Agregar un acuerdo a mano.
 * - «Guardar como propuestos» los deja para confirmar uno por uno más abajo.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListChecks, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useClients } from "@/hooks/useClients";
import { useAllClientGroupMembers, useClientGroups } from "@/hooks/useClientGroups";
import { assignMeetingClients } from "@/lib/mtg/assignMeetingClients";
import { useProfiles } from "@/hooks/useTasks";
import { supabase } from "@/integrations/supabase/client";
import type { MtgAgreementRow, MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";
import { addProposedAgreements, matchProfileByName, parseCommitments } from "@/lib/mtg/commitments";
import { captureAgreement } from "@/lib/mtg/captureAgreement";

type Row = { text: string; owner: string | null; ownerUserId: string; dueDate: string; dueHint: string | null; ref: string | null; selected: boolean; projectId: string; clientId: string };
type ProjectOpt = { id: string; name: string; client_id: string };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function MtgAgreementsIntake(props: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
  minutesMd: string;
  agreements: MtgAgreementRow[];
  onChanged: () => void;
}) {
  const { data: clients = [] } = useClients();
  const { data: profiles = [] } = useProfiles();
  const { data: groups = [] } = useClientGroups();
  const { data: members = [] } = useAllClientGroupMembers();
  const [scope, setScope] = useState("");
  const [scopeClients, setScopeClients] = useState<string[]>([]);
  const [savedEntities, setSavedEntities] = useState<MtgSeriesRow["entities"] | null>(null);
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [entityKey, setEntityKey] = useState("");
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => {
    setSavedEntities(null);
    setScope("");
    setScopeClients([]);
    setEntityKey("");
    setProjectId("");
  }, [props.meeting.id]);

  const entities = savedEntities ?? props.series?.entities ?? [];
  const chooseScope = (value: string) => {
    setScope(value);
    const ids = value.startsWith("group:")
      ? members.filter((m) => m.group_id === value.slice(6) && clients.some((c) => c.id === m.client_id)).map((m) => m.client_id)
      : value ? [value.slice(7)] : [];
    setScopeClients([...new Set(ids)]);
    setEntityKey("");
    setProjectId("");
    setRows((rs) => rs.map((r) => ({ ...r, projectId: "", clientId: "" })));
  };
  const saveScope = async () => {
    setBusy(true);
    try {
      const result = await assignMeetingClients({
        organizationId: props.organizationId,
        actorUserId: props.actorUserId,
        meetingId: props.meeting.id,
        clientIds: scopeClients,
      });
      setSavedEntities(result.entities);
      setScope("");
      setScopeClients([]);
      props.onChanged();
      toast.success("Clientes vinculados a la junta");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron vincular los clientes");
    } finally {
      setBusy(false);
    }
  };
  const clientForEntity = (key: string) => entities.find((e) => e.key === key)?.client_id ?? null;
  // Sin cliente en la junta ni en la serie: se elige aquí (sin cliente no hay tarea).
  const needsClientPick = !props.meeting.client_id && entities.length === 0;
  const clientId =
    (entityKey ? clientForEntity(entityKey) : null) ??
    (entities.length > 1 ? null : entities[0]?.client_id ?? props.meeting.client_id ?? null);
  const clientName = clients.find((c) => c.id === clientId)?.name;

  // Proyectos de todas las empresas de la junta: cada compromiso puede ir a uno distinto.
  const clientIds = [
    ...new Set(
      (entities.length ? entities.map((e) => e.client_id) : [props.meeting.client_id]).filter(Boolean) as string[],
    ),
  ];
  const { data: projects = [] } = useQuery({
    queryKey: ["mtg-intake-projects", clientIds.join(",")],
    enabled: clientIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, client_id")
        .in("client_id", clientIds)
        .eq("status", "activo")
        .order("name");
      return (data ?? []) as ProjectOpt[];
    },
  });
  const projectLabel = (p: ProjectOpt) =>
    clientIds.length > 1 ? `${clients.find((c) => c.id === p.client_id)?.name ?? "—"} · ${p.name}` : p.name;
  const applyProjectToAll = (id: string) => {
    setProjectId(id);
    if (id) setRows((rs) => rs.map((r) => (r.selected ? { ...r, projectId: id, clientId: projects.find((p) => p.id === id)?.client_id ?? "" } : r)));
  };

  // Compromisos del resumen que aún no son acuerdos.
  const pending = useMemo(() => {
    const seen = new Set(props.agreements.map((a) => norm(a.text)));
    return parseCommitments(props.minutesMd).filter((c) => !seen.has(norm(c.text)));
  }, [props.minutesMd, props.agreements]);
  const pendingKey = pending.map((c) => c.text).join("|");

  useEffect(() => {
    setRows(
      pending.map((c) => ({
        text: c.text,
        owner: c.owner,
        ownerUserId: matchProfileByName(profiles, c.owner)?.user_id ?? "",
        dueDate: c.dueDate ?? "",
        dueHint: c.dueHint,
        ref: c.ref,
        selected: true,
        projectId: "",
        clientId: "",
      })),
    );
    // se rehace solo cuando cambian los compromisos o llegan los perfiles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, profiles.length, props.meeting.id]);

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const selected = rows.filter((r) => r.selected);

  const guard = () => {
    if (scope) {
      toast.error("Guarda primero los clientes de la junta");
      return false;
    }
    if (!clientId) {
      toast.error("Elige el cliente de la junta", {
        description: "Sin cliente el acuerdo no se puede confirmar ni convertir en tarea.",
      });
      return false;
    }
    return true;
  };

  const base = {
    organizationId: props.organizationId,
    actorUserId: props.actorUserId,
    meetingId: props.meeting.id,
    clientId,
    entityKey: entityKey || null,
    existing: props.agreements,
  };

  const asProposed = async () => {
    if (!guard() || selected.length === 0) return;
    setBusy(true);
    try {
      const n = await addProposedAgreements({
        ...base,
        origin: "proposed_by_model",
        items: selected.map((r) => ({
          text: r.text,
          owner: r.ownerUserId ? (profiles.find((p) => p.user_id === r.ownerUserId)?.full_name ?? r.owner) : r.owner,
          dueDate: r.dueDate || null,
          dueHint: r.dueHint,
          ref: r.ref,
        })),
      });
      toast.success(`${n} acuerdo(s) propuesto(s) — confírmalos abajo`);
      props.onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron crear los acuerdos");
    } finally {
      setBusy(false);
    }
  };

  const asTasks = async () => {
    if (scope) {
      toast.error("Guarda primero los clientes de la junta");
      return;
    }
    if (selected.length === 0) return;
    const lacks = (r: Row) =>
      [!projects.some((p) => p.id === r.projectId && clientIds.includes(p.client_id)) && "proyecto", !r.dueDate && "fecha", !r.ownerUserId && !r.owner?.trim() && "responsable"].filter(Boolean);
    const missing = selected.filter((r) => lacks(r).length > 0);
    if (missing.length > 0) {
      setShowMissing(true);
      toast.error(`Faltan datos en ${missing.length} compromiso(s)`, {
        description:
          "Cada tarea necesita proyecto, fecha y responsable (si no, la minuta no se puede aprobar). Revisa los campos marcados.",
        duration: 10000,
      });
      return;
    }
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const r of selected) {
      try {
        const profile = profiles.find((p) => p.user_id === r.ownerUserId);
        const proj = projects.find((p) => p.id === r.projectId);
        await captureAgreement({
          organizationId: props.organizationId,
          actorUserId: props.actorUserId,
          meetingId: props.meeting.id,
          clientId: proj?.client_id ?? clientId,
          entityKey: entities.find((e) => e.client_id === proj?.client_id)?.key ?? (entityKey || null),
          projectId: r.projectId,
          text: r.text,
          ownerSide: r.ownerUserId ? "kawiil" : "client",
          ownerUserId: r.ownerUserId || null,
          ownerName: profile?.full_name ?? r.owner,
          dueDate: r.dueDate || null,
          origin: "proposed_by_model",
          confirm: true,
        });
        ok += 1;
      } catch (e) {
        failed.push(`${r.text.slice(0, 40)}… (${e instanceof Error ? e.message : "error"})`);
      }
    }
    setBusy(false);
    if (ok > 0) toast.success(`${ok} tarea(s) creada(s) en sus proyectos`);
    if (failed.length > 0) toast.error(`No se pudieron cargar ${failed.length}`, { description: failed.join("\n"), duration: 12000 });
    props.onChanged();
  };

  const addManual = async () => {
    if (!guard()) return;
    if (!text.trim()) {
      toast.error("Escribe el acuerdo");
      return;
    }
    setBusy(true);
    try {
      await addProposedAgreements({
        ...base,
        origin: "added_in_review",
        items: [{ text, owner: owner.trim() || null, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null, dueHint: null, ref: null }],
      });
      toast.success("Acuerdo agregado — confírmalo abajo para crear la tarea");
      setText("");
      setOwner("");
      setDue("");
      props.onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo agregar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-sm">Acuerdos y tareas</h2>
        {clientName && <span className="text-[11px] text-muted-foreground">Cliente: {clientName}</span>}
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {needsClientPick ? "Vincula un cliente o grupo para crear tareas." : "Puedes vincular un cliente o elegir las empresas de un grupo."}
        </p>
        <label className="block space-y-1 text-xs">
          <span>Cliente o grupo de la junta</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={scope}
            disabled={busy}
            onChange={(e) => chooseScope(e.target.value)}
          >
            <option value="">Seleccionar cliente o grupo…</option>
            <optgroup label="Grupos">
              {groups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}
            </optgroup>
            <optgroup label="Clientes">
              {clients.map((c) => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}
            </optgroup>
          </select>
        </label>
        {scope.startsWith("group:") && (
          <fieldset className="max-h-44 overflow-y-auto rounded-md border p-2 space-y-2" disabled={busy}>
            <legend className="px-1 text-xs">Clientes del grupo que participan en la junta</legend>
            {clients.filter((c) => members.some((m) => m.group_id === scope.slice(6) && m.client_id === c.id)).map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={scopeClients.includes(c.id)} onCheckedChange={(checked) => setScopeClients((ids) => checked ? [...ids, c.id] : ids.filter((id) => id !== c.id))} />
                {c.name}
              </label>
            ))}
            {!members.some((m) => m.group_id === scope.slice(6) && clients.some((c) => c.id === m.client_id)) && <p className="text-xs text-muted-foreground">Este grupo no tiene clientes disponibles.</p>}
          </fieldset>
        )}
        {scope && <Button type="button" size="sm" disabled={busy || !scopeClients.length} onClick={() => void saveScope()}>Guardar clientes de la junta</Button>}
        {entities.length > 1 && <p className="text-xs text-muted-foreground">Clientes vinculados: {entities.map((e) => e.label).join(", ")}. El proyecto de cada tarea determina su cliente.</p>}
      </div>

      {rows.length > 0 && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Compromisos del resumen ({selected.length} de {rows.length} seleccionados):
            </p>
            <button
              type="button"
              className="text-xs underline text-muted-foreground"
              onClick={() => setRows((rs) => rs.map((r) => ({ ...r, selected: !rs.every((x) => x.selected) })))}
            >
              {rows.every((r) => r.selected) ? "Quitar todos" : "Seleccionar todos"}
            </button>
          </div>

          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={r.text} className="rounded-md bg-background/80 border p-2 space-y-1.5">
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox checked={r.selected} onCheckedChange={(v) => patch(i, { selected: !!v })} className="mt-0.5" />
                  <span className="min-w-0">{r.text}</span>
                </label>
                <div className="grid gap-1.5 sm:grid-cols-5 pl-6">
                  <select
                    className={`sm:col-span-3 h-8 rounded-md border bg-background px-2 text-xs ${showMissing && r.selected && !r.ownerUserId && !r.owner?.trim() ? "border-red-500" : ""}`}
                    value={r.ownerUserId}
                    onChange={(e) => patch(i, { ownerUserId: e.target.value })}
                    title="Responsable"
                  >
                    <option value="">{r.owner ? `${r.owner} (externo / sin asignar)` : "Responsable…"}</option>
                    {profiles.map((p) => (
                      <option key={p.user_id} value={p.user_id}>
                        {p.full_name || p.email}
                      </option>
                    ))}
                  </select>
                  <Input
                    className={`sm:col-span-2 h-8 text-xs ${showMissing && r.selected && !r.dueDate ? "border-red-500" : ""}`}
                    type="date"
                    value={r.dueDate}
                    onChange={(e) => patch(i, { dueDate: e.target.value })}
                    title={r.dueHint ? `Plazo dicho: ${r.dueHint}` : "Fecha límite"}
                  />
                </div>
                <div className="pl-6 space-y-1.5">
                  {clientIds.length > 1 && (
                    <select
                      className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                      aria-label="Cliente de esta tarea"
                      value={r.clientId}
                      onChange={(e) => patch(i, { clientId: e.target.value, projectId: "" })}
                    >
                      <option value="">Todos los clientes de la junta</option>
                      {clients.filter((c) => clientIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                  <select
                    className={`h-8 w-full rounded-md border bg-background px-2 text-xs ${showMissing && r.selected && !r.projectId ? "border-red-500" : ""}`}
                    value={r.projectId}
                    onChange={(e) => patch(i, { projectId: e.target.value, clientId: projects.find((p) => p.id === e.target.value)?.client_id ?? r.clientId })}
                    disabled={projects.length === 0}
                    title="Proyecto de esta tarea"
                  >
                    <option value="">
                      {projects.length ? "Proyecto de esta tarea…" : clientIds.length ? "Sin proyectos activos" : "Elige cliente primero"}
                    </option>
                    {projects.filter((p) => !r.clientId || p.client_id === r.clientId).map((p) => (
                      <option key={p.id} value={p.id}>
                        {projectLabel(p)}
                      </option>
                    ))}
                  </select>
                </div>
                {r.dueHint && !r.dueDate && <p className="pl-6 text-[11px] text-muted-foreground">Plazo dicho: {r.dueHint}</p>}
              </div>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-5">
            <select
              className="sm:col-span-3 h-9 rounded-md border bg-background px-2 text-sm"
              value={projectId}
              onChange={(e) => applyProjectToAll(e.target.value)}
              disabled={projects.length === 0}
            >
              <option value="">{projects.length ? "Proyecto para todas (opcional)…" : clientIds.length ? "Sin proyectos activos" : "Elige cliente primero"}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {projectLabel(p)}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" className="sm:col-span-2" disabled={busy || selected.length === 0} onClick={() => void asTasks()}>
              <ListChecks className="h-3.5 w-3.5 mr-1" />
              Cargar {selected.length} como tareas
            </Button>
          </div>
          <button
            type="button"
            className="text-xs underline text-muted-foreground disabled:opacity-50"
            disabled={busy || selected.length === 0}
            onClick={() => void asProposed()}
          >
            O guardarlos solo como acuerdos propuestos (para confirmarlos uno por uno)
          </button>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-6">
        <Input
          className="sm:col-span-6"
          placeholder="Agregar otro acuerdo (qué se compromete y quién)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void addManual()}
        />
        <Input className="sm:col-span-3" placeholder="Responsable" value={owner} onChange={(e) => setOwner(e.target.value)} />
        <Input className="sm:col-span-2" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        {entities.length > 1 && (
          <select
            className="sm:col-span-3 h-9 rounded-md border bg-background px-2 text-sm"
            value={entityKey}
            aria-label="Cliente para acuerdos propuestos o manuales"
            onChange={(e) => setEntityKey(e.target.value)}
          >
            <option value="">Empresa…</option>
            {entities.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </select>
        )}
        <Button type="button" size="sm" className="sm:col-span-1" disabled={busy} onClick={() => void addManual()}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Agregar
        </Button>
      </div>
    </section>
  );
}
