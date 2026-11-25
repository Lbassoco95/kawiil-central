import { useEffect } from "react";
import { activarModoPrueba } from "./modoPrueba";

// Ruta `/agentes/prueba` (solo en vistas previas y desarrollo): enciende el modo de prueba y recarga en /agentes, para que las respuestas de ejemplo estén instaladas desde el arranque.
export default function PruebaAgentes() {
  useEffect(() => { activarModoPrueba(); location.replace("/agentes"); }, []);
  return <p className="p-6 text-sm">Entrando al modo de prueba del módulo Agentes…</p>;
}
