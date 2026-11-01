import { cn } from "@/lib/utils";
import type { Calibracion, PiezaRed } from "@/hooks/useMarketing";

// Tonos suaves (Zen): verde salvia, durazno, rosa suave y gris cálido; nunca rojos saturados.
export const COLOR_CLASES: Record<string, string> = {
  verde: "bg-emerald-100/80 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800",
  amarillo: "bg-amber-100/80 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800",
  rojo: "bg-rose-100/80 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:border-rose-800",
  gris: "bg-stone-100/90 text-stone-600 border-stone-200 dark:bg-stone-800/40 dark:text-stone-300 dark:border-stone-700",
};
export const COLOR_LABEL: Record<string, string> = { verde: "Verde", amarillo: "Amarillo", rojo: "Rojo", gris: "Gris" };

export const MOTIVO_GRIS: Record<string, string> = {
  sin_piezas_publicadas: "Sin piezas publicadas esa semana",
  sin_datos_fuente: "El archivo no trae datos de esta red en esa semana",
};

export function esProvisional(c: Pick<Calibracion, "nota">): boolean {
  return /provisional/i.test(c.nota ?? "");
}

export function Pastilla({ color, children, className }: { color: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", COLOR_CLASES[color] ?? COLOR_CLASES.gris, className)}>
      {children}
    </span>
  );
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" });
}

export const IG_DESDE = "2026-09-08"; // el archivo trae Instagram a partir de esta fecha

export function EstadoRed({ pr, fecha, red }: { pr: PiezaRed | undefined; fecha: string | null; red: string }) {
  if (pr?.estado === "publicada") return <Pastilla color="verde">Publicada</Pastilla>;
  if (pr?.estado === "con_errores") {
    return <Pastilla color="rojo" className="cursor-help">Con errores{pr.mensaje_error ? ` · ${pr.mensaje_error}` : ""}</Pastilla>;
  }
  if (pr?.estado === "pendiente") return <Pastilla color="amarillo">Pendiente</Pastilla>;
  if (red === "instagram" && fecha && fecha < IG_DESDE) return <Pastilla color="gris">Sin dato del archivo</Pastilla>;
  return <Pastilla color="gris">No salió en esta red</Pastilla>;
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">{children}</p>;
}
