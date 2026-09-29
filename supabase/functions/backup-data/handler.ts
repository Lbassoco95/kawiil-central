/**
 * backup-data — lógica sin red (se prueba con Deno y datos sintéticos).
 *
 * Solo responde a quien presente una credencial válida:
 *   · `x-backup-secret: <BACKUP_CRON_SECRET>` (tarea programada), comparado en
 *     tiempo constante; o
 *   · `Authorization: Bearer <JWT>` de un G4 (rol `transformador`) de la
 *     organización BACKUP_ORGANIZATION_ID.
 * Sin credencial, o con una inválida, responde 401/403 ANTES de leer cualquier
 * tabla del volcado. Si la variable que habilita una vía falta, esa vía queda
 * cerrada. `include_data` (datos en la respuesta) solo se atiende a un G4.
 */

export const TABLES_TO_BACKUP = [
  "organizations",
  "profiles",
  "user_roles",
  "celulas",
  "user_celulas",
  "clients",
  "client_compliance_config",
  "projects",
  "project_members",
  "project_comments",
  "tasks",
  "task_assignees",
  "task_comments",
  "documents",
  "document_types",
  "extracted_documents",
  "extraction_logs",
  "accounting_periods",
  "annual_declarations",
  "compliance_entity_types",
  "compliance_task_templates",
  "tax_obligation_types",
  "activity_log",
  "catalog_tags",
  "notifications",
  "reminders",
  "expenses",
  "chat_conversations",
  "chat_messages",
  "internal_procedures",
  "procedure_versions",
  "procedure_comments",
  "internal_comunicados",
  "mood_checkins",
  "personalized_phrases",
  "user_preferences",
  "savio_webhook_events",
];

/**
 * A3 · Tablas que NO se respaldan porque guardan credenciales, tokens o secretos.
 * Criterio: una tabla sale del respaldo si alguna columna guarda algo que sirve para
 * entrar a un sistema propio o de terceros (token de acceso o de refresco, llave,
 * contraseña, secreto o material cifrado de ellos). Son reemitibles: si se pierden,
 * se vuelve a conectar la cuenta; conservarlas en un respaldo solo agrega riesgo.
 * Revisadas columna por columna las 39 tablas del listado anterior (ver
 * docs/seguridad/backup-data.md): solo estas dos cumplen el criterio.
 */
export const EXCLUDED_TABLES: Record<string, string> = {
  microsoft_tokens: "access_token y refresh_token de Microsoft 365 de cada persona (reemitibles volviendo a conectar la cuenta).",
  integrations: "config guarda credenciales de integraciones (p. ej. refresh_token de Dropbox que leen process-document e index-dropbox).",
};

/** Nunca deben entrar al respaldo aunque alguien las agregue a la lista (certificados, secretos y sal). */
export const NEVER_BACKUP = [
  ...Object.keys(EXCLUDED_TABLES),
  "client_sat_certificates", "moffin_client_fiel", "moffin_client_sat_ciec",
  "portal_csd_secrets", "portal_csd_registry", "portal_pseudonym_salt", "user_slack_connections",
];

export const MIN_SECRET_LENGTH = 32;
export const PAGE_SIZE = 1000;

export type Via = "cron" | "g4";

export interface BackupDeps {
  /** BACKUP_CRON_SECRET. Sin ella (o con menos de 32 caracteres) la vía de cron queda cerrada. */
  cronSecret?: string | null;
  /** BACKUP_ORGANIZATION_ID. Sin ella la vía de G4 queda cerrada. */
  organizationId?: string | null;
  /** Valida el JWT con Auth y devuelve el usuario, o null si no es válido. */
  verifyJwt(token: string): Promise<{ id: string } | null>;
  /** Organización del perfil y si tiene el rol `transformador` (G4). */
  staffInfo(userId: string): Promise<{ organizationId: string | null; isG4: boolean }>;
  readTable(table: string, from: number, to: number): Promise<{ rows: unknown[]; error?: string }>;
  /** Sube el volcado al bucket privado `backups`; devuelve el error o null. */
  upload(path: string, json: string): Promise<string | null>;
  log(entry: BackupLogEntry): Promise<void>;
  now?: () => Date;
}

