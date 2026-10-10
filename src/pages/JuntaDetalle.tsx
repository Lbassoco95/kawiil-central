/**
 * Tablero de junta — /juntas/:meetingId (Bloque 2).
 */

import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatDateMX } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { useProfiles } from "@/hooks/useTasks";
import { useMtgBoard } from "@/hooks/useMtgBoard";
import { MEETING_STATUS } from "@/lib/mtg/constants";
import { isMeetingLiveEditable } from "@/lib/mtg/boardArchive";
import { entitiesForFilter } from "@/lib/mtg/prepareBoard";
import { unreviewedCount } from "@/lib/mtg/meetingLifecycle";
import {
  ArrowLeft,
  Bot,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FileUp,
  Link2,
  Loader2,
  Minimize2,
  MoreHorizontal,
  Play,
  Plus,
  Projector,
  Square,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { MtgUploadTranscriptButton } from "@/components/mtg/MtgUploadTranscriptButton";
import { MtgRecordingControls } from "@/components/mtg/MtgRecordingControls";
import { MtgAssignClientDialog } from "@/components/mtg/MtgAssignClientDialog";
import { MtgTopicHistoryDrawer } from "@/components/mtg/MtgTopicHistoryDrawer";
import { MtgArchiveSection } from "@/components/mtg/MtgArchiveSection";
import { MtgJoinLinkDialog } from "@/components/mtg/MtgJoinLinkDialog";
import { MtgImportResumenDialog } from "@/components/mtg/MtgImportResumenDialog";
import { inviteKawiilito } from "@/components/mtg/inviteKawiilito";
import { MtgPresentationTemplate } from "@/components/mtg/MtgPresentationTemplate";
import { parseMeetingJoinLink } from "@/lib/mtg/joinLink";
import {
  findGroupBoardMeetingForDay,
  shouldSeekGroupBoard,
} from "@/lib/mtg/findGroupBoardMeeting";

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
  const [importResumenOpen, setImportResumenOpen] = useState(false);
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
  const redirectedRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(PROJECTION_KEY, projection ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [projection]);

  useEffect(() => {
    if (!projection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      setProjection(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projection]);

  // Junta vacía/cancelada del calendario → tablero de grupo del mismo día (con plantilla DOCX).
  useEffect(() => {
    if (!board.data || redirectedRef.current) return;
    const m = board.data.meeting;
    const topicCount = board.data.boardTopics.filter((t) => t.update).length;
    if (
      !shouldSeekGroupBoard({
        series_id: m.series_id,
        status: m.status,
        topicUpdateCount: topicCount,
      })
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const target = await findGroupBoardMeetingForDay({
          organizationId: m.organization_id,
          scheduledAt: m.scheduled_at,
          excludeMeetingId: m.id,
        });
        if (cancelled || !target || target.id === m.id) return;
        redirectedRef.current = true;
        toast.message("Abriendo el tablero de grupo con la plantilla de sesión…", {
          duration: 6000,
        });
        navigate(`/juntas/${target.id}`, { replace: true });
      } catch {
        /* no bloquear si no hay tablero hermano */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [board.data, navigate]);

  const entities = useMemo(
    () => entitiesForFilter(board.data?.series?.entities, board.data?.meeting.client_id ?? null),
    [board.data],
  );

  const topicsFiltered = useMemo(() => {
    const list = board.data?.boardTopics ?? [];
    if (entityFilter === "all") return list;
    return list.filter((t) => t.entity_key === entityFilter);
  }, [board.data, entityFilter]);

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
      onSuccess: () =>
        toast.success("Junta terminada — borrador de minuta listo", {
          action: {
            label: "Ver minuta",
            onClick: () => navigate(`/juntas/${meetingId}/minuta`),
          },
        }),
      onError: (e: Error) => toast.error(e.message),
    });
  };

  const chipClass = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-[0.85em] font-medium transition-colors",
      active
        ? "border-foreground bg-foreground text-background"
        : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground",
    );

  const showMinutaLink =
    meeting.status === "ended" ||
    meeting.status === "minutes_draft" ||
    meeting.status === "minutes_review" ||
    meeting.status === "minutes_approved" ||
    meeting.status === "closed";

  const joinLabel = (() => {
    if (!meeting.teams_join_url) return "";
    try {
      return `Unirse · ${parseMeetingJoinLink(meeting.teams_join_url).label}`;
    } catch {
      return "Unirse a la llamada";
    }
  })();

  const meta = (
    <>
      <Badge variant="outline" className={cn("text-[10px] border-0", statusCfg.color)}>
        {statusCfg.label}
      </Badge>
      {!meeting.client_id && entities.length === 0 && (
        <Badge variant="secondary" className="text-[10px]">
          Sin cliente
        </Badge>
      )}
      {!liveEditable && (
        <Badge variant="secondary" className="text-[10px]">
          Solo lectura
        </Badge>
      )}
      {savedAt && <span className="font-mono text-[0.9em]">guardado {savedAt}</span>}
      {!projection && seriesMeetings.length > 1 && (
        <span className="inline-flex items-center gap-0.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-1.5"
            disabled={!prevMeeting}
            onClick={() => prevMeeting && navigate(`/juntas/${prevMeeting.id}`)}
            aria-label="Junta anterior"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Select value={meeting.id} onValueChange={(id) => navigate(`/juntas/${id}`)}>
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
            className="h-7 px-1.5"
            disabled={!nextMeeting}
            onClick={() => nextMeeting && navigate(`/juntas/${nextMeeting.id}`)}
            aria-label="Junta siguiente"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </span>
      )}
    </>
  );

  const toolbar = (
    <>
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
          <Play className="h-3.5 w-3.5 mr-1" />
          Iniciar junta
        </Button>
      )}
      {liveEditable && (meeting.status === "in_progress" || meeting.status === "planned") && (
        <Button
          size="sm"
          variant={meeting.status === "in_progress" ? "default" : "secondary"}
          onClick={handleEnd}
          disabled={board.doEnd.isPending}
        >
          <Square className="h-3.5 w-3.5 mr-1" />
          Terminar junta
        </Button>
      )}
      {showMinutaLink && (
        <Button asChild size="sm">
          <Link to={`/juntas/${meeting.id}/minuta`}>
            <FileText className="h-3.5 w-3.5 mr-1" />
            Minuta
          </Link>
        </Button>
      )}
      {meeting.teams_join_url ? (
        <span className="inline-flex">
          <Button asChild size="sm" variant="outline" className="rounded-r-none">
            <a href={meeting.teams_join_url} target="_blank" rel="noreferrer">
              <Video className="h-3.5 w-3.5 mr-1" />
              {joinLabel}
              <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-l-none border-l-0 px-2"
            onClick={() => setJoinLinkOpen(true)}
            title="Cambiar link de la llamada"
            aria-label="Cambiar link de la llamada"
          >
            <Link2 className="h-3.5 w-3.5" />
          </Button>
        </span>
      ) : (
        user && (
          <Button type="button" variant="outline" size="sm" onClick={() => setJoinLinkOpen(true)}>
            <Link2 className="h-3.5 w-3.5 mr-1" />
            Pegar link de llamada
          </Button>
        )
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setProjection((v) => !v)}
        title={
          projection
            ? "Volver a la vista con menú (Esc)"
            : "Pantalla completa para compartir pantalla"
        }
      >
        {projection ? (
          <Minimize2 className="h-3.5 w-3.5 mr-1" />
        ) : (
          <Projector className="h-3.5 w-3.5 mr-1" />
        )}
        {projection ? "Salir de proyección" : "Proyectar"}
      </Button>
      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Más acciones">
              <MoreHorizontal className="h-4 w-4 mr-1" />
              Más
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {series && liveEditable && (
              <DropdownMenuItem onSelect={() => setImportResumenOpen(true)}>
                <FileUp className="h-3.5 w-3.5 mr-2" />
                Cargar resumen (texto/DOCX)
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setAssignClientOpen(true)}>
              <Users className="h-3.5 w-3.5 mr-2" />
              {entities.length > 0 || meeting.client_id ? "Editar clientes" : "Asignar cliente(s)"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => inviteKawiilito(meeting, () => setJoinLinkOpen(true))}
            >
              <Bot className="h-3.5 w-3.5 mr-2" />
              Invitar Kawiilito
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );

  const filters = (
    <>
      {entities.length > 1 && (
        <>
          <button
            type="button"
            className={chipClass(entityFilter === "all")}
            aria-pressed={entityFilter === "all"}
            onClick={() => setEntityFilter("all")}
          >
            Todo el grupo
          </button>
          {entities.map((e) => (
            <button
              key={e.key}
              type="button"
              className={chipClass(entityFilter === e.key)}
              aria-pressed={entityFilter === e.key}
              onClick={() => setEntityFilter(e.key)}
            >
              {e.label}
            </button>
          ))}
        </>
      )}
      {entities.length === 1 && (
        <span className="text-[0.85em] text-muted-foreground">
          Cliente: <span className="font-medium text-foreground">{entities[0].label}</span>
        </span>
      )}
      {!meeting.client_id && entities.length === 0 && user && (
        <button type="button" className={chipClass(false)} onClick={() => setAssignClientOpen(true)}>
          <Users className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          Asignar cliente(s)
        </button>
      )}
    </>
  );

  const capture =
    user && orgId ? (
      <div className="rounded-md border border-border/80 bg-card px-3.5 py-2.5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="m-0 text-[0.85em] font-semibold uppercase tracking-wide text-muted-foreground">
            Captura de la sesión
          </h3>
          {!meeting.recording_path && (
            <span className="text-[0.78em] text-muted-foreground">
              Graba aquí (hasta ~3 h) o sube audio / transcripción. Si falla la red queda copia
              local.
            </span>
          )}
        </div>
        <MtgRecordingControls
          organizationId={orgId}
          actorUserId={user.id}
          meeting={meeting}
          series={series}
          onDone={() => board.invalidate()}
          extraActions={
            <MtgUploadTranscriptButton
              organizationId={orgId}
              actorUserId={user.id}
              meeting={meeting}
              series={series}
              onDone={() => board.invalidate()}
            />
          }
        />
      </div>
    ) : null;

  const agreementComposer = liveEditable ? (
    <div className="space-y-2 rounded-md border border-dashed border-border/80 bg-muted/20 p-2.5">
      <div className="grid gap-2 md:grid-cols-6">
        <Input
          className="md:col-span-2"
          placeholder="Nuevo acuerdo / tarea"
          value={agreementDraft.text}
          onChange={(e) => setAgreementDraft((d) => ({ ...d, text: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && onCaptureAgreement()}
        />
        {entities.length > 0 && (
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
        )}
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.78em] text-muted-foreground">
          Con cliente + proyecto se crea la tarea al guardar; sin proyecto queda en ámbar.
        </p>
        <Button size="sm" onClick={onCaptureAgreement} disabled={board.addAgreement.isPending}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Guardar acuerdo (Enter)
        </Button>
      </div>
    </div>
  ) : null;

  const renderAgreementExtra = (a: (typeof agreements)[number]) => {
    const ownerName = a.owner_user_id
      ? profiles.find((p) => p.user_id === a.owner_user_id)?.full_name
      : null;
    return (
      <>
        {ownerName && !a.owner_name && <span>{ownerName}</span>}
        {a.task_id ? (
          <Link
            to={`/tareas?task=${a.task_id}`}
            className="font-sans text-primary hover:underline"
          >
            Ver tarea
          </Link>
        ) : a.status === "confirmed" && !a.project_id ? (
          <span className="text-amber-700 dark:text-amber-400">sin proyecto</span>
        ) : (
          <span>sin tarea</span>
        )}
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
            <SelectTrigger className="h-7 w-auto min-w-[14rem] font-sans text-xs">
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
      </>
    );
  };

  const footer = projection ? null : (
    <>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-border/80 bg-card px-3.5 py-2.5">
          <h3 className="mb-1.5 text-[0.85em] font-semibold uppercase tracking-wide text-muted-foreground">
            Vencimientos (compliance)
          </h3>
          {board.data.deadlines.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin vencimientos próximos.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-auto text-xs">
              {board.data.deadlines.slice(0, 40).map((t) => (
                <li key={t.id}>
                  {t.title} {t.due_date ? `· ${t.due_date}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-md border border-border/80 bg-card px-3.5 py-2.5">
          <h3 className="mb-1.5 text-[0.85em] font-semibold uppercase tracking-wide text-muted-foreground">
            Tareas abiertas
          </h3>
          {board.data.plainTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin tareas abiertas.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-auto text-xs">
              {board.data.plainTasks.slice(0, 40).map((t) => (
                <li key={t.id}>
                  <Link to={`/tareas?task=${t.id}`} className="text-primary hover:underline">
                    {t.title}
                  </Link>
                  <span className="text-muted-foreground"> · {t.status}</span>
                </li>
              ))}
            </ul>
          )}
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
    </>
  );

  return (
    <AppLayout chrome={projection ? "none" : "default"}>
      <MtgPresentationTemplate
        title={series?.title ?? meeting.title ?? "Junta"}
        dateLabel={formatDateMX(meeting.scheduled_at)}
        topics={topicsFiltered}
        entities={entities}
        expectedNext={expectedNext}
        decisions={decisions}
        agreements={agreements}
        liveEditable={liveEditable}
        projection={projection}
        onPatchUpdate={schedulePatch}
        onToggleExpected={(id, done) =>
          board.toggleExpectedNext.mutate(
            { id, done },
            { onError: (e: Error) => toast.error(e.message) },
          )
        }
        onOpenHistory={(t) => setHistoryTopic(t)}
        headerLeading={
          projection ? null : (
            <Button asChild variant="ghost" size="icon" className="mt-0.5 h-8 w-8 shrink-0">
              <Link to="/juntas" aria-label="Volver a Juntas">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          )
        }
        meta={meta}
        toolbar={toolbar}
        filters={filters}
        capture={capture}
        agreementComposer={agreementComposer}
        renderAgreementExtra={renderAgreementExtra}
        onResolveDecision={(decisionId, resolution) => {
          if (!user) return;
          board.markDecision.mutate(
            { decisionId, resolution, organizationId: orgId, actorUserId: user.id },
            { onError: (e: Error) => toast.error(e.message) },
          );
        }}
        footer={footer}
      />

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
          currentEntityClientIds={entities.map((e) => e.client_id)}
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

      {user && series && (
        <MtgImportResumenDialog
          open={importResumenOpen}
          onOpenChange={setImportResumenOpen}
          organizationId={orgId}
          actorUserId={user.id}
          meetingId={meeting.id}
          seriesId={series.id}
          onDone={() => board.invalidate()}
        />
      )}
    </AppLayout>
  );
}
