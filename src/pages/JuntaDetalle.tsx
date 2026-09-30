/**
 * Tablero de junta — /juntas/:meetingId (Bloque 2).
 */

import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDateMX } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { useProfiles } from "@/hooks/useTasks";
import { useMtgBoard } from "@/hooks/useMtgBoard";
import {
  MOVEMENT,
  MEETING_STATUS,
  type MtgMovement,
} from "@/lib/mtg/constants";
import {
  bucketForMovement,
  countByMovement,
  entitiesForFilter,
  sortOpenUpdatesByMovement,
} from "@/lib/mtg/prepareBoard";
import {
  compactVisibleTopics,
  isMeetingLiveEditable,
  resolvedThisMeeting,
} from "@/lib/mtg/boardArchive";
import { unreviewedCount } from "@/lib/mtg/meetingLifecycle";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Link2, Loader2, Projector, Video } from "lucide-react";
import { toast } from "sonner";
import { MtgUploadTranscriptButton } from "@/components/mtg/MtgUploadTranscriptButton";
import { MtgRecordingControls } from "@/components/mtg/MtgRecordingControls";
import { MtgAssignClientDialog } from "@/components/mtg/MtgAssignClientDialog";
import { MtgTopicHistoryDrawer } from "@/components/mtg/MtgTopicHistoryDrawer";
import { MtgArchiveSection } from "@/components/mtg/MtgArchiveSection";
import { MtgJoinLinkDialog } from "@/components/mtg/MtgJoinLinkDialog";
import { parseMeetingJoinLink } from "@/lib/mtg/joinLink";

const PROJECTION_KEY = "mtg-projection-mode";

