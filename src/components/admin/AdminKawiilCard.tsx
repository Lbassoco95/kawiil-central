import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  Users,
  Network,
  ListTree,
  TrendingUp,
  Plug,
  Palette,
  ArrowRight,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useCelulaOptions } from "@/hooks/useCelulaOptions";
import {
  KAWIIL_AI_GRADIENT,
  KAWIIL_AI_HEADER_BG,
  KAWIIL_AI_SOFT_BG,
} from "@/lib/kawiilAi";

export type AdminTab =
  | "usuarios"
  | "celulas"
  | "catalogos"
  | "adopcion"
  | "integraciones"
  | "apariencia";

interface Props {
  activeTab: AdminTab;
  onGoToTab: (tab: AdminTab) => void;
  isTransformador?: boolean;
}

/**
 * Hero AI card v2.4 para Configuración / Admin. Muestra mini-stats reales
 * (Kawiilers activos, pendientes de invitación, células, integraciones) y
 * chips para saltar entre tabs. Sigue el mismo patrón visual que
 * `NotificationsKawiilCard`, `FinanceKawiilCard` y `KnowledgeKawiilCard`.
 *
 * Las "integraciones" aquí se muestran como chip estático (Microsoft 365,
 * Dropbox, Slack, Moffin, Savio); el detalle real vive en las páginas
 * dedicadas (`Microsoft365Conexion`, `Configuracion → Integraciones`, etc.).
 */
