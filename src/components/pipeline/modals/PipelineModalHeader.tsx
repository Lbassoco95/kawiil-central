import type { ReactNode } from "react";
import { KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";

/**
 * Cabecera reutilizable v2.4 para los modales del módulo Pipeline.
 *
 * Mantiene la consistencia visual con el resto de superficies Kawiil AI:
 *   - Fondo gradiente azul Kawiil (KAWIIL_AI_HEADER_BG).
 *   - Icono blanco en cuadrado translúcido.
 *   - Título principal + subtítulo opcional.
 *
 * Pensada para colocarse dentro de <DialogContent className="p-0"> y
 * sustituir al <DialogHeader> tradicional.
 */
interface Props {
  icon: ReactNode;
  title: string;
  subtitle?: string;
}

export function PipelineModalHeader({ icon, title, subtitle }: Props) {
  return (
    <header
      className="flex items-center gap-3 px-4 py-3 sm:px-5 text-white"
      style={{ background: KAWIIL_AI_HEADER_BG }}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/15 backdrop-blur-sm">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[14px] font-semibold leading-tight">{title}</p>
        {subtitle ? (
          <p className="mt-0.5 truncate text-[11px] leading-tight text-white/80">
            {subtitle}
          </p>
        ) : null}
      </div>
    </header>
  );
}
