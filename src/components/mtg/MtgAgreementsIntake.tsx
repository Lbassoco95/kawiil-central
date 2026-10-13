/**
 * Entrada de acuerdos en la minuta: desde los compromisos del resumen o a mano.
 * Quedan como «propuestos»; se confirman abajo (proyecto + fecha + responsable)
 * y de ahí se crea la tarea/seguimiento.
 */

import { useMemo, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useClients } from "@/hooks/useClients";
import type { MtgAgreementRow, MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";
import { addProposedAgreements, parseCommitments } from "@/lib/mtg/commitments";

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
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [entityKey, setEntityKey] = useState("");
  const [busy, setBusy] = useState(false);

  const entities = props.series?.entities ?? [];
  const clientForEntity = (key: string) => entities.find((e) => e.key === key)?.client_id ?? null;
  const clientId =
    (entityKey ? clientForEntity(entityKey) : null) ?? props.meeting.client_id ?? entities[0]?.client_id ?? null;
  const clientName = clients.find((c) => c.id === clientId)?.name;

  const fromSummary = useMemo(() => {
    const seen = new Set(props.agreements.map((a) => a.text.toLowerCase().replace(/\s+/g, " ").trim()));
    return parseCommitments(props.minutesMd).filter(
      (c) => !seen.has(c.text.toLowerCase().replace(/\s+/g, " ").trim()),
    );
  }, [props.minutesMd, props.agreements]);

  const run = async (fn: () => Promise<number>, okMsg: (n: number) => string) => {
    setBusy(true);
    try {
      const n = await fn();
      toast.success(okMsg(n));
      props.onChanged();
      return n;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron crear los acuerdos");
      return 0;
    } finally {
      setBusy(false);
    }
  };

  const base = {
    organizationId: props.organizationId,
    actorUserId: props.actorUserId,
    meetingId: props.meeting.id,
    clientId,
    entityKey: entityKey || null,
    existing: props.agreements,
  };

  const fromSummaryClick = () =>
    run(
      () => addProposedAgreements({ ...base, items: fromSummary, origin: "proposed_by_model" }),
      (n) => `${n} acuerdo(s) propuesto(s) desde el resumen — confírmalos abajo para crear la tarea`,
    );

  const addManual = async () => {
    if (!text.trim()) {
      toast.error("Escribe el acuerdo");
      return;
    }
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
    const n = await run(
      () =>
        addProposedAgreements({
          ...base,
          origin: "added_in_review",
          items: [{ text, owner: owner.trim() || null, dueDate: iso, dueHint: null, ref: null }],
        }),
      () => "Acuerdo agregado — confírmalo abajo para crear la tarea",
    );
    if (n > 0) {
      setText("");
      setOwner("");
      setDue("");
    }
  };

  return (
    <section className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-sm">Agregar acuerdos</h2>
        {clientName && <span className="text-[11px] text-muted-foreground">Cliente: {clientName}</span>}
      </div>

      {fromSummary.length > 0 && (
        <div className="rounded-md bg-primary/5 border border-primary/30 p-2 space-y-1.5">
          <p className="text-xs text-muted-foreground">
            El resumen trae {fromSummary.length} compromiso(s) que aún no son acuerdos:
          </p>
          <ul className="text-xs list-disc pl-4 space-y-0.5">
            {fromSummary.map((c) => (
              <li key={c.text}>
                {c.text}
                {c.owner ? ` — ${c.owner}` : ""}
                {c.dueDate ? ` (${c.dueDate})` : c.dueHint ? ` (${c.dueHint})` : ""}
              </li>
            ))}
          </ul>
          <Button type="button" size="sm" disabled={busy} onClick={() => void fromSummaryClick()}>
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Crear acuerdos desde el resumen
          </Button>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-6">
        <Input
          className="sm:col-span-6"
          placeholder="Texto del acuerdo (qué se compromete y quién)"
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
      <p className="text-[11px] text-muted-foreground">
        Los acuerdos quedan como propuestos: asigna proyecto, fecha y responsable abajo y se crea la tarea.
      </p>
    </section>
  );
}
