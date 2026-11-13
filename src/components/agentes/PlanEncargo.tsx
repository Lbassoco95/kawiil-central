import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAprobarPlan, useCancelarEncargo } from "@/hooks/useSeguimientoAgentes";
import { FASES_APROBABLES, FASES_CANCELABLES, type PlanPublico } from "../../../supabase/functions/_shared/seguimiento";

// Tarjeta del plan de un encargo: qué va a revisar el agente, en cuántos clientes y con qué criterios. Dirección aprueba una sola vez;
// después el agente trabaja cliente por cliente y aquí se ve el avance. Todo es texto plano.
const FASE: Record<string, string> = {
  propuesto: "Espera tu aprobación", aprobado: "Aprobado, por empezar", ejecutando: "Revisando", pausado: "Pausado",
  terminado: "Terminado", cancelado: "Cancelado", reemplazado: "Reemplazado",
};

export function PlanEncargo({ taskId, plan }: { taskId: string; plan: PlanPublico }) {
  const aprobar = useAprobarPlan();
  const cancelar = useCancelarEncargo();
  const { progreso: pr, resultado: rs } = plan;
  const pct = pr.total > 0 ? Math.round((pr.hechas / pr.total) * 100) : 0;
  const error = (aprobar.error ?? cancelar.error) as Error | null;
  const ocupado = aprobar.isPending || cancelar.isPending;
  return (
    <div className="mt-2 space-y-3 rounded-xl border border-border/60 bg-background/60 p-3" data-testid="plan-encargo">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="plan-fase">{FASE[plan.fase] ?? plan.fase}</p>
      {plan.objetivo && <p className="font-medium">{plan.objetivo}</p>}
      <p className="text-sm text-muted-foreground" data-testid="plan-alcance">
        {plan.total} {plan.total === 1 ? "cliente" : "clientes"}{plan.sin_carpeta > 0 ? ` (${plan.sin_carpeta} sin carpeta identificada)` : ""} · {plan.criterios.length} criterios
        {plan.auxiliares > 1 ? ` · hasta ${plan.auxiliares} auxiliares` : ""}{plan.seguimiento_dias ? ` · seguimiento a los ${plan.seguimiento_dias} días` : ""}
      </p>
      {plan.fase === "propuesto" && (
        <>
          <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="Criterios">
            {plan.criterios.map((c) => <li key={c.nombre}><strong>{c.nombre}</strong>{c.que_verificar ? `: ${c.que_verificar}` : ""}</li>)}
          </ul>
          {plan.supuestos.length > 0 && (
            <div className="text-sm"><p className="font-medium">Supuestos</p>
              <ul className="list-disc pl-5 text-muted-foreground">{plan.supuestos.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          )}
        </>
      )}
      {(plan.fase === "aprobado" || plan.fase === "ejecutando" || plan.fase === "pausado") && (
        <div data-testid="plan-progreso">
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-sm">{pr.hechas} de {pr.total} clientes{pr.con_error > 0 ? ` · ${pr.con_error} con error` : ""}</p>
        </div>
      )}
      {plan.fase === "pausado" && plan.motivo && <p className="text-sm text-amber-700" data-testid="plan-motivo">{plan.motivo}</p>}
      {plan.fase === "terminado" && rs && (
        <p className="text-sm" data-testid="plan-resultado">{rs.al_dia} al día · {rs.con_pendientes} con pendientes · {rs.sin_verificar} sin poder verificar{rs.con_error > 0 ? ` · ${rs.con_error} con error` : ""}</p>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      <div className="flex flex-wrap gap-2">
        {FASES_APROBABLES.includes(plan.fase) && (
          <Button size="sm" disabled={ocupado} data-testid="plan-aprobar" onClick={() => aprobar.mutate(taskId)}>
            {aprobar.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}{plan.fase === "pausado" ? "Reanudar" : "Aprobar y empezar"}
          </Button>
        )}
        {FASES_CANCELABLES.includes(plan.fase) && (
          <Button size="sm" variant="outline" disabled={ocupado} data-testid="plan-cancelar" onClick={() => cancelar.mutate(taskId)}>Cancelar</Button>
        )}
      </div>
    </div>
  );
}
