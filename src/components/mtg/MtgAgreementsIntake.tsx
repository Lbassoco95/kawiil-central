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
import { useProfiles } from "@/hooks/useTasks";
import { supabase } from "@/integrations/supabase/client";
import type { MtgAgreementRow, MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";
import { addProposedAgreements, matchProfileByName, parseCommitments } from "@/lib/mtg/commitments";
import { captureAgreement } from "@/lib/mtg/captureAgreement";

type Row = { text: string; owner: string | null; ownerUserId: string; dueDate: string; dueHint: string | null; ref: string | null; selected: boolean };

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
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [entityKey, setEntityKey] = useState("");
  const [pickedClient, setPickedClient] = useState("");
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const entities = props.series?.entities ?? [];
  const clientForEntity = (key: string) => entities.find((e) => e.key === key)?.client_id ?? null;
  // Sin cliente en la junta ni en la serie: se elige aquí (sin cliente no hay tarea).
  const needsClientPick = !props.meeting.client_id && entities.length === 0;
  const clientId =
    (entityKey ? clientForEntity(entityKey) : null) ??
    props.meeting.client_id ??
    entities[0]?.client_id ??
    (pickedClient || null);
  const clientName = clients.find((c) => c.id === clientId)?.name;

  const { data: projects = [] } = useQuery({
    queryKey: ["mtg-intake-projects", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name")
        .eq("client_id", clientId!)
        .eq("status", "activo")
        .order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  useEffect(() => setProjectId(""), [clientId]);

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
      })),
    );
    // se rehace solo cuando cambian los compromisos o llegan los perfiles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, profiles.length]);

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const selected = rows.filter((r) => r.selected);

  const guard = () => {
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
    if (!guard() || selected.length === 0) return;
    if (!projectId) {
      toast.error("Elige el proyecto", { description: "Las tareas se crean dentro de un proyecto del cliente." });
      return;
    }
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const r of selected) {
      try {
        const profile = profiles.find((p) => p.user_id === r.ownerUserId);
        await captureAgreement({
          organizationId: props.organizationId,
          actorUserId: props.actorUserId,
          meetingId: props.meeting.id,
          clientId,
          entityKey: entityKey || null,
          projectId,
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
    if (ok > 0) toast.success(`${ok} tarea(s) creada(s) en el proyecto`);
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

      {needsClientPick && (
        <div className="space-y-1">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Esta junta no tiene cliente: elige uno para poder crear tareas desde los acuerdos.
          </p>
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={pickedClient}
            onChange={(e) => setPickedClient(e.target.value)}
          >
            <option value="">Cliente…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

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
                    className="sm:col-span-3 h-8 rounded-md border bg-background px-2 text-xs"
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
                    className="sm:col-span-2 h-8 text-xs"
                    type="date"
                    value={r.dueDate}
                    onChange={(e) => patch(i, { dueDate: e.target.value })}
                    title={r.dueHint ? `Plazo dicho: ${r.dueHint}` : "Fecha límite"}
                  />
                </div>
                {r.dueHint && !r.dueDate && <p className="pl-6 text-[11px] text-muted-foreground">Plazo dicho: {r.dueHint}</p>}
              </div>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-5">
            <select
              className="sm:col-span-3 h-9 rounded-md border bg-background px-2 text-sm"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={!clientId}
            >
              <option value="">{clientId ? (projects.length ? "Proyecto de las tareas…" : "Sin proyectos activos") : "Elige cliente primero"}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
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
