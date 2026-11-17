import { createContext, useContext } from "react";
import type { FiguraOficina } from "@/lib/agentes/oficina";

// Las figuras de la oficina (estado real de cada agente) disponibles para toda la página de Agentes, para quien quiera dibujar a un agente en su escritorio.
export const FigurasContext = createContext<FiguraOficina[]>([]);
export const useFiguraDe = (agenteId: string | null | undefined): FiguraOficina | undefined => {
  const figuras = useContext(FigurasContext);
  return agenteId ? figuras.find((f) => f.id === agenteId) : undefined;
};