export function AdminKawiilCard({ activeTab, onGoToTab, isTransformador }: Props) {
  const navigate = useNavigate();
  const { data: users, isLoading: usersLoading } = useOrgUsers();
  const { celulaOptions, isLoading: celulasLoading } = useCelulaOptions();

  const usersStats = useMemo(() => {
    if (!users) return { active: 0, pending: 0, total: 0 };
    const active = users.filter((u) => u.is_active && u.invitation_accepted).length;
    const pending = users.filter((u) => !u.invitation_accepted).length;
    return { active, pending, total: users.length };
  }, [users]);

  const summary = useMemo(() => {
    const active = usersStats.active;
    const pending = usersStats.pending;
    const cells = celulaOptions.length;
    if (active === 0 && cells === 0) {
      return "Comencemos a configurar tu organización: invita Kawiilers, crea células y conecta integraciones para que Kawiil AI tenga el contexto completo.";
    }
    const parts: string[] = [];
    parts.push(`Tienes ${active} Kawiiler${active === 1 ? "" : "s"} activo${active === 1 ? "" : "s"}`);
    if (pending > 0) parts.push(`y ${pending} invitación${pending === 1 ? "" : "es"} pendiente${pending === 1 ? "" : "s"}`);
    parts.push(`distribuidos en ${cells} célula${cells === 1 ? "" : "s"} operativa${cells === 1 ? "" : "s"}`);
    return parts.join(", ") + ".";
  }, [usersStats, celulaOptions]);

  const chips: { key: AdminTab; label: string; icon: typeof Users; visible: boolean }[] = [
    { key: "usuarios", label: "Kawiilers", icon: Users, visible: true },
    { key: "celulas", label: "Células", icon: Network, visible: true },
    { key: "catalogos", label: "Catálogos", icon: ListTree, visible: true },
    { key: "adopcion", label: "Adopción", icon: TrendingUp, visible: true },
    { key: "integraciones", label: "Integraciones", icon: Plug, visible: !!isTransformador },
    { key: "apariencia", label: "Apariencia", icon: Palette, visible: true },
  ];

  return (
    <section
      className="overflow-hidden rounded-2xl border border-sky-200/70 shadow-sm dark:border-sky-800/40"
      aria-label="Resumen de configuración por Kawiil AI"
    >
      <div
        className="flex items-center justify-between gap-3 border-b border-sky-200/40 px-4 py-3 dark:border-sky-800/30"
        style={{ background: KAWIIL_AI_HEADER_BG }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white shadow-sm"
            style={{ background: KAWIIL_AI_GRADIENT }}
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold leading-tight tracking-tight text-foreground">
              KAWIIL AI · Configuración
              <Badge
                variant="outline"
                className="ml-1 h-4 border-sky-300/70 bg-sky-50/70 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300"
              >
                v2.4
              </Badge>
            </p>
            <p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">
              Estado de tu organización y atajos para administrarla
            </p>
          </div>
        </div>
        {usersStats.pending > 0 ? (
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-[11px] text-white shadow-sm hover:opacity-95"
            style={{ background: KAWIIL_AI_GRADIENT }}
            onClick={() => onGoToTab("usuarios")}
          >
            <Mail className="h-3.5 w-3.5" />
            {usersStats.pending} pendiente{usersStats.pending === 1 ? "" : "s"}
          </Button>
        ) : null}
      </div>

      <div
        className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-4"
        style={{ background: KAWIIL_AI_SOFT_BG }}
      >
        <MiniStat
          label="Kawiilers activos"
          value={String(usersStats.active)}
          accent="#0ea5e9"
          loading={usersLoading}
          onClick={() => onGoToTab("usuarios")}
        />
        <MiniStat
          label="Por aceptar invitación"
          value={String(usersStats.pending)}
          accent="#f59e0b"
          loading={usersLoading}
          onClick={() => onGoToTab("usuarios")}
        />
        <MiniStat
          label="Células"
          value={String(celulaOptions.length)}
          accent="#6366f1"
          loading={celulasLoading}
          onClick={() => onGoToTab("celulas")}
        />
        <MiniStat
          label="Adopción Kawiil"
          value="Ver"
          accent="#0369a1"
          onClick={() => onGoToTab("adopcion")}
          icon={<TrendingUp className="h-3 w-3" />}
        />
      </div>

      <div className="space-y-3 bg-gradient-to-br from-sky-50/70 via-white to-blue-50/40 px-4 py-3 dark:from-sky-950/20 dark:via-card dark:to-blue-950/15">
        <p className="text-[13px] leading-relaxed text-foreground">{summary}</p>

        <div className="flex flex-wrap gap-1.5">
          {chips
            .filter((c) => c.visible)
            .map((chip) => {
              const isActive = chip.key === activeTab;
              const Icon = chip.icon;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => onGoToTab(chip.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    isActive
                      ? "border-sky-400/70 bg-sky-100/80 text-sky-700 dark:border-sky-400/60 dark:bg-sky-400/15 dark:text-sky-300"
                      : "border-border/60 bg-white/70 text-muted-foreground hover:border-sky-300/70 hover:bg-sky-50/70 hover:text-sky-700 dark:bg-white/5 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {chip.label}
                </button>
              );
            })}
          <button
            type="button"
            onClick={() => navigate("/microsoft365")}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-white/70 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-sky-300/70 hover:bg-sky-50/70 hover:text-sky-700 dark:bg-white/5 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
          >
            <ShieldCheck className="h-3 w-3" />
            Microsoft 365
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </section>
  );
}

function MiniStat({
  label,
  value,
  accent,
  loading,
  onClick,
  icon,
}: {
  label: string;
  value: string;
  accent: string;
  loading?: boolean;
  onClick?: () => void;
  icon?: React.ReactNode;
}) {
  const Wrapper: React.ElementType = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-xl bg-white/70 px-3 py-2 text-left backdrop-blur-sm transition-colors hover:bg-white dark:bg-white/5 dark:hover:bg-white/10"
    >
      <span
        aria-hidden
        className="h-7 w-1 shrink-0 rounded-full"
        style={{ background: accent }}
      />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {loading ? (
          <Skeleton className="mt-0.5 h-4 w-16" />
        ) : (
          <p className="mt-0.5 inline-flex items-center gap-1 truncate text-[13px] font-semibold tabular-nums text-foreground">
            {value}
            {icon ? <span className="text-muted-foreground">{icon}</span> : null}
          </p>
        )}
      </div>
    </Wrapper>
  );
}
