/**
 * Plantilla de presentación en vivo — diseño tipo Tablero Grupo,
 * adaptado a tokens Kawiil (azul primario / accent verde).
 * KPIs · columnas por entidad · ítems con avance/sigue · proyección a pantalla completa.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AGREEMENT_STATUS, MOVEMENT, type MtgMovement } from "@/lib/mtg/constants";
import { bucketForMovement, sortOpenUpdatesByMovement } from "@/lib/mtg/prepareBoard";
import type { BoardTopicRow } from "@/hooks/useMtgBoard";
import type {
  MtgAgreementRow,
  MtgDecisionRow,
  MtgEntity,
  MtgExpectedNextRow,
} from "@/lib/mtg/db";

const MOVEMENT_STRIPE: Record<MtgMovement, string> = {
  resolved: "hsl(var(--success))",
  advanced: "hsl(var(--accent))",
  unchanged: "hsl(var(--muted-foreground))",
  new: "hsl(var(--warning))",
  decision_needed: "hsl(var(--warning))",
  blocked_third_party: "hsl(var(--destructive))",
  waiting_authority: "hsl(var(--info))",
};

const MOVEMENT_PILL: Record<MtgMovement, string> = {
  resolved: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  advanced: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  unchanged: "bg-muted text-muted-foreground",
  new: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  decision_needed: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  blocked_third_party: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  waiting_authority: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
};

function entityLabel(entities: MtgEntity[], key: string | null | undefined): string {
  if (!key) return "General";
  return entities.find((e) => e.key === key)?.label ?? key;
}

function groupByEntity(
  topics: BoardTopicRow[],
  entities: MtgEntity[],
): { key: string; label: string; items: BoardTopicRow[] }[] {
  const order = entities.map((e) => e.key);
  const map = new Map<string, BoardTopicRow[]>();
  for (const t of topics) {
    const k = t.entity_key || "_general";
    const list = map.get(k) ?? [];
    list.push(t);
    map.set(k, list);
  }
  const keys = [
    ...order.filter((k) => map.has(k)),
    ...[...map.keys()].filter((k) => k !== "_general" && !order.includes(k)),
    ...(map.has("_general") ? ["_general"] : []),
  ];
  return keys.map((key) => ({
    key,
    label: key === "_general" ? "General" : entityLabel(entities, key),
    items: map.get(key) ?? [],
  }));
}

function TopicCard(props: {
  topic: BoardTopicRow;
  entities: MtgEntity[];
  liveEditable: boolean;
  expandAll: boolean;
  onPatchUpdate: (updateId: string, patch: Record<string, unknown>) => void;
  onOpenHistory?: (topic: { id: string; title: string }) => void;
}) {
  const { topic: t } = props;
  const u = t.update!;
  const [open, setOpen] = useState(false);
  const showCtx = props.expandAll || open;
  const hasCtx =
    props.liveEditable || !!(t.context || t.if_asked || t.source || u.session_notes);
  const dueLate =
    !!t.due_date &&
    new Date(`${t.due_date}T12:00:00`) < new Date() &&
    u.movement !== "resolved";

  return (
    <div
      className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 border-t border-border/70 px-3.5 py-2.5 first:border-t-0"
      style={{ ["--st" as string]: MOVEMENT_STRIPE[u.movement] }}
    >
      <div
        className="mt-1 w-1 self-stretch rounded-sm bg-[var(--st)]"
        aria-hidden
      />
      <div className="min-w-0 space-y-1.5">
        <button
          type="button"
          className="text-left font-medium leading-snug hover:underline"
          onClick={() => props.onOpenHistory?.({ id: t.id, title: t.title })}
        >
          {t.title}
        </button>

        <div className="space-y-1 text-[0.92em] text-muted-foreground">
          <div>
            <span className="font-medium text-foreground/80">Avance: </span>
            <Textarea
              className="mt-0.5 min-h-[2.4em] resize-y border-transparent bg-transparent px-1 py-0.5 text-[0.95em] shadow-none focus-visible:border-primary focus-visible:bg-background"
              placeholder="Avance desde la última"
              defaultValue={u.progress_since_last ?? ""}
              readOnly={!props.liveEditable}
              onChange={(e) => {
                if (!props.liveEditable) return;
                props.onPatchUpdate(u.id, {
                  progress_since_last: e.target.value,
                  origin: "edited_live",
                });
              }}
            />
          </div>
          <div>
            <span className="font-medium text-foreground/80">Sigue: </span>
            <Textarea
              className="mt-0.5 min-h-[2.4em] resize-y border-transparent bg-transparent px-1 py-0.5 text-[0.95em] shadow-none focus-visible:border-primary focus-visible:bg-background"
              placeholder="Siguiente paso"
              defaultValue={u.next_step ?? ""}
              readOnly={!props.liveEditable}
              onChange={(e) => {
                if (!props.liveEditable) return;
                props.onPatchUpdate(u.id, {
                  next_step: e.target.value,
                  origin: "edited_live",
                });
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-0.5">
          {props.liveEditable ? (
            <Select
              value={u.movement}
              onValueChange={(v) =>
                props.onPatchUpdate(u.id, { movement: v, origin: "edited_live" })
              }
            >
              <SelectTrigger
                className={cn(
                  "h-7 w-auto min-w-[9rem] border-0 text-[0.8em] font-medium",
                  MOVEMENT_PILL[u.movement],
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MOVEMENT) as MtgMovement[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {MOVEMENT[m].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[0.8em] font-medium",
                MOVEMENT_PILL[u.movement],
              )}
            >
              {MOVEMENT[u.movement].label}
            </span>
          )}
          {props.liveEditable && (
            <label className="inline-flex items-center gap-1 text-[0.8em] text-muted-foreground">
              <Checkbox
                checked={u.reviewed}
                onCheckedChange={(c) =>
                  props.onPatchUpdate(u.id, {
                    reviewed: !!c,
                    reviewed_at: c ? new Date().toISOString() : null,
                  })
                }
              />
              Revisado
            </label>
          )}
          {(t.owner_name || t.owner_side) && (
            <span className="font-mono text-[0.8em] text-muted-foreground">
              {t.owner_name || t.owner_side}
            </span>
          )}
          {t.due_date && (
            <span
              className={cn(
                "font-mono text-[0.8em]",
                dueLate ? "font-medium text-destructive" : "text-muted-foreground",
              )}
            >
              {t.due_date}
            </span>
          )}
          {hasCtx && (
            <button
              type="button"
              className="ml-auto text-[0.8em] font-medium text-primary hover:underline"
              aria-expanded={showCtx}
              onClick={() => setOpen((v) => !v)}
            >
              {showCtx ? "Cerrar" : "Contexto y notas"}
            </button>
          )}
        </div>

        {showCtx && hasCtx && (
          <div className="mt-2 grid gap-2 rounded-md bg-muted/50 px-3 py-2.5 text-[0.92em]">
            {t.context && (
              <div>
                <b className="mb-0.5 block text-[0.85em] font-semibold uppercase tracking-wider text-muted-foreground">
                  Contexto
                </b>
                <p className="m-0 text-foreground">{t.context}</p>
              </div>
            )}
            {t.if_asked && (
              <div>
                <b className="mb-0.5 block text-[0.85em] font-semibold uppercase tracking-wider text-muted-foreground">
                  Si preguntan
                </b>
                <p className="m-0 text-foreground">{t.if_asked}</p>
              </div>
            )}
            {t.source && (
              <p className="m-0 font-mono text-[0.85em] text-muted-foreground">
                Fuente: {t.source}
              </p>
            )}
            {!props.liveEditable && u.session_notes && (
              <div>
                <b className="mb-0.5 block text-[0.85em] font-semibold uppercase tracking-wider text-muted-foreground">
                  Notas de sesión
                </b>
                <p className="m-0 whitespace-pre-wrap text-foreground">{u.session_notes}</p>
              </div>
            )}
            {props.liveEditable && (
              <div>
                <label className="mb-1 block font-mono text-[0.75em] uppercase tracking-wider text-muted-foreground">
                  Notas de sesión
                </label>
                <Textarea
                  className="min-h-[3em] border-amber-200/80 bg-amber-50/80 text-[0.95em] dark:border-amber-900/40 dark:bg-amber-950/30"
                  placeholder="Anotaciones en vivo…"
                  defaultValue={u.session_notes ?? ""}
                  onChange={(e) =>
                    props.onPatchUpdate(u.id, {
                      session_notes: e.target.value,
                      origin: "edited_live",
                    })
                  }
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EntityBoard(props: {
  columns: { key: string; label: string; items: BoardTopicRow[] }[];
  empty: string;
  entities: MtgEntity[];
  liveEditable: boolean;
  expandAll: boolean;
  projection: boolean;
  onPatchUpdate: (updateId: string, patch: Record<string, unknown>) => void;
  onOpenHistory?: (topic: { id: string; title: string }) => void;
}) {
  if (props.columns.every((c) => c.items.length === 0)) {
    return <p className="text-[0.88em] text-muted-foreground">{props.empty}</p>;
  }
  return (
    <div
      className={cn(
        "grid gap-3.5",
        props.projection
          ? "grid-cols-1"
          : "grid-cols-1 md:grid-cols-[repeat(auto-fit,minmax(320px,1fr))]",
      )}
    >
      {props.columns
        .filter((c) => c.items.length > 0)
        .map((col) => (
          <div
            key={col.key}
            className="overflow-hidden rounded-md border border-border/80 bg-card"
          >
            <h3 className="flex items-center justify-between bg-muted/60 px-3.5 py-2.5 text-[0.92em] font-semibold uppercase tracking-wide">
              {col.label}
              <span className="font-mono text-[0.85em] font-normal normal-case tracking-normal text-muted-foreground">
                {col.items.length}
              </span>
            </h3>
            {col.items.map((t) => (
              <TopicCard
                key={t.id}
                topic={t}
                entities={props.entities}
                liveEditable={props.liveEditable}
                expandAll={props.expandAll}
                onPatchUpdate={props.onPatchUpdate}
                onOpenHistory={props.onOpenHistory}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

export function MtgPresentationTemplate(props: {
  title: string;
  dateLabel: string;
  topics: BoardTopicRow[];
  entities: MtgEntity[];
  expectedNext: MtgExpectedNextRow[];
  decisions: MtgDecisionRow[];
  agreements?: MtgAgreementRow[];
  liveEditable: boolean;
  /** Pantalla completa / tipografía de proyección */
  projection?: boolean;
  onPatchUpdate: (updateId: string, patch: Record<string, unknown>) => void;
  onToggleExpected?: (id: string, done: boolean) => void;
  onOpenHistory?: (topic: { id: string; title: string }) => void;
  /** Antes del título (p. ej. volver a Juntas). */
  headerLeading?: ReactNode;
  /** Estado, navegación de la serie, clientes. */
  meta?: ReactNode;
  /** Acciones de la junta (iniciar/terminar, llamada, proyectar…). */
  toolbar?: ReactNode;
  /** Filtros por entidad (izquierda del toggle de contexto). */
  filters?: ReactNode;
  /** Captura de la sesión (grabación / transcripción). */
  capture?: ReactNode;
  /** Formulario para capturar acuerdos → tareas. */
  agreementComposer?: ReactNode;
  /** Controles por acuerdo (tarea / proyecto). */
  renderAgreementExtra?: (agreement: MtgAgreementRow) => ReactNode;
  onResolveDecision?: (decisionId: string, resolution: string) => void;
  /** Contexto al final (vencimientos, tareas, archivo). */
  footer?: ReactNode;
}) {
  const [expandAll, setExpandAll] = useState(false);

  const { resolved, neu, open, decisionsPending, decisionsSorted, counters } = useMemo(() => {
    const withUpdate = props.topics.filter((t) => t.update);
    const resolved = withUpdate.filter((t) => t.update!.movement === "resolved");
    const neu = withUpdate.filter((t) => t.update!.movement === "new");
    const openSorted = sortOpenUpdatesByMovement(
      withUpdate
        .filter((t) => bucketForMovement(t.update!.movement) === "open")
        .map((t) => ({ topic: t, movement: t.update!.movement as MtgMovement })),
    ).map((x) => x.topic);
    const counters = {
      resolved: resolved.length,
      advanced: withUpdate.filter((t) => t.update!.movement === "advanced").length,
      unchanged: withUpdate.filter((t) => t.update!.movement === "unchanged").length,
      newDec:
        neu.length +
        withUpdate.filter((t) => t.update!.movement === "decision_needed").length,
      blocked: withUpdate.filter((t) => t.update!.movement === "blocked_third_party")
        .length,
      waiting: withUpdate.filter((t) => t.update!.movement === "waiting_authority")
        .length,
    };
    const decisionsPending = props.decisions.filter((d) => d.status === "pending");
    const decisionsSorted = [
      ...decisionsPending,
      ...props.decisions.filter((d) => d.status !== "pending"),
    ];
    return { resolved, neu, open: openSorted, decisionsPending, decisionsSorted, counters };
  }, [props.topics, props.decisions]);

  const resolvedCols = useMemo(
    () => groupByEntity(resolved, props.entities),
    [resolved, props.entities],
  );
  const newCols = useMemo(
    () => groupByEntity(neu, props.entities),
    [neu, props.entities],
  );
  const openCols = useMemo(
    () => groupByEntity(open, props.entities),
    [open, props.entities],
  );

  const agreements = (props.agreements ?? []).filter((a) => a.status !== "rejected");
  const kpis: { n: number; label: string; sub: string; color: string }[] = [
    {
      n: counters.resolved,
      label: "resueltas",
      sub: "esta sesión",
      color: MOVEMENT_STRIPE.resolved,
    },
    {
      n: counters.advanced,
      label: "avanzaron",
      sub: "siguen abiertas",
      color: MOVEMENT_STRIPE.advanced,
    },
    {
      n: counters.unchanged,
      label: "sin movimiento",
      sub: "desde la anterior",
      color: MOVEMENT_STRIPE.unchanged,
    },
    {
      n: counters.newDec,
      label: "nuevas / decisión",
      sub: "para hoy",
      color: MOVEMENT_STRIPE.new,
    },
    {
      n: counters.blocked,
      label: "bloqueadas",
      sub: "por terceros",
      color: MOVEMENT_STRIPE.blocked_third_party,
    },
    {
      n: counters.waiting,
      label: "con la autoridad",
      sub: "esperando",
      color: MOVEMENT_STRIPE.waiting_authority,
    },
  ];

  return (
    <div
      className={cn(
        "mx-auto w-full animate-fade-in pb-16",
        props.projection
          ? "max-w-[1400px] px-5 pt-4 text-[18px] leading-relaxed"
          : "max-w-[1180px] space-y-0 text-[14px] leading-normal",
      )}
    >
      <header
        className={cn(
          "sticky top-0 z-10 mb-5 space-y-2.5 border-b border-border/80 bg-background/95 pb-3 pt-1 backdrop-blur-sm",
          !props.projection && "-mx-1 px-1",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-start gap-2">
            {props.headerLeading}
            <div className="min-w-0">
              <h2 className="m-0 truncate text-[1.55em] font-semibold tracking-tight text-foreground">
                {props.title}
              </h2>
              {props.meta && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.85em] text-muted-foreground">
                  {props.meta}
                </div>
              )}
            </div>
          </div>
          <div className="pt-1 font-mono text-[0.85em] text-muted-foreground">
            {props.dateLabel}
          </div>
        </div>
        {props.toolbar && (
          <div className="flex flex-wrap items-center gap-1.5">{props.toolbar}</div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">{props.filters}</div>
          <button
            type="button"
            className={cn(
              "rounded-full border px-3 py-1 text-[0.85em] font-medium transition-colors",
              expandAll
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
            aria-pressed={expandAll}
            onClick={() => setExpandAll((v) => !v)}
          >
            {expandAll ? "Cerrar todo el contexto" : "Abrir todo el contexto"}
          </button>
        </div>
      </header>

      {props.capture && <section className="mb-6">{props.capture}</section>}

      <section className="mb-8">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="rounded-md border border-border/80 border-t-[3px] bg-card px-3.5 py-3"
              style={{ borderTopColor: k.color }}
            >
              <div className="font-mono text-[2.1em] font-medium leading-none tabular-nums">
                {k.n}
              </div>
              <div className="mt-1.5 text-[0.9em] text-muted-foreground">{k.label}</div>
              <div className="mt-0.5 font-mono text-[0.8em] text-muted-foreground/80">
                {k.sub}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-2 font-mono text-[0.8em] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <i
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: MOVEMENT_STRIPE.resolved }}
            />
            se resolvió
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: MOVEMENT_STRIPE.advanced }}
            />
            avanzó, sigue abierta
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: MOVEMENT_STRIPE.unchanged }}
            />
            sin movimiento
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: MOVEMENT_STRIPE.new }}
            />
            nueva / decisión
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: MOVEMENT_STRIPE.blocked_third_party }}
            />
            bloqueada
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: MOVEMENT_STRIPE.waiting_authority }}
            />
            esperando autoridad
          </span>
        </div>
      </section>

      <section className="mb-8">
        <h3 className="mb-2.5 text-[1.1em] font-semibold tracking-wide">
          Acuerdos de hoy{" "}
          <small className="ml-2 font-mono text-[0.8em] font-normal text-muted-foreground">
            se escribe en vivo
          </small>
        </h3>
        {props.agreementComposer && <div className="mb-3">{props.agreementComposer}</div>}
        {agreements.length === 0 ? (
          <p className="text-[0.88em] text-muted-foreground">
            Sin acuerdos capturados aún. Escríbelos arriba o carga un resumen.
          </p>
        ) : (
          <ul className="space-y-2">
            {agreements.map((a) => (
              <li
                key={a.id}
                className={cn(
                  "rounded-md border border-border/70 bg-card px-3.5 py-2.5 text-[0.95em]",
                  a.status === "confirmed" && !a.project_id && "border-amber-400/70",
                )}
              >
                <div className="font-medium">{a.text}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[0.8em] text-muted-foreground">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 font-sans font-medium",
                      AGREEMENT_STATUS[a.status].color,
                    )}
                  >
                    {AGREEMENT_STATUS[a.status].label}
                  </span>
                  {a.entity_key && <span>{entityLabel(props.entities, a.entity_key)}</span>}
                  {a.owner_name && <span>{a.owner_name}</span>}
                  {a.due_date && <span>{a.due_date}</span>}
                  {props.renderAgreementExtra?.(a)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <h3 className="mb-2.5 text-[1.1em] font-semibold tracking-wide">
          Se resolvió{" "}
          <small className="ml-2 font-mono text-[0.8em] font-normal text-muted-foreground">
            {resolved.length} renglones
          </small>
        </h3>
        <EntityBoard
          columns={resolvedCols}
          empty="Aún no hay temas marcados como resueltos."
          entities={props.entities}
          liveEditable={props.liveEditable}
          expandAll={expandAll}
          projection={!!props.projection}
          onPatchUpdate={props.onPatchUpdate}
          onOpenHistory={props.onOpenHistory}
        />
      </section>

      <section className="mb-8">
        <h3 className="mb-2.5 text-[1.1em] font-semibold tracking-wide">
          Nuevo desde la sesión pasada{" "}
          <small className="ml-2 font-mono text-[0.8em] font-normal text-muted-foreground">
            {neu.length} renglones
          </small>
        </h3>
        <EntityBoard
          columns={newCols}
          empty="Sin temas nuevos en este filtro."
          entities={props.entities}
          liveEditable={props.liveEditable}
          expandAll={expandAll}
          projection={!!props.projection}
          onPatchUpdate={props.onPatchUpdate}
          onOpenHistory={props.onOpenHistory}
        />
      </section>

      <section className="mb-8">
        <h3 className="mb-2.5 text-[1.1em] font-semibold tracking-wide">
          Sigue abierto{" "}
          <small className="ml-2 font-mono text-[0.8em] font-normal text-muted-foreground">
            avance y siguiente paso · abre cada renglón para el contexto
          </small>
        </h3>
        <EntityBoard
          columns={openCols}
          empty="Sin frentes abiertos en este filtro."
          entities={props.entities}
          liveEditable={props.liveEditable}
          expandAll={expandAll}
          projection={!!props.projection}
          onPatchUpdate={props.onPatchUpdate}
          onOpenHistory={props.onOpenHistory}
        />
      </section>

      <section className="mb-8">
        <h3 className="mb-2.5 text-[1.1em] font-semibold tracking-wide">
          Decisiones que se piden hoy{" "}
          <small className="ml-2 font-mono text-[0.8em] font-normal text-muted-foreground">
            {decisionsPending.length} pendientes
          </small>
        </h3>
        {decisionsSorted.length === 0 ? (
          <p className="text-[0.88em] text-muted-foreground">Sin decisiones pendientes.</p>
        ) : (
          <div className="grid gap-2">
            {decisionsSorted.map((d, i) => (
              <div
                key={d.id}
                className={cn(
                  "grid grid-cols-[auto_1fr] gap-2.5 rounded-md border border-border/80 bg-card px-3.5 py-2.5",
                  d.status !== "pending" && "opacity-70",
                )}
                style={{
                  ["--st" as string]:
                    d.status === "pending" ? MOVEMENT_STRIPE.decision_needed : MOVEMENT_STRIPE.resolved,
                }}
              >
                <div
                  className="mt-1 w-1 self-stretch rounded-sm bg-[var(--st)]"
                  aria-hidden
                />
                <div>
                  <div className="font-medium">
                    {i + 1}. {d.text}
                  </div>
                  <div className="mt-1 font-mono text-[0.8em] text-muted-foreground">
                    {entityLabel(props.entities, d.entity_key)}
                    {d.status === "deferred" && " · diferida"}
                  </div>
                  {d.status === "pending" && props.liveEditable && props.onResolveDecision && (
                    <Input
                      className="mt-1.5 h-8 max-w-xl text-[0.9em]"
                      placeholder="Qué se decidió (Enter para guardar)"
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        const v = e.currentTarget.value.trim();
                        if (v) props.onResolveDecision?.(d.id, v);
                      }}
                    />
                  )}
                  {d.resolution && (
                    <p className="mt-1 text-[0.9em] text-muted-foreground">
                      Decidido: {d.resolution}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-4">
        <h3 className="mb-2.5 text-[1.1em] font-semibold tracking-wide">
          Para la próxima sesión
        </h3>
        {props.expectedNext.length === 0 ? (
          <p className="text-[0.88em] text-muted-foreground">
            Sin puntos listados para la próxima.
          </p>
        ) : (
          <ul className="space-y-2">
            {props.expectedNext.map((e) => (
              <li
                key={e.id}
                className={cn(
                  "flex items-start gap-3 rounded-md border border-border/70 bg-card px-3.5 py-2.5 text-[0.95em]",
                  e.done && "opacity-60",
                )}
              >
                <Checkbox
                  checked={!!e.done}
                  disabled={!props.liveEditable || !props.onToggleExpected}
                  onCheckedChange={(c) => props.onToggleExpected?.(e.id, !!c)}
                  className="mt-0.5"
                />
                <span className={cn(e.done && "line-through text-muted-foreground")}>
                  {e.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {props.footer && <div className="mt-8 space-y-6">{props.footer}</div>}
    </div>
  );
}
