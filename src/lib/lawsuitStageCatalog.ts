// Catálogo de litigio: materias, ramas/jurisdicciones, instancias y plantillas de
// etapas procesales por materia. Fuente única de verdad compartida por el formulario
// de creación (LawsuitFormDialog), el dashboard del expediente (LawsuitDashboard) y
// la agenda transversal de litigio.
//
// Diseño extensible: las ramas/jurisdicciones viven en un arreglo simple; agregar una
// nueva entidad federativa a futuro es una sola línea aquí (no requiere migración,
// porque en `projects.lawsuit_details` se guarda el `value` como texto libre).

export interface LawsuitStageSeed {
  key: string;
  label: string;
  status: string;
  date: string | null;
  notes: string;
  completed_at: string | null;
}

export interface CatalogOption {
  value: string;
  label: string;
}

/** Materias (tipo de juicio). */
export const LAWSUIT_TYPES: CatalogOption[] = [
  { value: "laboral", label: "Laboral" },
  { value: "mercantil", label: "Mercantil" },
  { value: "civil", label: "Civil" },
  { value: "fiscal", label: "Fiscal" },
  { value: "penal", label: "Penal" },
  { value: "administrativo", label: "Administrativo" },
  { value: "familiar", label: "Familiar" },
];

export const LAWSUIT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  LAWSUIT_TYPES.map((t) => [t.value, t.label]),
);

/**
 * Ramas / jurisdicciones. Hoy: CDMX, Estado de México y Federal/Amparo.
 * Para dar de alta otra entidad federativa a futuro, agrega aquí su { value, label }.
 */
export const LAWSUIT_JURISDICTIONS: CatalogOption[] = [
  { value: "cdmx", label: "Ciudad de México" },
  { value: "edomex", label: "Estado de México" },
  { value: "federal", label: "Federal / Amparo" },
];

export const LAWSUIT_JURISDICTION_LABELS: Record<string, string> = Object.fromEntries(
  LAWSUIT_JURISDICTIONS.map((j) => [j.value, j.label]),
);

export function getJurisdictionLabel(value?: string | null): string {
  if (!value) return "—";
  return LAWSUIT_JURISDICTION_LABELS[value] || value;
}

/** Instancias procesales. */
export const LAWSUIT_INSTANCIAS: CatalogOption[] = [
  { value: "primera", label: "Primera instancia" },
  { value: "segunda", label: "Segunda instancia / Apelación" },
  { value: "amparo", label: "Amparo" },
  { value: "ejecucion", label: "Ejecución" },
];

export const LAWSUIT_INSTANCIA_LABELS: Record<string, string> = Object.fromEntries(
  LAWSUIT_INSTANCIAS.map((i) => [i.value, i.label]),
);

export function getInstanciaLabel(value?: string | null): string {
  if (!value) return "—";
  return LAWSUIT_INSTANCIA_LABELS[value] || value;
}

const stage = (key: string, label: string): LawsuitStageSeed => ({
  key,
  label,
  status: "pendiente",
  date: null,
  notes: "",
  completed_at: null,
});

