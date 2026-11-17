import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// El módulo de agentes se mantiene al día solo: cuando un agente empieza o termina una tarea (o cambia su estado) se refrescan los datos que alimentan
// la Oficina, las islas de Departamentos, la banda del equipo, las Rutinas y /marketing. Antes los datos se leían una vez y caducaban a los 60 s sin volver a
// pedirse hasta cambiar de pestaña: una tarea de unos segundos nunca se veía «trabajando».
//  · Tiempo real: Supabase Realtime sobre agent_tasks y agent_registry (ya están en la publicación; la lectura respeta el permiso de lectura de autenticados).
//  · Respaldo: refresco periódico (cada 8 s si el tiempo real no está conectado, cada 30 s si lo está) y al volver a la pestaña; solo con la pestaña a la vista.
// No escribe nada: solo invalida las consultas de lectura. Se monta una vez por pantalla (Agentes y Marketing).
export type EstadoEnVivo = "conectando" | "en_vivo" | "sondeo";
export const CLAVE_AGENTES = ["agentes-registro"] as const;
export const ESPERA_RAFAGA_MS = 400;     // varios cambios seguidos se juntan en un solo refresco
export const SONDEO_SIN_TIEMPO_REAL_MS = 8_000;
export const SONDEO_CON_TIEMPO_REAL_MS = 30_000;

export function useAgentesEnVivo(activo = true): EstadoEnVivo {
  const qc = useQueryClient();
  const [estado, setEstado] = useState<EstadoEnVivo>("conectando");
  const conectado = useRef(false);

  useEffect(() => {
    if (!activo) return;
    let cancelado = false;
    let rafaga: ReturnType<typeof setTimeout> | null = null;
    const refrescar = () => {
      if (rafaga) clearTimeout(rafaga);
      rafaga = setTimeout(() => { rafaga = null; if (!cancelado) void qc.invalidateQueries({ queryKey: CLAVE_AGENTES }); }, ESPERA_RAFAGA_MS);
    };
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

    const tema = "agentes-en-vivo";
    try { for (const c of supabase.getChannels?.() ?? []) if (c.topic === `realtime:${tema}` || c.topic === tema) void supabase.removeChannel(c); } catch { /* sin canales previos */ }
    let canal: ReturnType<typeof supabase.channel> | null = null;
    try {
      canal = supabase.channel(tema)
        .on("postgres_changes", { event: "*", schema: "public", table: "agent_tasks" }, refrescar)
        .on("postgres_changes", { event: "*", schema: "public", table: "agent_registry" }, refrescar)
        .subscribe((s: string) => {
          if (cancelado) return;
          if (s === "SUBSCRIBED") { conectado.current = true; setEstado("en_vivo"); refrescar(); }
          else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") { conectado.current = false; setEstado("sondeo"); }
        });
    } catch { conectado.current = false; setEstado("sondeo"); }

    // Respaldo: un solo reloj de 4 s que decide si toca refrescar según el estado del tiempo real.
    let ultimo = Date.now();
    const reloj = setInterval(() => {
      if (!visible()) return;
      const cada = conectado.current ? SONDEO_CON_TIEMPO_REAL_MS : SONDEO_SIN_TIEMPO_REAL_MS;
      if (Date.now() - ultimo >= cada) { ultimo = Date.now(); void qc.invalidateQueries({ queryKey: CLAVE_AGENTES }); }
    }, 4_000);
    const alVolver = () => { if (visible()) { ultimo = Date.now(); void qc.invalidateQueries({ queryKey: CLAVE_AGENTES }); } };
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      cancelado = true;
      if (rafaga) clearTimeout(rafaga);
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
      if (canal) { try { void supabase.removeChannel(canal); } catch { /* ya cerrado */ } }
      conectado.current = false;
    };
  }, [qc, activo]);

  return estado;
}
