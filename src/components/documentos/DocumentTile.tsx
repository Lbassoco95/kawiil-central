import { type ReactNode } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DocumentTileProps {
  name: string;
  /** Etiqueta de extensión (PDF, DOCX, XLSX…). Si no se pasa se infiere del nombre. */
  extension?: string;
  /** Icono lucide ya pintado por el caller (color heredado de extensión). */
  icon?: ReactNode;
  /** Color de fondo para el chip de extensión + icono (CSS color HSL). */
  accentColor?: string;
  meta?: ReactNode;
  onClick?: () => void;
  trailing?: ReactNode;
  className?: string;
  /** Si se proporciona, muestra una estrella siempre visible en la esquina superior derecha. */
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

export function inferExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "FILE";
  return name.slice(dot + 1).toUpperCase();
}

/** Mapa de extensión → color HSL del handoff v3. */
export function extensionAccent(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "pdf") return "hsl(0 72% 51%)";
  if (e === "doc" || e === "docx") return "hsl(217 91% 60%)";
  if (["xls", "xlsx", "csv"].includes(e)) return "hsl(157 72% 36%)";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e))
    return "hsl(280 65% 55%)";
  if (["xml", "json"].includes(e)) return "hsl(25 95% 53%)";
  if (["zip", "rar", "7z"].includes(e)) return "hsl(38 92% 50%)";
  return "hsl(var(--muted-foreground))";
}

/**
 * Tile cuadrado para grid de documentos (handoff v3 modules-polished.html `doc-tile`).
 * Icono 44x54 con accent por extensión + nombre clamp 2 líneas + meta.
 */
export function DocumentTile({
  name,
  extension,
  icon,
  accentColor,
  meta,
  onClick,
  trailing,
  className,
  isFavorite,
  onToggleFavorite,
}: DocumentTileProps) {
  const ext = extension ?? inferExtension(name);
  const accent = accentColor ?? extensionAccent(ext);
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : -1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group relative flex h-full flex-col gap-2 rounded-xl border border-border/60 bg-card/80 p-3 text-left transition-all",
        onClick &&
          "cursor-pointer hover:-translate-y-0.5 hover:border-border hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className="grid h-[54px] w-[44px] shrink-0 place-items-center overflow-hidden rounded-md text-white shadow-sm"
          style={{ background: accent }}
          aria-hidden
        >
          {icon ? (
            <span className="opacity-90 [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wide">
              {ext.slice(0, 4)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="line-clamp-2 break-words text-[13px] font-medium leading-snug text-foreground"
            title={name}
          >
            {name}
          </p>
          {meta ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {meta}
            </div>
          ) : null}
        </div>
      </div>
      {trailing ? (
        <div className="mt-auto flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {trailing}
        </div>
      ) : null}
      {onToggleFavorite ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={cn(
            "absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full transition-all",
            isFavorite
              ? "text-amber-500"
              : "text-muted-foreground/40 hover:text-amber-500 opacity-0 group-hover:opacity-100",
            isFavorite && "opacity-100",
          )}
          aria-label={isFavorite ? "Quitar de favoritos" : "Marcar como favorito"}
          aria-pressed={isFavorite}
        >
          <Star
            className={cn("h-4 w-4", isFavorite && "fill-amber-400")}
            strokeWidth={isFavorite ? 1.5 : 2}
          />
        </button>
      ) : null}
    </div>
  );
}
