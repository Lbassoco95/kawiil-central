// Catálogo de los agentes de Louis (OpenClaw): los que NO están en el registro de Kawiil Central porque los ejecuta Louis (Telegram y Slack) y no el servicio
// `kawiil-agents`. Son archivos .md en `spaces/general/agents/` de OpenClaw. Aquí solo se listan para verlos: no escriben nada ni reciben tareas desde Kawiil Central.
// Fuente: la lista de nombres y los roles que Dirección copió del servidor (17 nov 2026). Si cambia lo que hay en OpenClaw, se actualiza aquí.
//   Nivel 2 «Louis»:        22 `kawiil-*` (por área) + 4 `revisor-*` (revisan a Donna, el asistente).
//   Nivel 3 «Internacional»: 68 flujos de `claude-for-legal` (repositorio de Anthropic) en 8 áreas. Se quitaron 24 utilerías (ver UTILERIAS).
import { DEPARTAMENTOS } from "./departamentos";
import type { AgenteRegistro } from "./registro";
import type { FiguraOficina } from "./oficina";

export type NivelOficina = "kawiil" | "louis" | "internacional";
export const NIVELES_OFICINA: Array<{ v: NivelOficina; t: string; detalle: string }> = [
  { v: "kawiil", t: "Kawiil", detalle: "Los agentes del registro: los que hoy trabajan en Kawiil Central." },
  { v: "louis", t: "Louis", detalle: "Los agentes de OpenClaw (kawiil-*) y sus revisores. Los ejecuta Louis, no el registro." },
  { v: "internacional", t: "Internacional", detalle: "Los flujos de Claude for Legal (Anthropic), por área. Los ejecuta Louis." },
];
export const leerNivel = (v: string | null | undefined): NivelOficina => (v === "louis" || v === "internacional" ? v : "kawiil");

export interface AgenteCatalogo { id: string; clave: string; nombre: string; rol: string; depto: string; zona: string; origen: "kawiil-louis" | "revisor" | "claude-for-legal" }
export const ID_CATALOGO = "louis:";
export const esDelCatalogo = (id: string): boolean => id.startsWith(ID_CATALOGO);

// ── Nivel 2: kawiil-* y revisores ──────────────────────────────────────────────────────────────────────────────────────────────────────
const L = (clave: string, nombre: string, rol: string, depto: string, zona: string): AgenteCatalogo => ({ id: ID_CATALOGO + clave, clave, nombre, rol, depto, zona, origen: "kawiil-louis" });
const R = (clave: string, nombre: string, rol: string): AgenteCatalogo => ({ id: ID_CATALOGO + clave, clave, nombre, rol, depto: "l_revision", zona: "Revisión", origen: "revisor" });
export const AGENTES_LOUIS: AgenteCatalogo[] = [
  L("kawiil-calli", "Calli", "Inmobiliario, vivienda, INFONAVIT y desarrollo urbano.", "l_especialidades", "Especialidades"),
  L("kawiil-citlali", "Citlali", "Fintech, tecnología y regulación digital (CNBV).", "l_especialidades", "Especialidades"),
  L("kawiil-ehecatl", "Ehécatl", "Laboral: STPS, IMSS y LFT.", "l_especialidades", "Especialidades"),
  L("kawiil-metzli", "Metzli", "Fiscal: SAT, CFF, ISR e IVA.", "l_especialidades", "Especialidades"),
  L("kawiil-patli", "Patli", "Salud y farmacéutico: COFEPRIS y dispositivos médicos.", "l_especialidades", "Especialidades"),
  L("kawiil-tlali", "Tlali", "Ambiental y energía: SEMARNAT y NOM.", "l_especialidades", "Especialidades"),
  L("kawiil-tonati", "Tonati", "Corporativo y M&A: LGSM y gobierno corporativo.", "l_especialidades", "Especialidades"),
  L("kawiil-yoliztli", "Yoliztli", "Propiedad intelectual: IMPI, marcas y patentes.", "l_especialidades", "Especialidades"),
  // Comparten nombre con agentes del registro, pero son otros agentes con otro rol: por eso llevan «(Louis)».
  L("kawiil-amatl", "Amatl (Louis)", "Gestión documental: contratos, cartas, redlines, comparativos de versiones y cláusulas riesgosas.", "l_documentos", "Documentos y seguridad"),
  L("kawiil-nelli", "Nelli (Louis)", "Cumplimiento normativo: obligaciones legales de Kawiil, Yoltik y sus clientes.", "l_documentos", "Cumplimiento"),
  L("kawiil-tepantli", "Tepantli (Louis)", "Seguridad de la información y protección de datos; respuesta a incidentes.", "l_documentos", "Documentos y seguridad"),
  L("kawiil-vizum", "Vizum", "Cliente Vizum (regulado por la CNBV): deadlines, comunicaciones y seguimiento de amparos.", "l_clientes", "Clientes"),
  L("kawiil-dazon", "Dazon", "Cliente Dazon: gestión documental notarial, cartas a la Correduría, mermas y firmas.", "l_clientes", "Clientes"),
  L("kawiil-comercial", "Comercial", "Pipeline comercial: seguimientos, propuestas y contexto antes de reuniones.", "l_negocio", "Negocio"),
  L("kawiil-marketing", "Marketing", "Marketing digital: contenido según el brandbook de Yoltik, campañas y competidores.", "l_negocio", "Negocio"),
  L("kawiil-yoltik", "Yoltik", "Operación de los productos de Yoltik, como Ikán (cumplimiento PLD) y Nexo (asistente ejecutivo).", "l_negocio", "Negocio"),
  L("kawiil-rrhh", "RRHH", "Talento: reclutamiento, onboarding y evaluación a 3 meses.", "l_negocio", "Equipo y cultura"),
  L("kawiil-cultura", "Cultura", "Estrategia de cultura organizacional: valores, ritos y propuesta de valor para empleados.", "l_negocio", "Equipo y cultura"),
  L("kawiil-matiox", "Matiox", "Cultura interna del día a día: pulso del equipo, comunicados y reconocimientos.", "l_negocio", "Equipo y cultura"),
  L("kawiil-erp", "ERP", "Operador del ERP Kawiil Central: ejecuta acciones en el sistema cuando el equipo lo dicta.", "l_operacion", "Operación"),
  L("kawiil-investigacion", "Investigación", "Investigación profunda con SJF, DOF, web y los expertos legales internacionales.", "l_operacion", "Operación"),
  L("kawiil-general", "General", "Agente de respaldo: enruta la consulta al agente correcto o resuelve lo de uso general.", "l_operacion", "Operación"),
  R("revisor-aprendizaje", "Revisor de aprendizaje", "Revisa lo que Donna ha aprendido sobre Polo y el sistema en los últimos días."),
  R("revisor-evolucion", "Revisor de evolución", "Revisa qué ha evolucionado en el sistema: funciones nuevas y pendientes de planes anteriores."),
  R("revisor-ia", "Revisor de IA", "Evalúa la calidad de la IA de Donna: concisión y enrutamiento a herramientas."),
  R("revisor-sistema", "Revisor de sistema", "Diagnóstico operativo del asistente cada 2 días: qué funciona, qué falló y qué necesita atención."),
];