export interface BackupLogEntry {
  outcome: "aceptada" | "rechazada" | "error";
  reason: string;
  via: Via | null;
  user_id: string | null;
  ip: string | null;
  user_agent: string | null;
  include_data: boolean;
  tables: number | null;
  rows: number | null;
  file: string | null;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Igualdad de cadenas sin filtrar por tiempo: se comparan huellas SHA-256 de largo fijo, byte por byte, sin salir antes. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

type Auth = { ok: true; via: Via; userId: string | null } | { ok: false; status: 401 | 403; reason: string };

export async function authenticate(req: Request, deps: BackupDeps): Promise<Auth> {
  const secret = req.headers.get("x-backup-secret");
  if (secret !== null) {
    const configured = (deps.cronSecret ?? "").length >= MIN_SECRET_LENGTH;
    // Se compara aunque no esté configurado, para no distinguir por tiempo.
    const equal = await safeEqual(secret, configured ? deps.cronSecret! : "\u0000no-configurado");
    if (!configured) return { ok: false, status: 401, reason: "cron_no_configurado" };
    if (!equal) return { ok: false, status: 401, reason: "secreto_invalido" };
    return { ok: true, via: "cron", userId: null };
  }
  const authz = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(authz)?.[1]?.trim();
  if (!token) return { ok: false, status: 401, reason: "sin_credencial" };
  const user = await deps.verifyJwt(token).catch(() => null);
  if (!user) return { ok: false, status: 401, reason: "jwt_invalido" };
  if (!deps.organizationId) return { ok: false, status: 403, reason: "organizacion_no_configurada" };
  const info = await deps.staffInfo(user.id).catch(() => ({ organizationId: null, isG4: false }));
  if (!info.isG4) return { ok: false, status: 403, reason: "no_g4" };
  if (info.organizationId !== deps.organizationId) return { ok: false, status: 403, reason: "otra_organizacion" };
  return { ok: true, via: "g4", userId: user.id };
}

function callerMeta(req: Request) {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
    user_agent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
  };
}

async function dump(deps: BackupDeps, now: Date, filePath: string) {
  const backupData: Record<string, unknown[]> = {};
  const errors: string[] = [];
  for (const table of TABLES_TO_BACKUP) {
    if (NEVER_BACKUP.includes(table)) continue; // defensa en profundidad
    let all: unknown[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { rows, error } = await deps.readTable(table, from, from + PAGE_SIZE - 1);
      if (error) { errors.push(`${table}: ${error}`); break; }
      all = all.concat(rows);
      if (rows.length < PAGE_SIZE) break;
    }
    backupData[table] = all;
  }
  const backupJson = JSON.stringify(backupData, null, 2);
  const upErr = await deps.upload(filePath, backupJson);
  if (upErr) errors.push(`Storage upload: ${upErr}`);
  const tables = Object.fromEntries(Object.entries(backupData).map(([k, v]) => [k, v.length]));
  const summary: Record<string, unknown> = {
    timestamp: now.toISOString(),
    file: filePath,
    tables,
    errors: errors.length > 0 ? errors : undefined,
    size_bytes: new TextEncoder().encode(backupJson).length,
  };
  return { summary, backupData, tables };
}

export async function handleBackup(req: Request, deps: BackupDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const meta = callerMeta(req);
  const reject = async (status: number, reason: string, via: Via | null = null, userId: string | null = null) => {
    await deps.log({ outcome: "rechazada", reason, via, user_id: userId, ...meta, include_data: false, tables: null, rows: null, file: null })
      .catch(() => undefined);
    return json({ error: status === 405 ? "metodo_no_permitido" : "no_autorizado" }, status);
  };
  if (req.method !== "POST") return reject(405, "metodo");

  const auth = await authenticate(req, deps);
  if (!auth.ok) return reject(auth.status, auth.reason);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  // A2: los datos en la respuesta solo son para un G4 con su JWT. El cron recibe el resumen.
  const asked = body.include_data === true;
  const includeData = asked && auth.via === "g4";

  const now = (deps.now ?? (() => new Date()))();
  const filePath = `${now.toISOString().split("T")[0]}/backup-${now.toISOString().replace(/[:.]/g, "-")}.json`;
  let result: { summary: Record<string, unknown>; backupData: Record<string, unknown[]>; tables: Record<string, number> };
  try {
    result = await dump(deps, now, filePath);
  } catch (e) {
    // También un volcado fallido deja constancia (sin datos).
    await deps.log({ outcome: "error", reason: "volcado_fallido", via: auth.via, user_id: auth.userId, ...meta,
      include_data: includeData, tables: null, rows: null, file: filePath }).catch(() => undefined);
    throw e;
  }
  const { summary, backupData, tables } = result;
  if (asked && !includeData) summary.include_data = "ignorado: la tarea programada solo recibe el resumen";
  await deps.log({
    outcome: "aceptada", reason: asked && !includeData ? "ok_sin_datos_para_cron" : "ok", via: auth.via, user_id: auth.userId, ...meta, include_data: includeData,
    tables: Object.keys(tables).length, rows: Object.values(tables).reduce((a, b) => a + b, 0), file: filePath,
  }).catch(() => undefined);
  // Nunca se registra ni se imprime el contenido del volcado.
  console.log("Backup completed:", JSON.stringify({ file: filePath, via: auth.via, tablas: Object.keys(tables).length, errores: (summary.errors as string[] | undefined)?.length ?? 0 }));
  return includeData ? json({ summary, data: backupData }) : json(summary);
}
