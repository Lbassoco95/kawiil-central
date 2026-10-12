/**
 * Hallazgos derivados del estado de seguridad: lista corta y ordenada por gravedad que el panel
 * de MATI Admin puede mostrar tal cual. Es una función pura (se prueba sin base de datos).
 */
export type Severity = "high" | "medium" | "low" | "info";
export type Finding = { id: string; severity: Severity; title: string; count?: number; items?: string[] };

export type SecretStatus = { name: string; required: boolean; set: boolean; length_ok: boolean; purpose: string };
export type UsersSummary = { total: number; by_role: Record<string, number>; admins_without_mfa: number; banned: number; never_signed_in: number; inactive_90d: number };

type Posture = {
  tables?: { without_rls?: string[]; rls_without_policies?: string[] };
  policies?: { open_to_public?: Array<{ table: string; policy: string; cmd: string }> };
  anon?: { tables_with_write_grants?: number };
  functions?: { executable_by_anon?: string[]; without_fixed_search_path?: number };
  extensions_in_public?: string[];
  storage?: { public_buckets?: string[] };
};

const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

export function deriveFindings(p: Posture, secrets: SecretStatus[], users: UsersSummary): Finding[] {
  const out: Finding[] = [];
  const noRls = arr(p.tables?.without_rls);
  if (noRls.length) out.push({ id: "tables_without_rls", severity: "high", title: "Tablas sin RLS en public", count: noRls.length, items: noRls });

  const writes = p.anon?.tables_with_write_grants ?? 0;
  if (writes > 0) out.push({ id: "anon_write_grants", severity: "high", title: "Tablas donde anon tiene privilegios de escritura", count: writes });

  const open = arr(p.policies?.open_to_public);
  if (open.length) {
    out.push({ id: "open_policies", severity: "medium", title: "Políticas abiertas a anon/public (condición siempre verdadera)", count: open.length, items: open.map((x) => `${x.table}.${x.policy} [${x.cmd}]`) });
  }
  const anonFns = arr(p.functions?.executable_by_anon);
  if (anonFns.length) out.push({ id: "definer_functions_anon", severity: "medium", title: "Funciones SECURITY DEFINER que anon puede ejecutar", count: anonFns.length, items: anonFns });
  const mutable = p.functions?.without_fixed_search_path ?? 0;
  if (mutable > 0) out.push({ id: "definer_without_search_path", severity: "medium", title: "Funciones SECURITY DEFINER sin search_path fijo", count: mutable });

  const noPolicies = arr(p.tables?.rls_without_policies);
  if (noPolicies.length) out.push({ id: "rls_without_policies", severity: "low", title: "Tablas con RLS pero sin políticas (nadie las lee salvo el servicio)", count: noPolicies.length, items: noPolicies });
  const exts = arr(p.extensions_in_public);
  if (exts.length) out.push({ id: "extensions_in_public", severity: "low", title: "Extensiones instaladas en public", count: exts.length, items: exts });
  const buckets = arr(p.storage?.public_buckets);
  if (buckets.length) out.push({ id: "public_buckets", severity: "medium", title: "Buckets de Storage públicos", count: buckets.length, items: buckets });

  for (const s of secrets) {
    if (s.required && !s.set) out.push({ id: `secret_missing_${s.name}`, severity: "high", title: `Falta el secreto obligatorio ${s.name}`, items: [s.purpose] });
    else if (s.set && !s.length_ok) out.push({ id: `secret_short_${s.name}`, severity: "medium", title: `El secreto ${s.name} es demasiado corto`, items: [s.purpose] });
  }

  if (users.admins_without_mfa > 0) out.push({ id: "admins_without_mfa", severity: "medium", title: "Administradores sin verificación en dos pasos (MFA)", count: users.admins_without_mfa });
  if (users.inactive_90d > 0) out.push({ id: "inactive_users", severity: "low", title: "Usuarios sin acceder en más de 90 días", count: users.inactive_90d });

  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.id.localeCompare(b.id));
}

/** Resumen de usuarios a partir de la lista que devuelve `security_users_snapshot`. */
export function summarizeUsers(list: unknown, nowMs = Date.now()): UsersSummary {
  const users = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
  const by_role: Record<string, number> = {};
  let admins_without_mfa = 0, banned = 0, never_signed_in = 0, inactive_90d = 0;
  for (const u of users) {
    const roles = Array.isArray(u.roles) ? (u.roles as string[]) : [];
    for (const r of roles) by_role[r] = (by_role[r] ?? 0) + 1;
    const isAdmin = roles.includes("transformador") || roles.includes("referente");
    if (isAdmin && u.mfa_enabled !== true && u.banned !== true) admins_without_mfa++;
    if (u.banned === true) banned++;
    const last = typeof u.last_sign_in_at === "string" ? Date.parse(u.last_sign_in_at) : NaN;
    if (Number.isNaN(last)) never_signed_in++;
    else if (nowMs - last > 90 * 86_400_000) inactive_90d++;
  }
  return { total: users.length, by_role, admins_without_mfa, banned, never_signed_in, inactive_90d };
}