// ── Nivel 3: Claude for Legal ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const AREAS_INTERNACIONALES: Array<{ prefijo: string; depto: string; nombre: string }> = [
  { prefijo: "employment", depto: "i_laboral", nombre: "Laboral" }, { prefijo: "corporate", depto: "i_corporativo", nombre: "Corporativo" },
  { prefijo: "commercial", depto: "i_comercial", nombre: "Comercial" }, { prefijo: "ip", depto: "i_pi", nombre: "Propiedad intelectual" },
  { prefijo: "ai-governance", depto: "i_ia", nombre: "Gobernanza de IA" }, { prefijo: "privacy", depto: "i_privacidad", nombre: "Privacidad" },
  { prefijo: "regulatory", depto: "i_regulatorio", nombre: "Regulatorio" }, { prefijo: "product", depto: "i_producto", nombre: "Producto" },
];
/** Utilerías de configuración que se quitan de los personajes: el Constructor, los documentos del agente y los proyectos ya las cubren. 3 por cada una de las 8 áreas. */
export const UTILERIAS = ["cold-start-interview", "customize", "matter-workspace"] as const;

// área → [slug sin prefijo, nombre en español]
const FLUJOS: Record<string, Array<[string, string]>> = {
  "ai-governance": [["aia-generation", "Evaluación de impacto de IA"], ["ai-inventory", "Inventario de IA"], ["policy-monitor", "Monitor de políticas de IA"], ["policy-starter", "Política de IA inicial"],
    ["reg-gap-analysis", "Brechas regulatorias de IA"], ["use-case-triage", "Triaje de casos de uso de IA"], ["vendor-ai-review", "Revisión de IA de proveedores"]],
  commercial: [["amendment-history", "Historial de enmiendas"], ["escalation-flagger", "Alerta de escalamiento"], ["nda-review", "Revisión de NDA"], ["renewal-tracker", "Seguimiento de renovaciones"],
    ["review", "Revisión de contratos"], ["review-proposals", "Revisión de propuestas"], ["saas-msa-review", "Revisión de SaaS y MSA"], ["stakeholder-summary", "Resumen para partes interesadas"],
    ["vendor-agreement-review", "Revisión de contratos con proveedores"]],
  corporate: [["ai-tool-handoff", "Traspaso a herramienta de IA"], ["board-minutes", "Actas de consejo"], ["closing-checklist", "Lista de cierre"], ["deal-team-summary", "Resumen para el equipo del deal"],
    ["diligence-issue-extraction", "Hallazgos de diligencia"], ["entity-compliance", "Cumplimiento de entidades"], ["integration-management", "Gestión de integración"],
    ["material-contract-schedule", "Calendario de contratos relevantes"], ["tabular-review", "Revisión tabular"], ["written-consent", "Consentimiento por escrito"]],
  employment: [["expansion-kickoff", "Arranque de expansión"], ["expansion-update", "Actualización de expansión"], ["handbook-updates", "Actualización de manuales"], ["hiring-review", "Revisión de contratación"],
    ["internal-investigation", "Investigación interna"], ["international-expansion", "Expansión internacional"], ["investigation-add", "Agregar a una investigación"], ["investigation-memo", "Memo de investigación"],
    ["investigation-open", "Abrir investigación"], ["investigation-query", "Consulta de investigación"], ["investigation-summary", "Resumen de investigación"], ["leave-tracker", "Seguimiento de licencias"],
    ["log-leave", "Registro de licencias"], ["policy-drafting", "Redacción de políticas"], ["termination-review", "Revisión de terminaciones"], ["wage-hour-qa", "Consultas de salario y jornada"],
    ["worker-classification", "Clasificación de trabajadores"]],
  ip: [["cease-desist", "Cartas de cese y desista"], ["clearance", "Libertad de uso (clearance)"], ["fto-triage", "Triaje de libertad para operar"], ["infringement-triage", "Triaje de infracciones"],
    ["invention-intake", "Recepción de invenciones"], ["ip-clause-review", "Revisión de cláusulas de PI"], ["oss-review", "Revisión de código abierto"], ["portfolio", "Portafolio de PI"], ["takedown", "Retiro de contenido"]],
  privacy: [["dpa-review", "Revisión de DPA"], ["dsar-response", "Respuesta a solicitudes de titulares"], ["pia-generation", "Evaluación de impacto de privacidad"], ["policy-monitor", "Monitor de políticas de privacidad"],
    ["reg-gap-analysis", "Brechas regulatorias de privacidad"], ["use-case-triage", "Triaje de casos de uso de privacidad"]],
  product: [["feature-risk-assessment", "Riesgo de funcionalidades"], ["is-this-a-problem", "¿Esto es un problema?"], ["launch-review", "Revisión de lanzamiento"], ["marketing-claims-review", "Revisión de afirmaciones de marketing"]],
  regulatory: [["comments", "Comentarios a propuestas regulatorias"], ["gaps", "Brechas abiertas"], ["gap-surfacer", "Detector de brechas"], ["policy-diff", "Comparación de política contra cambio"],
    ["policy-redraft", "Redacción de política corregida"], ["reg-feed-watcher", "Vigilante de fuentes regulatorias"]],
};

