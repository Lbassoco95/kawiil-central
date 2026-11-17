import { useEffect, useState } from "react";
import type { EstadoEnVivo } from "@/hooks/useAgentesEnVivo";
import { haceTexto } from "@/lib/agentes/enVivoTexto";

// Chip discreto: dice si el módulo se actualiza solo y cuándo fue la última lectura. Todo estado también va con texto (no solo color).
const TEXTO: Record<EstadoEnVivo, { t: string; punto: string; ayuda: string }> = {
  en_vivo: { t: "En vivo", punto: "bg-emerald-500", ayuda: "Los cambios de los agentes aparecen al instante." },
  sondeo: { t: "Actualizando cada pocos segundos", punto: "bg-amber-500", ayuda: "El tiempo real no está conectado; se revisa cada 8 segundos." },
  conectando: { t: "Conectando…", punto: "bg-slate-400", ayuda: "Conectando con el servicio de actualización." },
};
export function IndicadorEnVivo({ estado, actualizadoEn }: { estado: EstadoEnVivo; actualizadoEn: number }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 5_000); return () => clearInterval(t); }, []);
  const e = TEXTO[estado];
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status" title={e.ayuda} data-testid="en-vivo" data-estado={estado}>
      <span className={`h-2 w-2 rounded-full ${e.punto} ${estado === "en_vivo" ? "motion-safe:animate-pulse" : ""}`} aria-hidden />
      <span>{e.t}</span>
      {actualizadoEn > 0 && <span data-testid="en-vivo-hace">· actualizado {haceTexto(ahora - actualizadoEn)}</span>}
    </p>
  );
}
