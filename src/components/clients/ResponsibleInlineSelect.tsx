import { useMemo } from "react";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { useAssignClientResponsible, type AssignResponsibleOrigin } from "@/hooks/useAssignResponsible";
import { avatarGradient } from "@/lib/avatarGradient";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ProfileLite {
  user_id: string;
  full_name: string;
}

interface Props {
  clientId: string;
  responsibleUserId: string | null;
  profiles: ProfileLite[];
  /** G3+ pueden editar; el resto ve solo lectura. */
  canEdit: boolean;
  origin?: AssignResponsibleOrigin;
  className?: string;
}

function initials(name: string): string {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Celda de "Responsable" con edición en línea (RF-02). Para G3+ abre un selector
 * con búsqueda y guarda de inmediato vía el servicio de dominio; para el resto
 * muestra el responsable en solo lectura ("Sin asignar" resaltado si está vacío).
 */
export function ResponsibleInlineSelect({
  clientId,
  responsibleUserId,
  profiles,
  canEdit,
  origin = "ui_listado",
  className,
}: Props) {
  const assign = useAssignClientResponsible();

  const options = useMemo(
    () => profiles.map((p) => ({ value: p.user_id, label: p.full_name })),
    [profiles]
  );
  const current = responsibleUserId
    ? profiles.find((p) => p.user_id === responsibleUserId) ?? null
    : null;

  if (!canEdit) {
    return (
      <div className={cn("flex items-center gap-1.5", className)} aria-label="Responsable">
        {current ? (
          <>
            <span
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white shadow-sm ring-1 ring-white/30 dark:ring-white/10"
              style={{ background: avatarGradient(current.full_name) }}
              aria-hidden
            >
              {initials(current.full_name)}
            </span>
            <span className="truncate max-w-[130px] text-[11px] text-muted-foreground">
              {current.full_name}
            </span>
          </>
        ) : (
          <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">Sin asignar</span>
        )}
      </div>
    );
  }

  return (
    // Evita que el clic en el selector navegue a la ficha del cliente.
    <div className={cn(className)} onClick={(e) => e.stopPropagation()}>
      <SearchableSelect
        options={options}
        value={responsibleUserId ?? ""}
        onValueChange={(v) => {
          const next = v || null;
          if ((next ?? null) === (responsibleUserId ?? null)) return;
          assign.mutate(
            { clientIds: [clientId], responsibleUserId: next, origin },
            {
              onSuccess: (changed) => {
                if (changed > 0) {
                  const name = next ? profiles.find((p) => p.user_id === next)?.full_name : null;
                  toast.success(name ? `Responsable asignado: ${name}` : "Responsable removido");
                }
              },
            }
          );
        }}
        placeholder="Sin asignar"
        searchPlaceholder="Buscar responsable…"
        emptyLabel="Sin responsable"
        disabled={assign.isPending}
        className={cn(
          "h-8 text-xs min-w-[150px]",
          !responsibleUserId && "border-amber-500/50 text-amber-700 dark:text-amber-300"
        )}
      />
    </div>
  );
}
