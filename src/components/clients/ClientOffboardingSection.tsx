import { useEffect, useMemo, useState } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { useOrgProfiles } from "@/hooks/useClients";
import { useUpdateClientOffboarding } from "@/hooks/useClientOffboarding";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateMX } from "@/lib/dateUtils";
import {
  parseOffboarding,
  buildDefaultOffboardingSteps,
  offboardingProgress,
  type ClientOffboarding,
} from "@/lib/clientOffboarding";
import { DoorOpen, Loader2, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

type Client = Tables<"clients">;

interface ClientOffboardingSectionProps {
  client: Client;
}

export function ClientOffboardingSection({ client }: ClientOffboardingSectionProps) {
  const { user } = useAuth();
  const { isAdminOrManager } = useUserRole();
  const { data: profiles } = useOrgProfiles();
  const updateOffboarding = useUpdateClientOffboarding();

  const serverOff = useMemo(() => parseOffboarding(client.offboarding), [client.offboarding]);
  const [draft, setDraft] = useState<ClientOffboarding | null>(serverOff);

  // Resincroniza el borrador cuando cambia el dato del servidor.
  useEffect(() => {
    setDraft(serverOff);
  }, [serverOff]);

  const canManage = isAdminOrManager;
  const nameOf = (uid: string | null | undefined) =>
    (uid && profiles?.find((p) => p.user_id === uid)?.full_name) || "Sin asignar";

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(serverOff),
    [draft, serverOff],
  );

  const progress = offboardingProgress(draft);

  const startOffboarding = () => {
    const fresh: ClientOffboarding = {
      stage: "en_proceso",
      reason: "",
      target_exit_date: null,
      closing_responsible_user_id: client.responsible_user_id ?? null,
      steps: buildDefaultOffboardingSteps(),
      notes: "",
      started_at: new Date().toISOString(),
      started_by: user?.id ?? null,
      closed_at: null,
      closed_by: null,
    };
    updateOffboarding.mutate(
      { clientId: client.id, offboarding: fresh },
      { onSuccess: () => toast.success("Proceso de baja iniciado") },
    );
  };

  const save = () => {
    if (!draft) return;
    updateOffboarding.mutate(
      { clientId: client.id, offboarding: draft },
      { onSuccess: () => toast.success("Seguimiento de cierre guardado") },
    );
  };

  const markClosed = () => {
    if (!draft) return;
    const closed: ClientOffboarding = {
      ...draft,
      stage: "cerrado",
      closed_at: new Date().toISOString(),
      closed_by: user?.id ?? null,
    };
    updateOffboarding.mutate(
      { clientId: client.id, offboarding: closed },
      {
        onSuccess: () => {
          setDraft(closed);
          toast.success("Cierre marcado como completado");
        },
      },
    );
  };

  const reopen = () => {
    if (!draft) return;
    const reopened: ClientOffboarding = { ...draft, stage: "en_proceso", closed_at: null, closed_by: null };
    updateOffboarding.mutate(
      { clientId: client.id, offboarding: reopened },
      { onSuccess: () => setDraft(reopened) },
    );
  };

  const cancelProcess = () => {
    if (!window.confirm("¿Cancelar el proceso de baja? Se borrará el seguimiento de cierre de este cliente.")) return;
    updateOffboarding.mutate(
      { clientId: client.id, offboarding: null },
      { onSuccess: () => toast.success("Proceso de baja cancelado") },
    );
  };

  const markInactive = () => {
    if (!draft) return;
    updateOffboarding.mutate(
      { clientId: client.id, offboarding: draft, status: "inactivo" },
      { onSuccess: () => toast.success("Cliente marcado como Inactivo") },
    );
  };

  const patch = (updates: Partial<ClientOffboarding>) =>
    setDraft((d) => (d ? { ...d, ...updates } : d));

  const patchStep = (idx: number, updates: Partial<ClientOffboarding["steps"][number]>) =>
    setDraft((d) =>
      d ? { ...d, steps: d.steps.map((s, i) => (i === idx ? { ...s, ...updates } : s)) } : d,
    );

  // ── Sin proceso de baja ──────────────────────────────────────────────────
  if (!draft) {
    return (
      <section className="glass-card p-6 animate-fade-in">
        <div className="flex flex-col items-center text-center gap-3 py-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <DoorOpen className="h-6 w-6 text-primary/70" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">Sin proceso de baja</h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-md">
              Este cliente no está en proceso de cierre. Inicia el seguimiento cuando el cliente
              vaya a darse de baja para no perder ningún paso.
            </p>
          </div>
          {canManage ? (
            <Button size="sm" className="mt-1" onClick={startOffboarding} disabled={updateOffboarding.isPending}>
              {updateOffboarding.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Iniciar proceso de baja
            </Button>
          ) : (
            <p className="text-[11px] text-muted-foreground">Solo un G3/G4 puede iniciar el proceso de baja.</p>
          )}
        </div>
      </section>
    );
  }

  // ── Con proceso de baja ──────────────────────────────────────────────────
  const isClosed = draft.stage === "cerrado";

  return (
    <section className="space-y-4 animate-fade-in">
      {/* Encabezado */}
      <div className="glass-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <DoorOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-foreground">Seguimiento de cierre</h2>
            <Badge
              variant="outline"
              className={
                isClosed
                  ? "border-0 bg-muted text-muted-foreground"
                  : "border-0 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
              }
            >
              {isClosed ? "Cerrado" : "En proceso"}
            </Badge>
          </div>
          <span className="text-sm font-semibold text-foreground tabular-nums">{progress}%</span>
        </div>
        <Progress value={progress} className="h-1.5 mt-3" />
        {draft.started_at && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Iniciado el {formatDateMX(draft.started_at)}
            {draft.started_by && ` por ${nameOf(draft.started_by)}`}
            {isClosed && draft.closed_at && ` · Cerrado el ${formatDateMX(draft.closed_at)}`}
          </p>
        )}
      </div>

      {/* Datos del cierre */}
      <div className="glass-card p-5 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Motivo de la baja</Label>
            {canManage && !isClosed ? (
              <Textarea
                value={draft.reason ?? ""}
                onChange={(e) => patch({ reason: e.target.value })}
                placeholder="Ej. El cliente internaliza la contabilidad…"
                rows={2}
                className="text-sm"
              />
            ) : (
              <p className="text-sm text-foreground">{draft.reason || "—"}</p>
            )}
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Fecha objetivo de salida</Label>
              {canManage && !isClosed ? (
                <Input
                  type="date"
                  value={draft.target_exit_date ?? ""}
                  onChange={(e) => patch({ target_exit_date: e.target.value || null })}
                  className="h-9 text-sm"
                />
              ) : (
                <p className="text-sm text-foreground">
                  {draft.target_exit_date ? formatDateMX(draft.target_exit_date) : "—"}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Responsable del cierre</Label>
              {canManage && !isClosed ? (
                <SearchableSelect
                  options={(profiles || []).map((p) => ({ value: p.user_id, label: p.full_name }))}
                  value={draft.closing_responsible_user_id || ""}
                  onValueChange={(v) => patch({ closing_responsible_user_id: v || null })}
                  placeholder="Seleccionar responsable"
                  searchPlaceholder="Buscar usuario..."
                />
              ) : (
                <p className="text-sm text-foreground">{nameOf(draft.closing_responsible_user_id)}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Checklist de cierre */}
      <div className="glass-card p-5 space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Pasos del cierre
        </p>
        <div className="space-y-2">
          {draft.steps.map((step, idx) => (
            <div
              key={step.key}
              className={`rounded-lg border p-3 transition-colors ${
                step.done ? "border-success/30 bg-success/5" : "border-border/60 bg-secondary/20"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <Checkbox
                  checked={step.done}
                  disabled={!canManage}
                  onCheckedChange={(c) =>
                    patchStep(idx, {
                      done: c === true,
                      date: c === true ? new Date().toISOString().slice(0, 10) : null,
                    })
                  }
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-[13px] ${step.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {step.label}
                  </p>
                  {canManage ? (
                    <Input
                      value={step.note ?? ""}
                      onChange={(e) => patchStep(idx, { note: e.target.value })}
                      placeholder="Nota (opcional)"
                      className="mt-1.5 h-7 text-xs"
                    />
                  ) : step.note ? (
                    <p className="mt-1 text-xs text-muted-foreground">{step.note}</p>
                  ) : null}
                </div>
                {step.done && step.date && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{formatDateMX(step.date)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notas generales */}
      <div className="glass-card p-5 space-y-1.5">
        <Label className="text-xs">Notas del cierre</Label>
        {canManage ? (
          <Textarea
            value={draft.notes ?? ""}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Observaciones, acuerdos, pendientes…"
            rows={3}
            className="text-sm"
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm text-foreground">{draft.notes || "—"}</p>
        )}
      </div>

      {/* Acciones */}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={save} disabled={!dirty || updateOffboarding.isPending}>
            {updateOffboarding.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Guardar cambios
          </Button>
          {!isClosed ? (
            <Button size="sm" variant="secondary" onClick={markClosed} disabled={updateOffboarding.isPending}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Marcar cierre completado
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={reopen} disabled={updateOffboarding.isPending}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Reabrir
              </Button>
              {client.status !== "inactivo" && (
                <Button size="sm" variant="outline" onClick={markInactive} disabled={updateOffboarding.isPending}>
                  Marcar cliente como Inactivo
                </Button>
              )}
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={cancelProcess}
            disabled={updateOffboarding.isPending}
          >
            <XCircle className="mr-1.5 h-3.5 w-3.5" />
            Cancelar proceso
          </Button>
        </div>
      )}
    </section>
  );
}