export default function JuntaDetalle() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: profiles = [] } = useProfiles();
  const board = useMtgBoard(meetingId);
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [projection, setProjection] = useState(() => {
    try {
      return localStorage.getItem(PROJECTION_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [historyTopic, setHistoryTopic] = useState<{ id: string; title: string } | null>(null);
  const [assignClientOpen, setAssignClientOpen] = useState(false);
  const [joinLinkOpen, setJoinLinkOpen] = useState(false);
  const [agreementDraft, setAgreementDraft] = useState({
    text: "",
    entityKey: "",
    clientId: "",
    projectId: "",
    ownerUserId: "",
    ownerName: "",
    dueDate: "",
  });
  const debounceTimers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    try {
      localStorage.setItem(PROJECTION_KEY, projection ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [projection]);

  const entities = useMemo(
    () => entitiesForFilter(board.data?.series?.entities, board.data?.meeting.client_id ?? null),
    [board.data],
  );

  const topicsFiltered = useMemo(() => {
    const list = board.data?.boardTopics ?? [];
    if (entityFilter === "all") return list;
    return list.filter((t) => t.entity_key === entityFilter);
  }, [board.data, entityFilter]);

  const compactTopics = useMemo(() => compactVisibleTopics(topicsFiltered), [topicsFiltered]);
  const updatesForCount = topicsFiltered
    .map((t) => t.update)
    .filter(Boolean)
    .map((u) => ({ movement: u!.movement as MtgMovement }));
  const counters = countByMovement(updatesForCount);

  const resolved = resolvedThisMeeting(topicsFiltered);
  const news = compactTopics.filter((t) => t.update && bucketForMovement(t.update.movement) === "new");
  const openSorted = sortOpenUpdatesByMovement(
    compactTopics
      .filter((t) => t.update && bucketForMovement(t.update.movement) === "open")
      .map((t) => ({ topic: t, movement: t.update!.movement as MtgMovement })),
  ).map((x) => x.topic);

  const schedulePatch = (updateId: string, patch: Record<string, unknown>) => {
    const prev = debounceTimers.current.get(updateId);
    if (prev) window.clearTimeout(prev);
    const t = window.setTimeout(() => {
      board.patchUpdate.mutate(
        { updateId, patch: patch as never },
        {
          onSuccess: () => setSavedAt(new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })),
          onError: (e: Error) => toast.error(e.message),
        },
      );
    }, 400);
    debounceTimers.current.set(updateId, t);
  };

  if (board.isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando tablero…
        </div>
      </AppLayout>
    );
  }

  if (board.error || !board.data) {
    return (
      <AppLayout>
        <p className="p-8 text-sm text-destructive">No se pudo cargar la junta.</p>
        <Button asChild variant="outline" className="ml-8">
          <Link to="/juntas">Volver a Juntas</Link>
        </Button>
      </AppLayout>
    );
  }

  const { meeting, series, agreements, decisions, expectedNext, projects, seriesMeetings } = board.data;
  const statusCfg = MEETING_STATUS[meeting.status];
  const orgId = meeting.organization_id;
  const liveEditable = isMeetingLiveEditable(meeting.status);
  const meetingIdx = seriesMeetings.findIndex((m) => m.id === meeting.id);
  const prevMeeting = meetingIdx > 0 ? seriesMeetings[meetingIdx - 1] : null;
  const nextMeeting =
    meetingIdx >= 0 && meetingIdx < seriesMeetings.length - 1 ? seriesMeetings[meetingIdx + 1] : null;

  const onCaptureAgreement = () => {
    if (!liveEditable) {
      toast.error("Junta en solo lectura");
      return;
    }
    if (!user || !agreementDraft.text.trim()) {
      toast.error("Escribe el acuerdo");
      return;
    }
    const clientId = agreementDraft.clientId || meeting.client_id || null;
    const projectId = agreementDraft.projectId || null;
    const willCreateTask = !!(clientId && projectId);
    // Sin cliente/proyecto: se guarda el acuerdo; la tarea se crea al asignar cliente + proyecto.
    board.addAgreement.mutate(
      {
        organizationId: orgId,
        actorUserId: user.id,
        meetingId: meeting.id,
        clientId,
        entityKey: agreementDraft.entityKey || null,
        projectId,
        text: agreementDraft.text.trim(),
        ownerUserId: agreementDraft.ownerUserId || null,
        ownerName: agreementDraft.ownerName || null,
        dueDate: agreementDraft.dueDate || null,
        ownerSide: agreementDraft.ownerUserId ? "kawiil" : agreementDraft.ownerName ? "client" : null,
        confirm: willCreateTask,
      },
      {
        onSuccess: () => {
          setAgreementDraft({
            text: "",
            entityKey: "",
            clientId: meeting.client_id ?? "",
            projectId: "",
            ownerUserId: "",
            ownerName: "",
            dueDate: "",
          });
          toast.success(
            willCreateTask
              ? "Acuerdo capturado → tarea"
              : "Acuerdo guardado (asigna cliente/proyecto para crear tarea)",
          );
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  const handleEnd = () => {
    const updates = board.data!.boardTopics.map((t) => t.update).filter(Boolean);
    const n = unreviewedCount(updates as { reviewed: boolean }[]);
    const pendingDec = decisions.filter((d) => d.status === "pending").length;
    if (n > 0 || pendingDec > 0) {
      const ok = window.confirm(
        `Hay ${n} tema(s) sin revisar y ${pendingDec} decisión(es) pendientes. ¿Terminar igual? (pendientes → diferidas)`,
      );
      if (!ok) return;
    }
    board.doEnd.mutate(undefined, {
      onSuccess: () => toast.success("Junta terminada"),
      onError: (e: Error) => toast.error(e.message),
    });
  };

  return (
    <AppLayout>
      <div className={cn("space-y-6 animate-fade-in pb-24", projection && "text-lg")}>
        {/* Encabezado */}
        <div className="sticky top-0 z-20 glass-card p-4 space-y-3 border-b">
          <div className="flex flex-wrap items-start gap-3 justify-between">
            <div className="flex items-start gap-2 min-w-0">
              <Button asChild variant="ghost" size="icon" className="shrink-0">
                <Link to="/juntas">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight truncate">
                  {series?.title ?? meeting.title ?? "Junta"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {formatDateMX(meeting.scheduled_at)} ·{" "}
                  <Badge variant="outline" className={cn("text-[10px] border-0", statusCfg.color)}>
                    {statusCfg.label}
                  </Badge>
                  {!meeting.client_id && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      Sin cliente
                    </Badge>
                  )}
                  {!liveEditable && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      Solo lectura
                    </Badge>
                  )}
                  {savedAt && <span className="ml-2 text-xs">guardado {savedAt}</span>}
                </p>
                {seriesMeetings.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={!prevMeeting}
                      onClick={() => prevMeeting && navigate(`/juntas/${prevMeeting.id}`)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Anterior
                    </Button>
                    <Select
                      value={meeting.id}
                      onValueChange={(id) => navigate(`/juntas/${id}`)}
                    >
                      <SelectTrigger className="h-7 w-[200px] text-xs">
                        <SelectValue placeholder="Junta" />
                      </SelectTrigger>
                      <SelectContent>
                        {seriesMeetings.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {formatDateMX(m.scheduled_at)} · {MEETING_STATUS[m.status]?.label ?? m.status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={!nextMeeting}
                      onClick={() => nextMeeting && navigate(`/juntas/${nextMeeting.id}`)}
                    >
                      Siguiente <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={projection ? "default" : "outline"}
                size="sm"
                onClick={() => setProjection((p) => !p)}
              >
                <Projector className="h-3.5 w-3.5 mr-1" /> Modo proyección
              </Button>
              {meeting.teams_join_url ? (
                <>
                  <Button asChild size="sm">
                    <a href={meeting.teams_join_url} target="_blank" rel="noreferrer">
                      <Video className="h-3.5 w-3.5 mr-1" />
                      {(() => {
                        try {
                          return `Unirse · ${parseMeetingJoinLink(meeting.teams_join_url).label}`;
                        } catch {
                          return "Unirse a la llamada";
                        }
                      })()}
                      <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setJoinLinkOpen(true)}
                  >
                    <Link2 className="h-3.5 w-3.5 mr-1" />
                    Cambiar link
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setJoinLinkOpen(true)}
                >
                  <Link2 className="h-3.5 w-3.5 mr-1" />
                  Pegar link de llamada
                </Button>
              )}
              {liveEditable && meeting.status === "planned" && (
                <Button
                  size="sm"
                  onClick={() =>
                    board.doStart.mutate(undefined, {
                      onError: (e: Error) => toast.error(e.message),
                    })
                  }
                  disabled={board.doStart.isPending}
                >
                  Iniciar junta
                </Button>
              )}
              {liveEditable && (meeting.status === "in_progress" || meeting.status === "planned") && (
                <Button size="sm" variant="secondary" onClick={handleEnd} disabled={board.doEnd.isPending}>
                  Terminar junta
                </Button>
              )}
              {user && (
                <MtgUploadTranscriptButton
                  organizationId={orgId}
                  actorUserId={user.id}
                  meeting={meeting}
                  series={series}
                  onDone={() => board.invalidate()}
                />
              )}
              {(meeting.status === "ended" ||
                meeting.status === "minutes_draft" ||
                meeting.status === "minutes_review" ||
                meeting.status === "minutes_approved" ||
                meeting.status === "closed") && (
                <Button asChild size="sm" variant="outline">
                  <Link to={`/juntas/${meeting.id}/minuta`}>Minuta</Link>
                </Button>
              )}
            </div>
          </div>
            {user && orgId && (
            <MtgRecordingControls
              organizationId={orgId}
              actorUserId={user.id}
              meeting={meeting}
              series={series}
              onDone={() => board.invalidate()}
            />
          )}

          {!meeting.client_id && user && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
              <p className="text-muted-foreground">
                Esta junta aún no tiene cliente. Puedes grabar, tomar notas y generar minuta; al final
                asignas el cliente para migrar el contexto o las tareas.
              </p>
              <Button size="sm" variant="secondary" onClick={() => setAssignClientOpen(true)}>
                Asignar cliente
              </Button>
            </div>
          )}
          {meeting.client_id && user && (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => setAssignClientOpen(true)}>
                Cambiar / reasignar cliente
              </Button>
            </div>
          )}

          {entities.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={entityFilter === "all" ? "default" : "outline"}
                onClick={() => setEntityFilter("all")}
              >
                Todo
              </Button>
              {entities.map((e) => (
                <Button
                  key={e.key}
                  size="sm"
                  variant={entityFilter === e.key ? "default" : "outline"}
                  onClick={() => setEntityFilter(e.key)}
                >
                  {e.label}
                </Button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 text-xs">
            {(Object.keys(MOVEMENT) as MtgMovement[]).map((m) => (
              <span key={m} className={cn("px-2 py-0.5 rounded", MOVEMENT[m].color)}>
                {MOVEMENT[m].label}: {counters[m] ?? 0}
              </span>
            ))}
            <span className="text-muted-foreground">Total: {updatesForCount.length}</span>
          </div>
        </div>

        {/* Acuerdos de hoy */}
        <section className="space-y-3">
          <h2 className="font-semibold">Acuerdos de hoy</h2>
          {liveEditable && (
            <>
          <div className="grid gap-2 md:grid-cols-6">
            <Input
              className="md:col-span-2"
              placeholder="Texto del acuerdo"
              value={agreementDraft.text}
              onChange={(e) => setAgreementDraft((d) => ({ ...d, text: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && onCaptureAgreement()}
            />
            <Select
              value={agreementDraft.entityKey || undefined}
              onValueChange={(key) => {
                const ent = entities.find((e) => e.key === key);
                setAgreementDraft((d) => ({
                  ...d,
                  entityKey: key,
                  clientId: ent?.client_id ?? d.clientId,
                }));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Entidad" />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.key} value={e.key}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={agreementDraft.projectId || undefined}
              onValueChange={(v) => setAgreementDraft((d) => ({ ...d, projectId: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Proyecto" />
              </SelectTrigger>
              <SelectContent>
                {projects
                  .filter((p) => !agreementDraft.clientId || p.client_id === agreementDraft.clientId)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.area}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select
              value={agreementDraft.ownerUserId || undefined}
              onValueChange={(v) => setAgreementDraft((d) => ({ ...d, ownerUserId: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Responsable" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>
                    {p.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={agreementDraft.dueDate}
              onChange={(e) => setAgreementDraft((d) => ({ ...d, dueDate: e.target.value }))}
            />
          </div>
          <Button size="sm" onClick={onCaptureAgreement} disabled={board.addAgreement.isPending}>
            Guardar acuerdo (Enter)
          </Button>
            </>
          )}
          <ul className="space-y-2">
            {agreements.map((a) => (
              <li
                key={a.id}
                className={cn(
                  "rounded-md border p-3 text-sm",
                  a.status === "confirmed" && !a.project_id && "border-amber-400 bg-amber-50/50",
                )}
              >
                <div className="font-medium">{a.text}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {a.status} · {a.project_id ? "con proyecto" : "ámbar (sin proyecto)"} ·{" "}
                  {a.task_id ? `tarea ${a.task_id.slice(0, 8)}…` : "sin tarea"}
                </div>
                {liveEditable && a.status === "confirmed" && !a.task_id && user && (
                  <Select
                    onValueChange={(pid) =>
                      board.setProject.mutate({
                        agreement: a,
                        projectId: pid,
                        organizationId: orgId,
                        actorUserId: user.id,
                      })
                    }
                  >
                    <SelectTrigger className="mt-2 max-w-xs">
                      <SelectValue placeholder="Elegir proyecto → crear tarea" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects
                        .filter((p) => p.client_id === a.client_id)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} · {p.area}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Resuelto / Nuevo */}
        {resolved.length > 0 && (
          <section>
            <h2 className="font-semibold mb-2">Se resolvió desde la sesión pasada</h2>
            {resolved.map((t) => (
              <TopicRow
                key={t.id}
                topic={t}
                projection={projection}
                readOnly={!liveEditable}
                onPatch={schedulePatch}
                onOpenHistory={() => setHistoryTopic({ id: t.id, title: t.title })}
              />
            ))}
          </section>
        )}
        {news.length > 0 && (
          <section>
            <h2 className="font-semibold mb-2">Nuevo desde la sesión pasada</h2>
            {news.map((t) => (
              <TopicRow
                key={t.id}
                topic={t}
                projection={projection}
                readOnly={!liveEditable}
                onPatch={schedulePatch}
                onOpenHistory={() => setHistoryTopic({ id: t.id, title: t.title })}
              />
            ))}
          </section>
        )}

        {/* Sigue abierto */}
        <section>
          <h2 className="font-semibold mb-2">Sigue abierto</h2>
          {openSorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin temas abiertos en este filtro.</p>
          ) : (
            openSorted.map((t) => (
              <TopicRow
                key={t.id}
                topic={t}
                projection={projection}
                readOnly={!liveEditable}
                onPatch={schedulePatch}
                onOpenHistory={() => setHistoryTopic({ id: t.id, title: t.title })}
              />
            ))
          )}
        </section>

        {/* Decisiones */}
        <section>
          <h2 className="font-semibold mb-2">Decisiones que se piden hoy</h2>
          {decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguna.</p>
          ) : (
            decisions.map((d, i) => (
              <div key={d.id} className="border rounded-md p-3 mb-2 space-y-2">
                <div className="text-sm font-medium">
                  {i + 1}. {d.text}{" "}
                  <Badge variant="outline">{d.status}</Badge>
                </div>
                {liveEditable && d.status === "pending" && user && (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Qué se decidió"
                      id={`dec-${d.id}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const v = (e.target as HTMLInputElement).value;
                          if (!v.trim()) return;
                          board.markDecision.mutate({
                            decisionId: d.id,
                            resolution: v.trim(),
                            organizationId: orgId,
                            actorUserId: user.id,
                          });
                        }
                      }}
                    />
                  </div>
                )}
                {d.resolution && <p className="text-xs text-muted-foreground">{d.resolution}</p>}
              </div>
            ))
          )}
        </section>

        {/* Próxima */}
        <section>
          <h2 className="font-semibold mb-2">Para la próxima sesión</h2>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {expectedNext.map((e) => (
              <li key={e.id} className={e.done ? "line-through text-muted-foreground" : ""}>
                {e.text}
              </li>
            ))}
          </ul>
        </section>

        {/* Contexto: vencimientos / tareas */}
        <section className="grid md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-semibold mb-1">Vencimientos (compliance)</h3>
            <ul className="text-xs space-y-1 max-h-40 overflow-auto">
              {board.data.deadlines.slice(0, 40).map((t) => (
                <li key={t.id}>
                  {t.title} {t.due_date ? `· ${t.due_date}` : ""}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-1">Tareas abiertas</h3>
            <ul className="text-xs space-y-1 max-h-40 overflow-auto">
              {board.data.plainTasks.slice(0, 40).map((t) => (
                <li key={t.id}>
                  {t.title} · {t.status}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {series && user && (
          <MtgArchiveSection
            seriesId={series.id}
            organizationId={orgId}
            actorUserId={user.id}
            meeting={meeting}
            entities={entities}
            liveEditable={liveEditable}
            onOpenHistory={(t) => setHistoryTopic(t)}
            onReopened={() => board.invalidate()}
          />
        )}
      </div>

      <MtgTopicHistoryDrawer
        topicId={historyTopic?.id ?? null}
        topicTitle={historyTopic?.title}
        open={!!historyTopic}
        onOpenChange={(o) => {
          if (!o) setHistoryTopic(null);
        }}
      />

      {user && (
        <MtgAssignClientDialog
          open={assignClientOpen}
          onOpenChange={setAssignClientOpen}
          organizationId={orgId}
          actorUserId={user.id}
          meetingId={meeting.id}
          currentClientId={meeting.client_id}
          onDone={() => board.invalidate()}
        />
      )}

      {user && (
        <MtgJoinLinkDialog
          open={joinLinkOpen}
          onOpenChange={setJoinLinkOpen}
          organizationId={orgId}
          actorUserId={user.id}
          meeting={meeting}
          onDone={() => board.invalidate()}
        />
      )}
    </AppLayout>
  );
}

function TopicRow({
  topic,
  projection,
  readOnly,
  onPatch,
  onOpenHistory,
}: {
  topic: import("@/hooks/useMtgBoard").BoardTopicRow;
  projection: boolean;
  readOnly: boolean;
  onPatch: (updateId: string, patch: Record<string, unknown>) => void;
  onOpenHistory: () => void;
}) {
  const [openCtx, setOpenCtx] = useState(false);
  const u = topic.update;
  if (!u) return null;
  const overdue =
    topic.due_date &&
    u.movement !== "resolved" &&
    new Date(topic.due_date) < new Date(new Date().toDateString());

  return (
    <div className={cn("border rounded-md p-3 mb-2 space-y-2", MOVEMENT[u.movement].color.replace(/text-\S+/g, ""))}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button
          type="button"
          className="font-medium text-sm text-left hover:underline"
          onClick={onOpenHistory}
        >
          {topic.title}
        </button>
        <div className="flex items-center gap-2">
          {readOnly ? (
            <Badge variant="outline" className={MOVEMENT[u.movement].color}>
              {MOVEMENT[u.movement].label}
            </Badge>
          ) : (
            <Select
              value={u.movement}
              onValueChange={(v) => onPatch(u.id, { movement: v, origin: "edited_live" })}
            >
              <SelectTrigger className="w-[180px] h-8">
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
          )}
          {!readOnly && (
            <label className="flex items-center gap-1 text-xs">
              <Checkbox
                checked={u.reviewed}
                onCheckedChange={(c) =>
                  onPatch(u.id, {
                    reviewed: !!c,
                    reviewed_at: c ? new Date().toISOString() : null,
                  })
                }
              />
              Revisado
            </label>
          )}
        </div>
      </div>
      <div className={cn("grid gap-2", projection ? "grid-cols-1" : "md:grid-cols-2")}>
        <Textarea
          className="text-sm min-h-[60px]"
          placeholder="Avance"
          defaultValue={u.progress_since_last ?? ""}
          readOnly={readOnly}
          onChange={(e) => {
            if (readOnly) return;
            onPatch(u.id, { progress_since_last: e.target.value, origin: "edited_live" });
          }}
        />
        <Textarea
          className="text-sm min-h-[60px]"
          placeholder="Sigue"
          defaultValue={u.next_step ?? ""}
          readOnly={readOnly}
          onChange={(e) => {
            if (readOnly) return;
            onPatch(u.id, { next_step: e.target.value, origin: "edited_live" });
          }}
        />
      </div>
      <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
        <span>{topic.owner_name ?? "—"}</span>
        <span className={overdue ? "text-red-600 font-medium" : ""}>
          {topic.due_date ? formatDateMX(topic.due_date) : "sin fecha"}
        </span>
        <button type="button" className="underline" onClick={() => setOpenCtx((o) => !o)}>
          Contexto y notas
        </button>
      </div>
      {openCtx && (
        <div className="text-xs space-y-1 bg-background/60 p-2 rounded">
          {topic.context && <p><strong>Contexto:</strong> {topic.context}</p>}
          {topic.if_asked && <p><strong>Si preguntan:</strong> {topic.if_asked}</p>}
          {topic.source && <p><strong>Fuente:</strong> {topic.source}</p>}
          <Textarea
            className="text-xs mt-1"
            placeholder={readOnly ? "Notas posteriores" : "Notas de sesión"}
            defaultValue={u.session_notes ?? ""}
            onChange={(e) =>
              onPatch(u.id, { session_notes: e.target.value, origin: "edited_live" })
            }
          />
        </div>
      )}
    </div>
  );
}
