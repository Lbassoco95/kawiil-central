/**
 * Asignar uno o varios clientes a la junta (multi-empresa / grupo).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { useClients } from "@/hooks/useClients";
import {
  assignMeetingClient,
  type AssignMeetingClientMode,
} from "@/lib/mtg/assignMeetingClient";
import { assignMeetingClients } from "@/lib/mtg/assignMeetingClients";
import { cn } from "@/lib/utils";

export function MtgAssignClientDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  actorUserId: string;
  meetingId: string;
  currentClientId?: string | null;
  /** client_ids ya en la serie (multi). */
  currentEntityClientIds?: string[];
  onDone?: () => void;
}) {
  const { data: clients = [] } = useClients();
  const [q, setQ] = useState("");
  const [multi, setMulti] = useState(true);
  const [clientId, setClientId] = useState(props.currentClientId ?? "");
  const [selected, setSelected] = useState<string[]>(
    props.currentEntityClientIds?.length
      ? props.currentEntityClientIds
      : props.currentClientId
        ? [props.currentClientId]
        : [],
  );
  const [mode, setMode] = useState<AssignMeetingClientMode>("meeting");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setClientId(props.currentClientId ?? "");
    setSelected(
      props.currentEntityClientIds?.length
        ? props.currentEntityClientIds
        : props.currentClientId
          ? [props.currentClientId]
          : [],
    );
  }, [props.open, props.currentClientId, props.currentEntityClientIds]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients.slice(0, 80);
    return clients.filter((c) => (c.name ?? "").toLowerCase().includes(needle)).slice(0, 80);
  }, [clients, q]);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (multi) {
        if (selected.length === 0) {
          toast.error("Elige uno o más clientes");
          setBusy(false);
          return;
        }
        const res = await assignMeetingClients({
          organizationId: props.organizationId,
          actorUserId: props.actorUserId,
          meetingId: props.meetingId,
          clientIds: selected,
          primaryClientId: selected[0],
        });
        toast.success(
          selected.length > 1
            ? `Junta con ${selected.length} clientes: ${res.entities.map((e) => e.label).join(", ")}`
            : `Cliente ${res.entities[0]?.label ?? ""} asignado`,
          { duration: 8000 },
        );
      } else {
        if (!clientId) {
          toast.error("Elige un cliente");
          setBusy(false);
          return;
        }
        await assignMeetingClient({
          organizationId: props.organizationId,
          actorUserId: props.actorUserId,
          meetingId: props.meetingId,
          clientId,
          mode,
        });
        toast.success(
          mode === "meeting"
            ? "Junta migrada al cliente (contexto + tareas)"
            : "Tareas/seguimientos asignados al cliente",
        );
      }
      props.onOpenChange(false);
      props.onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo asignar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Asignar cliente(s)</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Para juntas de grupo elige varios clientes (p. ej. las tres empresas). Quedan como
          entidades del tablero para filtrar temas y acuerdos.
        </p>

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={multi ? "default" : "outline"}
            onClick={() => setMulti(true)}
          >
            Varios clientes
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!multi ? "default" : "outline"}
            onClick={() => setMulti(false)}
          >
            Un solo cliente
          </Button>
        </div>

        {!multi && (
          <div className="space-y-2">
            <Label>Modo</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as AssignMeetingClientMode)}
              className="space-y-2"
            >
              <label className="flex items-start gap-2 rounded-md border p-2 cursor-pointer">
                <RadioGroupItem value="meeting" className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">Junta completa</span>
                  <span className="block text-muted-foreground text-xs">
                    La reunión queda en la ficha del cliente.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-md border p-2 cursor-pointer">
                <RadioGroupItem value="tasks_only" className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">Solo tareas / seguimientos</span>
                  <span className="block text-muted-foreground text-xs">
                    Prioriza acuerdos→tareas; la junta también se vincula.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>
        )}

        <div className="space-y-2">
          <Label>{multi ? "Clientes" : "Cliente"}</Label>
          <Input
            placeholder="Buscar…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="max-h-52 overflow-y-auto rounded-md border divide-y">
            {filtered.map((c) => {
              const active = multi ? selected.includes(c.id) : clientId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center gap-2",
                    active && "bg-primary/10 font-medium",
                  )}
                  onClick={() => {
                    if (multi) toggle(c.id);
                    else setClientId(c.id);
                  }}
                >
                  {multi && (
                    <Checkbox
                      checked={active}
                      onCheckedChange={() => toggle(c.id)}
                      className="pointer-events-none"
                    />
                  )}
                  {c.name}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground text-center">Sin resultados</p>
            )}
          </div>
          {multi && selected.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {selected.length} seleccionado{selected.length === 1 ? "" : "s"}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={busy || (multi ? selected.length === 0 : !clientId)}
            onClick={() => void submit()}
          >
            {busy ? "Asignando…" : multi ? "Asignar clientes" : "Asignar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