// Plantillas de etapas por materia (procedimiento mexicano). Se usan como punto de
// partida al crear el juicio; el usuario puede agregar/quitar/reordenar etapas después.
const STAGE_TEMPLATES_BY_MATERIA: Record<string, LawsuitStageSeed[]> = {
  laboral: [
    stage("conciliacion_prejudicial", "Conciliación prejudicial"),
    stage("demanda", "Demanda"),
    stage("admision", "Admisión y emplazamiento"),
    stage("contestacion", "Contestación de demanda"),
    stage("audiencia_preliminar", "Audiencia preliminar"),
    stage("audiencia_juicio", "Audiencia de juicio"),
    stage("alegatos", "Alegatos"),
    stage("sentencia", "Sentencia / Laudo"),
    stage("amparo", "Amparo directo"),
    stage("ejecucion", "Ejecución"),
  ],
  mercantil: [
    stage("demanda", "Demanda"),
    stage("admision", "Admisión y emplazamiento"),
    stage("contestacion", "Contestación de demanda"),
    stage("reconvencion", "Reconvención"),
    stage("pruebas", "Ofrecimiento y admisión de pruebas"),
    stage("desahogo", "Desahogo de pruebas"),
    stage("alegatos", "Alegatos"),
    stage("sentencia", "Sentencia"),
    stage("apelacion", "Apelación"),
    stage("amparo", "Amparo directo"),
    stage("ejecucion", "Ejecución de sentencia"),
  ],
  civil: [
    stage("demanda", "Demanda"),
    stage("admision", "Admisión y emplazamiento"),
    stage("contestacion", "Contestación de demanda"),
    stage("reconvencion", "Reconvención"),
    stage("audiencia_previa", "Audiencia previa y de conciliación"),
    stage("pruebas", "Ofrecimiento y admisión de pruebas"),
    stage("desahogo", "Desahogo de pruebas"),
    stage("alegatos", "Alegatos"),
    stage("sentencia", "Sentencia"),
    stage("apelacion", "Apelación"),
    stage("amparo", "Amparo directo"),
    stage("ejecucion", "Ejecución de sentencia"),
  ],
  familiar: [
    stage("demanda", "Demanda"),
    stage("admision", "Admisión y emplazamiento"),
    stage("contestacion", "Contestación de demanda"),
    stage("audiencia", "Audiencia"),
    stage("pruebas", "Ofrecimiento y desahogo de pruebas"),
    stage("alegatos", "Alegatos"),
    stage("sentencia", "Sentencia"),
    stage("apelacion", "Apelación"),
    stage("amparo", "Amparo directo"),
    stage("ejecucion", "Ejecución de sentencia"),
  ],
  penal: [
    stage("carpeta_investigacion", "Carpeta de investigación"),
    stage("audiencia_inicial", "Audiencia inicial"),
    stage("vinculacion", "Vinculación a proceso"),
    stage("medidas_cautelares", "Medidas cautelares"),
    stage("investigacion_complementaria", "Investigación complementaria"),
    stage("audiencia_intermedia", "Audiencia intermedia"),
    stage("juicio_oral", "Juicio oral"),
    stage("sentencia", "Sentencia"),
    stage("apelacion", "Apelación"),
    stage("amparo", "Amparo"),
  ],
  administrativo: [
    stage("recurso", "Recurso administrativo"),
    stage("demanda_nulidad", "Demanda de nulidad"),
    stage("contestacion_autoridad", "Contestación de la autoridad"),
    stage("pruebas", "Ofrecimiento y admisión de pruebas"),
    stage("alegatos", "Alegatos"),
    stage("sentencia", "Sentencia"),
    stage("revision", "Recurso de revisión"),
    stage("amparo", "Amparo"),
  ],
  fiscal: [
    stage("recurso_revocacion", "Recurso de revocación"),
    stage("juicio_nulidad", "Juicio contencioso administrativo (nulidad)"),
    stage("contestacion_autoridad", "Contestación de la autoridad"),
    stage("pruebas", "Ofrecimiento y admisión de pruebas"),
    stage("alegatos", "Alegatos"),
    stage("sentencia", "Sentencia"),
    stage("amparo", "Amparo"),
    stage("ejecucion", "Ejecución / devolución"),
  ],
};

// Plantilla genérica de respaldo (equivale a las etapas fijas previas).
const GENERIC_STAGES: LawsuitStageSeed[] = [
  stage("demanda", "Demanda"),
  stage("emplazamiento", "Emplazamiento"),
  stage("contestacion", "Contestación de demanda"),
  stage("pruebas", "Ofrecimiento y admisión de pruebas"),
  stage("desahogo", "Desahogo de pruebas"),
  stage("alegatos", "Alegatos"),
  stage("sentencia", "Sentencia"),
  stage("apelacion", "Apelación"),
  stage("amparo", "Amparo"),
  stage("ejecucion", "Ejecución de sentencia"),
];

/**
 * Etapas por defecto al crear un juicio, según materia (y opcionalmente rama).
 * `jurisdiction` se recibe para permitir ajustes por rama a futuro; hoy las
 * plantillas dependen de la materia y devuelven copias nuevas para no mutar el catálogo.
 */
export function getDefaultStages(
  materia?: string | null,
  _jurisdiction?: string | null,
): LawsuitStageSeed[] {
  const base = (materia && STAGE_TEMPLATES_BY_MATERIA[materia]) || GENERIC_STAGES;
  // Copia profunda ligera para evitar compartir referencias entre expedientes.
  return base.map((s) => ({ ...s }));
}
