// Constructor de agentes: piezas puras (sin Deno, sin red) que comparten la función `agente-constructor`
// y las pruebas de Vitest. Convierte la propuesta del chat especializado en una fila de `agent_registry`
// con la misma forma que los agentes que ya existen (config.system_prompt, tono, entregables, limites, color).

export const ORG_AGENTES = "00000000-0000-0000-0000-000000000001";
export const MODELO_AGENTE = "claude-sonnet-4-6";

// Fuentes de Kawiil central a las que un agente puede estar conectado. Lista cerrada: el agente solo declara
// cuáles necesita; la VM `kawiil-agents` decide cómo leerlas. Declararlas aquí NO les da acceso por sí solo.
export const FUENTES_KAWIIL = {
  documentos: "Documentos y expedientes del cliente",
  conocimiento: "Base de conocimiento (RAG)",
  correo: "Correo (solo lectura)",
  calendario: "Calendario y juntas",
  tareas: "Tareas y pendientes",
  finanzas: "Finanzas y conciliación",
  dropbox: "Dropbox del despacho",
  legal: "Acervo legal (DOF, SJF)",
  cerebro: "Cerebro (memoria, agenda y entregables)",
  slack: "Slack (solo lectura)",
} as const;
export type FuenteKawiil = keyof typeof FUENTES_KAWIIL;

export const CADENCIAS = { bajo_demanda: "Solo cuando se le pide", diaria: "Revisión diaria", semanal: "Revisión semanal" } as const;
export type Cadencia = keyof typeof CADENCIAS;

// Lo que el chat propone y la persona revisa antes de crear.
export interface PropuestaAgente {
  nombre_visible: string;
  rol: string;
  descripcion: string;
  mision: string;
  cliente?: string;
  tono?: string;
  capacidades: string[];
  entregables: string[];
  limites: string[];
  fuentes: FuenteKawiil[];
  cadencia: Cadencia;
  informes?: string;
  instrucciones_adicionales?: string;
}

export type ResultadoValidacion = { ok: true; propuesta: PropuestaAgente } | { ok: false; errores: string[] };