/** Zona de trabajo de un flujo, por lo que hace (para ver cómo trabaja y dónde se revisa): se deduce del nombre del archivo. */
export function zonaDeFlujo(slug: string): string {
  if (/investigation/.test(slug)) return "Investigaciones";
  if (/(monitor|watcher|tracker|surfacer|escalation|log-leave)|^gaps$/.test(slug)) return "Vigilancia";
  if (/triage/.test(slug)) return "Triaje";
  if (/review/.test(slug)) return "Revisión";
  if (/(generation|drafting|redraft|starter|memo|summary|minutes|consent|cease-desist|handbook|checklist|schedule|response|handoff|diff|history|comments)/.test(slug)) return "Redacción";
  return "Análisis";
}

export const AGENTES_INTERNACIONALES: AgenteCatalogo[] = AREAS_INTERNACIONALES.flatMap((a) =>
  (FLUJOS[a.prefijo] ?? []).map(([slug, nombre]) => ({
    id: `${ID_CATALOGO}legal-${a.prefijo}-${slug}`, clave: `legal-${a.prefijo}-${slug}`, nombre, rol: `${a.nombre}: ${nombre} (flujo de Claude for Legal).`, depto: a.depto, zona: zonaDeFlujo(slug), origen: "claude-for-legal" as const,
  })));

export const catalogoDeNivel = (n: NivelOficina): AgenteCatalogo[] => (n === "louis" ? AGENTES_LOUIS : n === "internacional" ? AGENTES_INTERNACIONALES : []);

// ── Adaptadores: el catálogo se dibuja con los mismos componentes que el registro ─────────────────────────────────────────────────────────────────────
export const comoAgenteRegistro = (c: AgenteCatalogo): AgenteRegistro => ({
  id: c.id, name: c.clave, display_name: c.nombre, description: c.rol, role: null, status: "idle", kind: "louis", last_heartbeat: null, last_task_at: null,
  tasks_completed: 0, tasks_failed: 0, config: { departamento: c.depto, origen: c.origen },
});
/** Sin señal: Louis aún no le avisa nada a Kawiil Central. */
export const comoFigura = (c: AgenteCatalogo): FiguraOficina => ({
  id: c.id, clave: c.clave, nombre: c.nombre, estado: "apagado", ultimoLatido: null, ultimaTareaAt: null, tareasBien: 0, tareasMal: 0, descripcion: c.rol, rol: c.zona,
});
export const zonaPorId = (lista: AgenteCatalogo[]): Map<string, string> => new Map(lista.map((c) => [c.id, c.zona]));
export const nombreDepto = (clave: string): string => DEPARTAMENTOS[clave]?.nombre ?? clave;
