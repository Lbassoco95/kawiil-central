/**
 * Asignar / migrar junta a un cliente (o solo tareas/seguimientos).
 */

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { useClients } from "@/hooks/useClients";
import {
  assignMeetingClient,
  type AssignMeetingClientMode,
} from "@/lib/mtg/assignMeetingClient";

export function MtgAssignClientDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  actorUserId: string;
  meetingId: string;
  currentClientId?: string | null;
  onDone?: () => void;
}) {
  const { data: clients = [] } = useClients();
  const [q, setQ] = useState("");
  const [clientId, setClientId] = useState(props.currentClientId ?? "");
  const [mode, setMode] = useState<AssignMeetingClientMode>("meeting");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients.slice(0, 50);
    return clients.filter((c) => (c.name ?? "").toLowerCase().includes(needle)).slice(0, 50);
  }, [clients, q]);

  const submit = async () => {
    if (!clientId) {
      toast.error("Elige un cliente");
      return;
    }
    setBusy(true);
    try {
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
          : "Tareas/seguimientos asignados al cliente (la junta conserva el vínculo)",
      );
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
          <DialogTitle>Asignar a cliente</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Útil para llamadas de prospecto: guardas la junta ya, y cuando exista el cliente
          migras el contexto o solo los seguimientos.
        </p>

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
                  La reunión (minuta, grabación, transcripción) queda en la ficha del cliente.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border p-2 cursor-pointer">
              <RadioGroupItem value="tasks_only" className="mt-0.5" />
              <span className="text-sm">
                <span className="font-medium">Solo tareas / seguimientos</span>
                <span className="block text-muted-foreground text-xs">
                  Prioriza los acuerdos→tareas en el cliente; la junta también se vincula para no perder contexto.
                </span>
              </span>
            </label>
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label>Cliente</Label>
          <Input
            placeholder="Buscar…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="max-h-52 overflow-y-auto rounded-md border divide-y">
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${
                  clientId === c.id ? "bg-primary/10 font-medium" : ""
                }`}
                onClick={() => setClientId(c.id)}
              >
                {c.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground text-center">Sin resultados</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={busy || !clientId} onClick={() => void submit()}>
            {busy ? "Asignando…" : "Asignar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
