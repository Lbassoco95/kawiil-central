/** Copy y glosario para la sección Conocimiento (lenguaje claro + equivalentes técnicos). */

export const METRIC_LABELS = {
  doc_count: {
    label: "Documentos enlazados",
    short: "docs",
    definition:
      "Archivos o registros asociados al cliente que el sistema ha tomado como fuente para generar fragmentos buscables.",
  },
  chunk_count: {
    label: "Fragmentos indexados",
    short: "fragmentos",
    definition:
      "Trozos de texto con significado propio que se guardan para búsqueda semántica (lo que en técnico suele llamarse «chunks»). Cuantos más haya, más material puede usar el asistente al responder sobre ese cliente.",
  },
} as const;

/** Barra de comparación entre clientes: no es calidad, solo volumen relativo. */
export const RELATIVE_VOLUME_BAR_LABEL = "Volumen relativo en la organización";
export const RELATIVE_VOLUME_BAR_HINT =
  "Compara este cliente con el que tiene más fragmentos en tu espacio. Un valor alto no implica que esté «completo»; solo indica más texto indexado.";

export type SourceTypeKey =
  | "document"
  | "extracted_data"
  | "chat_message"
  | "procedure"
  | "comunicado"
  | "memory"
  | "artifact";

const SOURCE_DEFAULT = {
  label: "Otro origen",
  definition: "Contenido indexado bajo un tipo de fuente no catalogado en la interfaz.",
};

export const SOURCE_TYPE_COPY: Record<
  string,
  { label: string; definition: string }
> = {
  document: {
    label: "Documentos",
    definition: "PDFs, Word u otros archivos subidos o enlazados que se dividieron en fragmentos para consulta.",
  },
  extracted_data: {
    label: "Datos extraídos",
    definition: "Campos estructurados (por ejemplo de formularios o integraciones) convertidos en texto buscable.",
  },
  chat_message: {
    label: "Conversaciones",
    definition: "Mensajes de chat internos que se indexaron para recuperar contexto posterior.",
  },
  procedure: {
    label: "Procedimientos",
    definition: "Pasos o guías del despacho que el sistema puede citar al orientar al equipo.",
  },
  comunicado: {
    label: "Comunicados",
    definition: "Avisos o circulares internas incorporadas al índice de conocimiento.",
  },
  memory: {
    label: "Memorias IA",
    definition: "Hechos o preferencias inferidos o confirmados por usuarios que la IA puede recordar en el futuro.",
  },
  artifact: {
    label: "Entregables IA",
    definition: "Salidas generadas por el asistente (borradores, resúmenes) guardadas como conocimiento reutilizable.",
  },
};

export function getSourceTypeCopy(sourceType: string | null | undefined) {
  if (!sourceType) return SOURCE_DEFAULT;
  return SOURCE_TYPE_COPY[sourceType] ?? { ...SOURCE_DEFAULT, label: sourceType };
}

export type InsightTypeKey =
  | "client_profile"
  | "project_profile"
  | "area_summary"
  | "pattern"
  | "recommendation";

const INSIGHT_DEFAULT = {
  label: "Resumen",
  whatItIs: "Síntesis generada automáticamente a partir de los fragmentos indexados.",
  howUsed: "Ayuda al equipo y al asistente a entender contexto sin leer todo el material crudo.",
};

export const INSIGHT_TYPE_COPY: Record<
  string,
  { label: string; whatItIs: string; howUsed: string }
> = {
  client_profile: {
    label: "Perfil del cliente",
    whatItIs:
      "Visión consolidada de quién es el cliente, qué trámites o áreas predominan y qué riesgos u oportunidades aparecen en la documentación.",
    howUsed:
      "Orienta respuestas del asistente y prioriza qué buscar cuando preguntas por ese cliente.",
  },
  project_profile: {
    label: "Perfil del proyecto",
    whatItIs: "Resumen del estado y temas recurrentes de un proyecto concreto según lo indexado.",
    howUsed: "Da contexto rápido al abrir conversaciones ligadas a ese proyecto.",
  },
  area_summary: {
    label: "Resumen por área",
    whatItIs: "Síntesis por línea de negocio (contabilidad, legal, etc.) a partir de los fragmentos de esa área.",
    howUsed: "Permite ver de un vistazo dónde hay más conocimiento acumulado por disciplina.",
  },
  pattern: {
    label: "Patrón detectado",
    whatItIs: "Regularidad o tendencia que el integrador encontró al cruzar varios fragmentos (no es una regla fija).",
    howUsed: "Sirve de señal para revisar procesos o documentación repetida.",
  },
  recommendation: {
    label: "Recomendación",
    whatItIs: "Sugerencia accionable basada en el análisis del material indexado.",
    howUsed: "Puede guiar mejoras de plantillas, carpetas o seguimiento con el cliente.",
  },
};

export function getInsightTypeCopy(insightType: string | null | undefined) {
  if (!insightType) return INSIGHT_DEFAULT;
  return INSIGHT_TYPE_COPY[insightType] ?? {
    label: insightType.replace(/_/g, " "),
    whatItIs: INSIGHT_DEFAULT.whatItIs,
    howUsed: INSIGHT_DEFAULT.howUsed,
  };
}

export const FEED_TYPE_LABELS: Record<string, string> = {
  new_document: "Nuevo documento indexado",
  insight: "Nuevo resumen de conocimiento",
  recommendation: "Recomendación",
  alert: "Alerta",
};

export function formatFeedType(feedType: string | null | undefined) {
  if (!feedType) return "Actividad";
  return FEED_TYPE_LABELS[feedType] ?? feedType.replace(/_/g, " ");
}

export const TOTAL_CHUNKS_KPI = {
  title: "Fragmentos en total",
  technical: "Suma de filas en document_chunks por organización.",
  definition:
    "Todos los fragmentos de texto con embedding que el sistema puede buscar por significado en tu espacio de trabajo.",
};

export function truncateChunkText(text: string, maxLen: number) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

export const KNOWLEDGE_TECH_MODE_STORAGE_KEY = "kawiil-knowledge-technical-mode";

export function readKnowledgeTechnicalMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KNOWLEDGE_TECH_MODE_STORAGE_KEY) === "1";
}

export function writeKnowledgeTechnicalMode(value: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KNOWLEDGE_TECH_MODE_STORAGE_KEY, value ? "1" : "0");
}