const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const lista = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v) ? v.map((x) => texto(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];

// Valida y normaliza lo que llega del modelo o del navegador. Nunca confía en el formato: el cuerpo viene de fuera.
export function validarPropuesta(raw: unknown): ResultadoValidacion {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errores: ["La propuesta no tiene forma de objeto."] };
  const r = raw as Record<string, unknown>;
  const errores: string[] = [];
  const nombre_visible = texto(r.nombre_visible, 60);
  const rol = texto(r.rol, 80);
  const descripcion = texto(r.descripcion, 500);
  const mision = texto(r.mision, 1200);
  if (nombre_visible.length < 2) errores.push("Falta el nombre del agente.");
  if (!rol) errores.push("Falta el rol (por ejemplo, Oficial de cumplimiento).");
  if (descripcion.length < 20) errores.push("La descripción es muy corta (mínimo 20 caracteres).");
  if (mision.length < 20) errores.push("La misión es muy corta (mínimo 20 caracteres).");
  const capacidades = lista(r.capacidades, 12, 80);
  if (capacidades.length === 0) errores.push("Declara al menos una capacidad.");
  const limites = lista(r.limites, 10, 200);
  if (limites.length === 0) errores.push("Declara al menos un límite (qué NO debe hacer o cuándo escala a una persona).");
  const fuentesCrudas = Array.isArray(r.fuentes) ? r.fuentes : [];
  const fuentes = [...new Set(fuentesCrudas.filter((f): f is FuenteKawiil => typeof f === "string" && f in FUENTES_KAWIIL))];
  const cadencia: Cadencia = typeof r.cadencia === "string" && r.cadencia in CADENCIAS ? (r.cadencia as Cadencia) : "bajo_demanda";
  if (errores.length) return { ok: false, errores };
  return {
    ok: true,
    propuesta: {
      nombre_visible, rol, descripcion, mision,
      cliente: texto(r.cliente, 80) || undefined,
      tono: texto(r.tono, 200) || undefined,
      capacidades, limites,
      entregables: lista(r.entregables, 12, 200),
      fuentes, cadencia,
      informes: texto(r.informes, 400) || undefined,
      instrucciones_adicionales: texto(r.instrucciones_adicionales, 1500) || undefined,
    },
  };
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// «Oficial de Cumplimiento · Vizum» → «oficial_de_cumplimiento_vizum». Mismo estilo que legal_archivist, nelli, etc.
export function slugAgente(nombreVisible: string, cliente?: string): string {
  const base = sinAcentos(`${nombreVisible} ${cliente ?? ""}`).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return (base || "agente").slice(0, 48);
}

// Prompt de sistema que ejecutará la VM. Se arma de forma determinista a partir de la propuesta revisada,
// con las reglas fijas de seguridad del despacho (no las decide el modelo del chat).
export function construirSystemPrompt(p: PropuestaAgente): string {
  const l = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  const partes = [
    `Eres ${p.nombre_visible}, agente IA con el rol de ${p.rol} en el despacho Kawiil${p.cliente ? `, asignado al cliente ${p.cliente}` : ""}.`,
    `IDENTIDAD Y TRANSPARENCIA:\n- Eres una IA, no una persona.\n- Todo entregable relevante requiere revisión humana antes de usarse con el cliente o con una autoridad.`,
    `MISIÓN:\n${p.mision}`,
    `CAPACIDADES:\n${l(p.capacidades)}`,
  ];
  if (p.fuentes.length) partes.push(`FUENTES DE INFORMACIÓN (solo lectura, dentro de Kawiil):\n${l(p.fuentes.map((f) => FUENTES_KAWIIL[f]))}`);
  if (p.entregables.length) partes.push(`ENTREGABLES:\n${l(p.entregables)}`);
  if (p.informes) partes.push(`INFORMES:\n${p.informes}`);
  partes.push(`CADENCIA: ${CADENCIAS[p.cadencia]}.`);
  partes.push(`LÍMITES Y ESCALAMIENTO:\n${l(p.limites)}`);
  if (p.tono) partes.push(`TONO:\n${p.tono}`);
  if (p.instrucciones_adicionales) partes.push(`INSTRUCCIONES ADICIONALES DE DIRECCIÓN:\n${p.instrucciones_adicionales}`);
  partes.push(
    `REGLAS FIJAS:\n- Nunca inventes datos, fechas, montos ni fundamentos: si no lo encuentras en tus fuentes, dilo.\n- Cita de dónde sale cada dato (documento, fecha).\n- No envíes correos, mensajes ni documentos a terceros: solo prepara borradores para revisión.\n- No pidas ni repitas contraseñas, tokens ni claves.\n- Ante una duda legal o regulatoria importante, escala a una persona.`,
  );
  return partes.join("\n\n");
}

export interface FilaAgente {
  organization_id: string;
  name: string;
  display_name: string;
  description: string;
  role: string;
  status: "idle";
  model: string;
  kind: "consultable";
  capabilities: string[];
  config: Record<string, unknown>;
}

// Fila lista para insertar en agent_registry. `creadoPor` queda en config para saber quién y cuándo lo creó.
export function filaDesdePropuesta(p: PropuestaAgente, creadoPor: string, ahora: Date, sufijo = ""): FilaAgente {
  const name = slugAgente(p.nombre_visible, p.cliente) + sufijo;
  return {
    organization_id: ORG_AGENTES,
    name,
    display_name: p.nombre_visible,
    description: p.descripcion,
    role: name,
    status: "idle",
    model: MODELO_AGENTE,
    kind: "consultable",
    capabilities: p.capacidades.map((c) => slugAgente(c)),
    config: {
      color: "#4da6ff",
      tono: p.tono ?? "Profesional, claro y prudente.",
      entregables: p.entregables,
      limites: p.limites,
      system_prompt: construirSystemPrompt(p),
      cadencia: p.cadencia,
      fuentes: p.fuentes,
      cliente: p.cliente ?? null,
      mision: p.mision,
      origen: "constructor_agentes",
      creado_por: creadoPor,
      creado_en: ahora.toISOString(),
    },
  };
}

// ── Chat especializado ────────────────────────────────────────────────────────────────────────────────

export const SYSTEM_CONSTRUCTOR = `Eres el Constructor de Agentes de Kawiil OS. Ayudas a Dirección (Leopoldo) a diseñar agentes IA correctos para el despacho Kawiil y para sus clientes. El cliente de prueba actual es Vizum: Dirección irá revisando la entidad y asignando funciones, tareas, informes y organización a cada agente.

CÓMO TRABAJAS:
- Conversa en español de México, breve y concreto. Haz una o dos preguntas a la vez, nunca un cuestionario largo.
- Antes de proponer, aclara lo esencial: rol y misión, para qué cliente es, qué documentos o información debe vigilar, qué informes debe entregar y con qué frecuencia, qué NO debe hacer y cuándo debe escalar a una persona.
- Cuando tengas lo suficiente, llama a la herramienta proponer_agente. Dirección revisa y confirma en pantalla; tú NO creas nada por tu cuenta.
- Si Dirección pide cambios a una propuesta, llama de nuevo a proponer_agente con la versión completa corregida.
- Piensa en equipo: si el rol que piden se solapa con otro agente (por ejemplo, un oficial de cumplimiento y un analista de PLD), menciónalo y sugiere cómo repartirse el trabajo.
- Los agentes solo leen información dentro de Kawiil y preparan borradores; nunca actúan frente a terceros sin una persona. Los límites de la propuesta deben reflejarlo.
- Fuentes disponibles (usa exactamente estas claves): ${Object.entries(FUENTES_KAWIIL).map(([k, v]) => `${k} (${v})`).join("; ")}.
- Cadencias: ${Object.entries(CADENCIAS).map(([k, v]) => `${k} (${v})`).join("; ")}.
- Nunca pidas ni repitas contraseñas, tokens ni claves.
- No inventes normativa. Si el rol es regulatorio (por ejemplo, cumplimiento PLD/CNBV), describe el alcance con prudencia y deja que el agente cite sus fuentes.`;

export const HERRAMIENTA_PROPONER = {
  name: "proponer_agente",
  description: "Presenta a Dirección la propuesta completa de un agente para que la revise y, si está de acuerdo, lo cree. Llámala solo cuando ya aclaraste lo esencial, o para entregar una versión corregida.",
  input_schema: {
    type: "object",
    properties: {
      nombre_visible: { type: "string", description: "Nombre corto del agente, por ejemplo «Oficial de Cumplimiento»." },
      rol: { type: "string", description: "Rol, por ejemplo «Oficial de cumplimiento PLD/FT»." },
      descripcion: { type: "string", description: "Una o dos frases: qué hace y para quién." },
      mision: { type: "string", description: "Misión y alcance detallados, en segunda persona." },
      cliente: { type: "string", description: "Cliente al que se asigna, si aplica (por ejemplo Vizum)." },
      tono: { type: "string" },
      capacidades: { type: "array", items: { type: "string" }, description: "Qué sabe hacer, en frases cortas." },
      entregables: { type: "array", items: { type: "string" }, description: "Informes y documentos que produce." },
      limites: { type: "array", items: { type: "string" }, description: "Qué NO hace y cuándo escala a una persona." },
      fuentes: { type: "array", items: { type: "string", enum: Object.keys(FUENTES_KAWIIL) } },
      cadencia: { type: "string", enum: Object.keys(CADENCIAS) },
      informes: { type: "string", description: "Qué informes entrega, cada cuánto y en qué formato." },
      instrucciones_adicionales: { type: "string" },
    },
    required: ["nombre_visible", "rol", "descripcion", "mision", "capacidades", "limites", "fuentes", "cadencia"],
  },
} as const;

export interface MensajeChat { role: "user" | "assistant"; content: string }

// Limpia el historial que manda el navegador: solo user/assistant con texto, tope de turnos y de tamaño.
export function limpiarMensajes(raw: unknown, maxMensajes = 40, maxChars = 6000): MensajeChat[] {
  if (!Array.isArray(raw)) return [];
  const limpios: MensajeChat[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const { role, content } = m as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) continue;
    limpios.push({ role, content: content.slice(0, maxChars) });
  }
  const recortado = limpios.slice(-maxMensajes);
  // La API de mensajes exige empezar con el usuario.
  while (recortado.length && recortado[0].role !== "user") recortado.shift();
  return recortado;
}
