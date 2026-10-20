import { toDateStringMX } from "@/lib/dateUtils";

export const LAWSUIT_STATUS_OPTIONS = [
  { value: "en_tramite", label: "En trámite", className: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  { value: "en_apelacion", label: "En apelación", className: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  { value: "amparo", label: "Amparo", className: "bg-purple-500/10 text-purple-700 border-purple-500/30" },
  { value: "suspendido", label: "Suspendido", className: "bg-slate-500/10 text-slate-700 border-slate-500/30" },
  { value: "concluido", label: "Concluido", className: "bg-green-500/10 text-green-700 border-green-500/30" },
  { value: "archivado", label: "Archivado", className: "bg-muted text-muted-foreground border-border" },
];

/** Estatus exclusivos de trámites (quejas ante autoridades administrativas). */
export const PROCEDURE_STATUS_OPTIONS = [
  { value: "en_tramite", label: "En trámite", className: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  { value: "en_espera_respuesta", label: "En espera de respuesta", className: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  { value: "en_conciliacion", label: "En conciliación", className: "bg-purple-500/10 text-purple-700 border-purple-500/30" },
  { value: "convenio", label: "Convenio / acuerdo", className: "bg-teal-500/10 text-teal-700 border-teal-500/30" },
  { value: "suspendido", label: "Suspendido", className: "bg-slate-500/10 text-slate-700 border-slate-500/30" },
  { value: "concluido", label: "Concluido", className: "bg-green-500/10 text-green-700 border-green-500/30" },
  { value: "archivado", label: "Archivado", className: "bg-muted text-muted-foreground border-border" },
];

export const LAWSUIT_TYPE_OPTIONS = [
  { value: "laboral", label: "Laboral" },
  { value: "mercantil", label: "Mercantil" },
  { value: "civil", label: "Civil" },
  { value: "fiscal", label: "Fiscal" },
  { value: "penal", label: "Penal" },
  { value: "administrativo", label: "Administrativo" },
  { value: "familiar", label: "Familiar" },
  { value: "queja_profeco", label: "Queja Profeco" },
  { value: "queja_condusef", label: "Queja Condusef" },
  { value: "otro_tramite", label: "Otro trámite legal" },
];

/** Tipos que son trámites ante una autoridad administrativa (no un juicio tal cual). */
const PROCEDURE_TYPES = ["queja_profeco", "queja_condusef", "otro_tramite"];

export function isLegalProcedure(type: string | null | undefined): boolean {
  return !!type && PROCEDURE_TYPES.includes(type);
}

/** Estatus disponibles según sea juicio o trámite. */
export function statusOptionsForType(type: string | null | undefined) {
  return isLegalProcedure(type) ? PROCEDURE_STATUS_OPTIONS : LAWSUIT_STATUS_OPTIONS;
}

/** Datos de presentación de un estatus (busca en juicios y trámites; cae al primero del tipo). */
export function statusMeta(status: string, type: string | null | undefined) {
  const own = statusOptionsForType(type);
  return (
    own.find((s) => s.value === status) ??
    [...LAWSUIT_STATUS_OPTIONS, ...PROCEDURE_STATUS_OPTIONS].find((s) => s.value === status) ??
    own[0]
  );
}

/** Etiquetas de las partes según sea juicio o trámite (quejoso vs. proveedor/institución). */
export function partyLabels(type: string | null | undefined): { first: string; second: string } {
  return isLegalProcedure(type)
    ? { first: "Quejoso / promovente", second: "Proveedor / institución" }
    : { first: "Actor", second: "Demandado" };
}

export const CLOSED_LAWSUIT_STATUSES = ["concluido", "archivado"];

export interface LawsuitStage {
  key: string;
  label: string;
  completed: boolean;
  completed_at: string | null;
}

export const DEFAULT_LAWSUIT_STAGES: LawsuitStage[] = [
  { key: "demanda", label: "Demanda" },
  { key: "emplazamiento", label: "Emplazamiento" },
  { key: "contestacion", label: "Contestación de demanda" },
  { key: "pruebas", label: "Ofrecimiento y admisión de pruebas" },
  { key: "desahogo", label: "Desahogo de pruebas" },
  { key: "alegatos", label: "Alegatos" },
  { key: "sentencia", label: "Sentencia" },
  { key: "apelacion", label: "Apelación" },
  { key: "amparo", label: "Amparo" },
  { key: "ejecucion", label: "Ejecución de sentencia" },
].map((s) => ({ ...s, completed: false, completed_at: null }));

const PROFECO_STAGES = [
  ["queja", "Presentación de la queja"],
  ["admision", "Admisión y notificación al proveedor"],
  ["informe", "Informe / respuesta del proveedor"],
  ["conciliacion", "Audiencia de conciliación"],
  ["convenio", "Convenio o acuerdo"],
  ["arbitraje", "Arbitraje o procedimiento por infracciones a la ley"],
  ["resolucion", "Resolución"],
  ["cumplimiento", "Cumplimiento / seguimiento"],
];

const CONDUSEF_STAGES = [
  ["reclamacion", "Reclamación directa ante la UNE de la institución"],
  ["queja", "Presentación de la queja ante Condusef"],
  ["informe", "Informe de la institución financiera"],
  ["conciliacion", "Audiencia de conciliación"],
  ["convenio", "Convenio o acuerdo"],
  ["dictamen", "Dictamen / arbitraje"],
  ["cumplimiento", "Cumplimiento / seguimiento"],
];

const OTHER_PROCEDURE_STAGES = [
  ["solicitud", "Presentación de la solicitud o trámite"],
  ["requerimientos", "Requerimientos de la autoridad"],
  ["desahogo", "Desahogo de requerimientos"],
  ["resolucion", "Resolución"],
  ["seguimiento", "Cumplimiento / seguimiento"],
];

const PENAL_STAGES = [
  ["denuncia", "Denuncia o querella"],
  ["investigacion", "Investigación inicial ante el MP"],
  ["determinacion", "Determinación del MP (judicialización)"],
  ["audiencia_inicial", "Audiencia inicial y vinculación a proceso"],
  ["complementaria", "Investigación complementaria"],
  ["intermedia", "Etapa intermedia"],
  ["juicio_oral", "Juicio oral"],
  ["sentencia", "Sentencia"],
  ["impugnacion", "Apelación o amparo"],
];

function toStages(rows: string[][]): LawsuitStage[] {
  return rows.map(([key, label]) => ({ key, label, completed: false, completed_at: null }));
}

/** Etapas estándar según el tipo de juicio o trámite. */
export function defaultStagesForType(type: string | null | undefined): LawsuitStage[] {
  switch (type) {
    case "queja_profeco":
      return toStages(PROFECO_STAGES);
    case "queja_condusef":
      return toStages(CONDUSEF_STAGES);
    case "otro_tramite":
      return toStages(OTHER_PROCEDURE_STAGES);
    case "penal":
      return toStages(PENAL_STAGES);
    default:
      return DEFAULT_LAWSUIT_STAGES.map((s) => ({ ...s }));
  }
}

/** Normaliza el JSON `stages` de la BD a una lista tipada (descarta basura). */
export function parseLawsuitStages(raw: unknown): LawsuitStage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is Record<string, unknown> =>
        !!s && typeof s === "object" && typeof (s as Record<string, unknown>).label === "string",
    )
    .map((s, i) => ({
      key: typeof s.key === "string" && s.key ? s.key : `etapa-${i}`,
      label: s.label as string,
      completed: s.completed === true,
      completed_at: typeof s.completed_at === "string" ? s.completed_at : null,
    }));
}

/** Etapa en curso: la primera sin completar (null si todas están completas o no hay etapas). */
export function currentStageLabel(stages: LawsuitStage[]): string | null {
  return stages.find((s) => !s.completed)?.label ?? null;
}

export interface LawsuitDateSource {
  id: string;
  name: string;
  project_id: string;
  status: string;
  next_hearing_date: string | null;
  next_hearing_time?: string | null;
  next_deadline_date: string | null;
  next_deadline_note: string | null;
}

/** "10:30:00" → "10:30 h"; null si no hay hora. */
export function formatHearingTime(time: string | null | undefined): string | null {
  const m = time?.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]} h` : null;
}

export interface LawsuitDeadline {
  lawsuitId: string;
  projectId: string;
  lawsuitName: string;
  kind: "audiencia" | "plazo";
  label: string;
  date: string;
  /** Solo audiencias: "HH:MM h" si se capturó la hora. */
  time: string | null;
  overdue: boolean;
}

/**
 * Aplana audiencias y plazos de juicios abiertos en una lista ordenada por fecha
 * (vencidos primero, luego los más próximos). Ignora juicios concluidos/archivados.
 */
export function collectLawsuitDeadlines(lawsuits: LawsuitDateSource[], today = toDateStringMX()): LawsuitDeadline[] {
  const out: LawsuitDeadline[] = [];
  for (const l of lawsuits) {
    if (CLOSED_LAWSUIT_STATUSES.includes(l.status)) continue;
    const base = { lawsuitId: l.id, projectId: l.project_id, lawsuitName: l.name };
    if (l.next_hearing_date) {
      out.push({ ...base, kind: "audiencia", label: "Audiencia", date: l.next_hearing_date, time: formatHearingTime(l.next_hearing_time), overdue: l.next_hearing_date < today });
    }
    if (l.next_deadline_date) {
      out.push({
        ...base,
        kind: "plazo",
        label: l.next_deadline_note?.trim() || "Plazo",
        date: l.next_deadline_date,
        time: null,
        overdue: l.next_deadline_date < today,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
}

/**
 * Juicios en los que participa un usuario: es responsable del proyecto o forma
 * parte de su equipo (project_team).
 */
export function lawsuitsForUser<T extends { project_id: string; responsible_user_id: string | null }>(
  lawsuits: T[],
  userId: string,
  teamProjectIds: Iterable<string>,
): T[] {
  const team = new Set(teamProjectIds);
  return lawsuits.filter((l) => l.responsible_user_id === userId || team.has(l.project_id));
}

const CALENDAR_ID_PREFIX = "lw:";

/** Id sintético de un plazo/audiencia para el calendario: `lw:<proyecto>:<juicio>:<tipo>`. */
export function lawsuitCalendarId(d: Pick<LawsuitDeadline, "projectId" | "lawsuitId" | "kind">): string {
  return `${CALENDAR_ID_PREFIX}${d.projectId}:${d.lawsuitId}:${d.kind}`;
}

/** Ruta del juicio a partir del id sintético; null si el id no es de un plazo de juicio. */
export function lawsuitCalendarHref(id: string): string | null {
  if (!id.startsWith(CALENDAR_ID_PREFIX)) return null;
  const [projectId, lawsuitId] = id.slice(CALENDAR_ID_PREFIX.length).split(":");
  if (!projectId || !lawsuitId) return null;
  return `/proyectos/${encodeURIComponent(projectId)}?tab=juicios&lawsuitId=${encodeURIComponent(lawsuitId)}`;
}

/**
 * Plazos/audiencias con forma de tarea para pintarlos en el calendario junto a las tareas.
 * Solo los que caen en [start, end] (yyyy-MM-dd, ambos inclusive).
 */
export function lawsuitDeadlinesAsCalendarTasks(
  deadlines: LawsuitDeadline[],
  start: string,
  end: string,
  meta: Map<string, { projectName?: string | null; clientName?: string | null }> = new Map(),
) {
  return deadlines
    .filter((d) => d.date >= start && d.date <= end)
    .map((d) => {
      const m = meta.get(d.lawsuitId);
      return {
        id: lawsuitCalendarId(d),
        title: `⚖️ ${d.label}${d.time ? ` ${d.time}` : ""}: ${d.lawsuitName}`,
        due_date: d.date,
        status: "pendiente",
        priority: d.overdue ? "alta" : "media",
        area: "juicios",
        client_id: null,
        project_id: d.projectId,
        assigned_to: null,
        clients: m?.clientName ? { name: m.clientName } : null,
        projects: m?.projectName ? { name: m.projectName } : null,
      };
    });
}

export interface SuggestedStage {
  label: string;
  reason?: string;
}

const normLabel = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Combina las etapas sugeridas por IA con las actuales. Las completadas siempre se
 * conservan; las pendientes se reemplazan (replacePending) o se respetan y se
 * añaden solo las que no existan ya (comparación sin acentos ni mayúsculas).
 */
export function mergeSuggestedStages(
  current: LawsuitStage[],
  suggested: SuggestedStage[],
  replacePending: boolean,
  now = Date.now(),
): LawsuitStage[] {
  const kept = replacePending ? current.filter((s) => s.completed) : [...current];
  const seen = new Set(kept.map((s) => normLabel(s.label)));
  const added: LawsuitStage[] = [];
  suggested.forEach((s, i) => {
    const label = s.label.trim();
    const key = normLabel(label);
    if (!label || seen.has(key)) return;
    seen.add(key);
    added.push({ key: `ia-${now}-${i}`, label, completed: false, completed_at: null });
  });
  return [...kept, ...added];
}

/**
 * Fija en qué etapa va el asunto: las anteriores se marcan como completadas (con la fecha de hoy
 * si no la tenían), la elegida queda en curso y las posteriores se dejan como estaban.
 * Así la «etapa actual» (la primera sin completar) coincide con la que se eligió.
 */
export function setCurrentStage(stages: LawsuitStage[], key: string, today = toDateStringMX()): LawsuitStage[] {
  const idx = stages.findIndex((s) => s.key === key);
  if (idx === -1) return stages;
  return stages.map((s, i) => {
    if (i < idx) return s.completed ? s : { ...s, completed: true, completed_at: today };
    if (i === idx) return { ...s, completed: false, completed_at: null };
    return s;
  });
}
