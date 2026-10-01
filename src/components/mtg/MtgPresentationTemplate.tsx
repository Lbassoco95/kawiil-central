/**
 * Plantilla de presentación en vivo (estructura tipo resumen DOCX):
 * Lo que se cerró · En curso · Para acordar hoy · Próxima sesión.
 * Se alimenta durante la junta; no es un “cargar archivo”.
 */

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MOVEMENT, type MtgMovement } from "@/lib/mtg/constants";
import { bucketForMovement, sortOpenUpdatesByMovement } from "@/lib/mtg/prepareBoard";
import type { BoardTopicRow } from "@/hooks/useMtgBoard";
import type { MtgDecisionRow, MtgEntity, MtgExpectedNextRow } from "@/lib/mtg/db";

function entityLabel(entities: MtgEntity[], key: string | null | undefined): string {
  if (!key) return "—";
  return entities.find((e) => e.key === key)?.label ?? key;
}

function movementEstado(m: MtgMovement): string {
  return MOVEMENT[m]?.label ?? m;
}

export function MtgPresentationTemplate(props: {
  title: string;
  dateLabel: string;
  topics: BoardTopicRow[];
  entities: MtgEntity[];
  expectedNext: MtgExpectedNextRow[];
  decisions: MtgDecisionRow[];
  liveEditable: boolean;
  onPatchUpdate: (updateId: string, patch: Record<string, unknown>) => void;
  onToggleExpected?: (id: string, done: boolean) => void;
  onOpenHistory?: (topic: { id: string; title: string }) => void;
}) {
  const { closed, inProgress, spotlight } = useMemo(() => {
    const withUpdate = props.topics.filter((t) => t.update);
    const closed = withUpdate.filter((t) => t.update!.movement === "resolved");
    const spotlight = withUpdate.filter(
      (t) =>
        t.update!.movement === "new" ||
        t.update!.movement === "decision_needed",
    );
    const openSorted = sortOpenUpdatesByMovement(
      withUpdate
        .filter((t) => bucketForMovement(t.update!.movement) === "open")
        .map((t) => ({ topic: t, movement: t.update!.movement as MtgMovement })),
    ).map((x) => x.topic);
    return { closed, inProgress: openSorted, spotlight };
  }, [props.topics]);

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="space-y-1 border-b border-border/60 pb-4">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Plantilla de presentación
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {props.title}
        </h2>
        <p className="text-sm text-muted-foreground">{props.dateLabel}</p>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Estructura para proyectar y nutrir en vivo. Edita avance, estado y acuerdos
          aquí; la grabación de la llamada vive en Teams y se puede extraer después.
        </p>
      </header>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Lo que se cerró</h3>
        {closed.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay temas marcados como resueltos.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border/70">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Asunto</th>
                  <th className="px-3 py-2 font-medium w-[22%]">Entidad</th>
                  <th className="px-3 py-2 font-medium w-[40%]">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((t) => (
                  <tr key={t.id} className="border-b border-border/50 align-top">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        className="font-medium text-left hover:underline"
                        onClick={() => props.onOpenHistory?.({ id: t.id, title: t.title })}
                      >
                        {t.title}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {entityLabel(props.entities, t.entity_key)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Textarea
                        className="min-h-[56px] text-sm bg-background"
                        placeholder="Resultado / evidencia"
                        defaultValue={t.update?.progress_since_last ?? ""}
                        readOnly={!props.liveEditable}
                        onChange={(e) => {
                          if (!props.liveEditable || !t.update) return;
                          props.onPatchUpdate(t.update.id, {
                            progress_since_last: e.target.value,
                            origin: "edited_live",
                          });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">En curso</h3>
        {inProgress.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin frentes abiertos en este filtro.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border/70">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Asunto</th>
                  <th className="px-3 py-2 font-medium w-[18%]">Estado</th>
                  <th className="px-3 py-2 font-medium w-[36%]">Sigue</th>
                </tr>
              </thead>
              <tbody>
                {inProgress.map((t) => {
                  const u = t.update!;
                  return (
                    <tr key={t.id} className="border-b border-border/50 align-top">
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          className="font-medium text-left hover:underline"
                          onClick={() => props.onOpenHistory?.({ id: t.id, title: t.title })}
                        >
                          {t.title}
                        </button>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {entityLabel(props.entities, t.entity_key)}
                        </div>
                        {props.liveEditable && (
                          <Textarea
                            className="mt-2 min-h-[48px] text-xs"
                            placeholder="Avance desde la última"
                            defaultValue={u.progress_since_last ?? ""}
                            onChange={(e) =>
                              props.onPatchUpdate(u.id, {
                                progress_since_last: e.target.value,
                                origin: "edited_live",
                              })
                            }
                          />
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {props.liveEditable ? (
                          <Select
                            value={u.movement}
                            onValueChange={(v) =>
                              props.onPatchUpdate(u.id, { movement: v, origin: "edited_live" })
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
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
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] border-0", MOVEMENT[u.movement].color)}
                          >
                            {movementEstado(u.movement)}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Textarea
                          className="min-h-[72px] text-sm"
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {spotlight.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Focos de hoy</h3>
          <div className="space-y-3">
            {spotlight.map((t) => {
              const u = t.update!;
              return (
                <div
                  key={t.id}
                  className="rounded-md border border-border/70 bg-muted/15 px-4 py-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="font-medium text-left hover:underline"
                      onClick={() => props.onOpenHistory?.({ id: t.id, title: t.title })}
                    >
                      {t.title}
                    </button>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] border-0", MOVEMENT[u.movement].color)}
                    >
                      {MOVEMENT[u.movement].label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {entityLabel(props.entities, t.entity_key)}
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <Textarea
                      className="min-h-[60px] text-sm"
                      placeholder="Avance / propuesta"
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
                    <Textarea
                      className="min-h-[60px] text-sm"
                      placeholder="Qué acordamos / sigue"
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
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Para acordar hoy</h3>
        {props.expectedNext.length === 0 && props.decisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin puntos de acuerdo listados.</p>
        ) : (
          <ul className="space-y-2">
            {props.expectedNext.map((e) => (
              <li
                key={e.id}
                className={cn(
                  "flex items-start gap-3 rounded-md border border-border/60 px-3 py-2 text-sm",
                  e.done && "opacity-60",
                )}
              >
                <Checkbox
                  checked={!!e.done}
                  disabled={!props.liveEditable || !props.onToggleExpected}
                  onCheckedChange={(c) => props.onToggleExpected?.(e.id, !!c)}
                  className="mt-0.5"
                />
                <span className={cn(e.done && "line-through text-muted-foreground")}>{e.text}</span>
              </li>
            ))}
            {props.decisions.map((d) => (
              <li
                key={d.id}
                className="flex items-start gap-3 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm"
              >
                <span className="mt-0.5 text-amber-700 dark:text-amber-400">◇</span>
                <div>
                  <p>{d.text}</p>
                  {d.resolution && (
                    <p className="text-xs text-muted-foreground mt-1">Decidido: {d.resolution}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Próxima sesión</h3>
        <p className="text-sm text-muted-foreground">
          Marca arriba lo acordado; al terminar la junta la minuta recoge el tablero y lo
          extraído de Teams.
        </p>
      </section>
    </div>
  );
}
