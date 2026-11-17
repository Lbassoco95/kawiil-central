import { useState } from "react";
import { Megaphone, X } from "lucide-react";
import { useAvisosVigentes } from "@/hooks/useAvisosEquipo";
import type { AvisoVigente } from "../../supabase/functions/_shared/avisos";

// Avisos internos al entrar al sistema (Zen + Glass): por ejemplo «Hoy no se trabaja». Se ven mientras estén vigentes y cada persona puede cerrarlos
// en esta sesión (no se vuelven a mostrar hasta una sesión nueva). No bloquean nada. Si no hay avisos o falla la lectura, no se dibuja nada.
const llave = (id: string) => `aviso-equipo-cerrado:${id}`;
const cerrado = (id: string) => { try { return sessionStorage.getItem(llave(id)) === "1"; } catch { return false; } };
const cerrar = (id: string) => { try { sessionStorage.setItem(llave(id), "1"); } catch { /* sin almacenamiento: se cierra solo en pantalla */ } };

export function AvisosEquipo() {
  const { data } = useAvisosVigentes();
  const [ocultos, setOcultos] = useState<string[]>([]);
  const visibles = (data ?? []).filter((a) => !ocultos.includes(a.id) && !cerrado(a.id));
  if (visibles.length === 0) return null;
  const cerrarAviso = (a: AvisoVigente) => { cerrar(a.id); setOcultos((o) => [...o, a.id]); };
  return (
    <section aria-label="Avisos del equipo" className="mx-auto w-full max-w-7xl space-y-2 px-4 pt-4 md:px-6" data-testid="avisos-equipo">
      {visibles.map((a) => (
        <div key={a.id} role="status" data-testid={`aviso-${a.id}`} data-tipo={a.tipo}
          className={`zen-glass flex items-start gap-3 rounded-2xl border p-3 text-sm ${a.tipo === "dia_inhabil" ? "border-amber-300/70 bg-amber-50/60" : "border-sky-300/70 bg-sky-50/60"}`}>
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{a.titulo}</p>
            <p className="text-muted-foreground">{a.mensaje}</p>
          </div>
          <button type="button" onClick={() => cerrarAviso(a)} aria-label={`Cerrar el aviso «${a.titulo}»`} data-testid={`aviso-cerrar-${a.id}`}
            className="shrink-0 rounded-full p-1 hover:bg-background/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/60"><X className="h-4 w-4" aria-hidden /></button>
        </div>
      ))}
    </section>
  );
}
