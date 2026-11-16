// Memoria de los agentes (tabla agent_memories): lo que la pantalla puede ver y hacer, SIN mostrar nunca el texto de una memoria.
// Funciones puras: reciben filas ya leídas y devuelven solo campos permitidos. Las usa la función agente-memoria.
export const ORG_AGENTES = "00000000-0000-0000-0000-000000000001";
// Columnas que se leen. `content` y `source_description` NO están: el texto de una memoria puede traer datos de clientes y no sale de la base.
export const COLUMNAS_MEMORIA = "id, agent_id, memory_type, category, importance, enabled, access_count, last_accessed_at, expires_at, created_at";
export const MAX_MEMORIAS = 1000;

export const esUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export interface MemoriaPublica {
  id: string; agent_id: string; tipo: string; categoria: string | null; importancia: number; activa: boolean;
  usos: number; ultimo_uso: string | null; vence: string | null; creada: string;
}

const TIPOS = new Set(["decision", "fact", "pattern"]);
const texto = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const fecha = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
const entero = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1_000_000, Math.round(n))) : 0; };

/** Convierte una fila en lo que se puede mostrar. Descarta cualquier otro campo (por ejemplo `content`) aunque venga en la fila. */
export function memoriaPublica(r: Record<string, unknown>): MemoriaPublica | null {
  if (!esUuid(r.id) || !esUuid(r.agent_id)) return null;
  const tipo = typeof r.memory_type === "string" && TIPOS.has(r.memory_type) ? r.memory_type : "otro";
  const imp = Number(r.importance);
  return {
    id: r.id, agent_id: r.agent_id, tipo, categoria: texto(r.category, 40),
    importancia: Number.isFinite(imp) ? Math.max(0, Math.min(10, Math.round(imp))) : 0,
    activa: r.enabled === true, usos: entero(r.access_count), ultimo_uso: fecha(r.last_accessed_at), vence: fecha(r.expires_at), creada: fecha(r.created_at) ?? "",
  };
}

export const memoriasPublicas = (filas: unknown): MemoriaPublica[] =>
  (Array.isArray(filas) ? filas : []).flatMap((f) => { const m = f && typeof f === "object" ? memoriaPublica(f as Record<string, unknown>) : null; return m ? [m] : []; });

/** Valida el cambio pedido: solo se puede encender o apagar (nunca borrar ni editar). */
export function validarCambio(body: Record<string, unknown>): { ok: true; id: string; activa: boolean } | { ok: false; error: string } {
  if (!esUuid(body.id)) return { ok: false, error: "Memoria no válida." };
  if (typeof body.activa !== "boolean") return { ok: false, error: "Indica si la memoria queda activa o apagada." };
  return { ok: true, id: body.id, activa: body.activa };
}

export interface ResumenMemoria { total: number; activas: number; apagadas: number; vencidas: number }
export function resumirMemorias(ms: MemoriaPublica[], ahora: Date): ResumenMemoria {
  const r: ResumenMemoria = { total: ms.length, activas: 0, apagadas: 0, vencidas: 0 };
  for (const m of ms) {
    if (m.activa) r.activas++; else r.apagadas++;
    if (m.vence && Date.parse(m.vence) < ahora.getTime()) r.vencidas++;
  }
  return r;
}
