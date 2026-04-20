/**
 * Caché + throttle compartido para las cards Kawiil AI (Email, Slack, Calendar…).
 *
 * Por qué existe:
 *   Anthropic tier 1 es muy estrecho (50 RPM, 50k input TPM, 10k output TPM,
 *   conexiones concurrentes limitadas). Sin esta capa, abrir varios correos /
 *   canales seguidos dispara 429 en cascada y el usuario no recibe resumen.
 *
 * Qué ofrece:
 *   1. Caché persistente (memoria + localStorage) con TTL, llavada por `scope`
 *      (ej. "email-summary") + `key` (ej. `emailId`).
 *   2. Deduplicación de requests en vuelo por la misma key.
 *   3. Semáforo global configurable (default 2 concurrentes) para no saturar
 *      el límite de "concurrent connections" de Anthropic.
 *
 * No maneja invalidación por contenido; las cards deben decidir cuándo
 * invalidar (ej. al hacer click en "Regenerar").
 */

const LS_PREFIX = "kawiil.ai.cache.v1:";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_CONCURRENT = 2;

type CacheEntry<T> = { t: number; v: T };

const memCache = new Map<string, CacheEntry<unknown>>();

function lsAvailable(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const t = "__kawiil_probe__";
    window.localStorage.setItem(t, "1");
    window.localStorage.removeItem(t);
    return true;
  } catch {
    return false;
  }
}

const HAS_LS = lsAvailable();

function readFromLS<T>(k: string): CacheEntry<T> | null {
  if (!HAS_LS) return null;
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + k);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.t !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeToLS<T>(k: string, entry: CacheEntry<T>): void {
  if (!HAS_LS) return;
  try {
    window.localStorage.setItem(LS_PREFIX + k, JSON.stringify(entry));
  } catch {
    // quota / modo privado / etc. → ignoramos, sigue funcionando el caché en memoria
  }
}

function removeFromLS(k: string): void {
  if (!HAS_LS) return;
  try {
    window.localStorage.removeItem(LS_PREFIX + k);
  } catch { /* ignore */ }
}

/** Devuelve el valor cacheado para `scope:key` si está vigente, o null. */
export function readAiCache<T>(scope: string, key: string, ttlMs = DEFAULT_TTL_MS): T | null {
  const k = `${scope}:${key}`;
  const now = Date.now();
  const mem = memCache.get(k) as CacheEntry<T> | undefined;
  if (mem && now - mem.t < ttlMs) return mem.v;
  const fromLS = readFromLS<T>(k);
  if (fromLS && now - fromLS.t < ttlMs) {
    memCache.set(k, fromLS);
    return fromLS.v;
  }
  return null;
}

/** Guarda un valor en caché (memoria + localStorage). */
export function writeAiCache<T>(scope: string, key: string, value: T): void {
  const k = `${scope}:${key}`;
  const entry: CacheEntry<T> = { t: Date.now(), v: value };
  memCache.set(k, entry);
  writeToLS(k, entry);
}

/** Invalida un valor cacheado (memoria + localStorage). */
export function invalidateAiCache(scope: string, key: string): void {
  const k = `${scope}:${key}`;
  memCache.delete(k);
  removeFromLS(k);
}

// ───────── Semáforo global + dedup ─────────

const inFlight = new Map<string, Promise<unknown>>();
let running = 0;
const waitQueue: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  running++;
}

function release(): void {
  running = Math.max(0, running - 1);
  const next = waitQueue.shift();
  if (next) next();
}

/**
 * Ejecuta `fn` respetando:
 *   - caché `scope:key` (si no está `force`)
 *   - dedup: si otro caller ya está pidiendo la misma key, ambos reciben el mismo resultado
 *   - semáforo global de MAX_CONCURRENT
 *
 * El caller decide si `force` (típicamente al click de regenerar).
 */
export async function withAiRateLimit<T>(opts: {
  scope: string;
  key: string;
  force?: boolean;
  ttlMs?: number;
  fn: () => Promise<T>;
}): Promise<{ value: T; fromCache: boolean }> {
  const { scope, key, force = false, ttlMs = DEFAULT_TTL_MS, fn } = opts;

  if (!force) {
    const cached = readAiCache<T>(scope, key, ttlMs);
    if (cached !== null) return { value: cached, fromCache: true };
  }

  const fullKey = `${scope}:${key}`;
  const existing = inFlight.get(fullKey) as Promise<T> | undefined;
  if (existing) {
    const value = await existing;
    return { value, fromCache: true };
  }

  const p = (async () => {
    await acquire();
    try {
      const value = await fn();
      writeAiCache(scope, key, value);
      return value;
    } finally {
      release();
      inFlight.delete(fullKey);
    }
  })();
  inFlight.set(fullKey, p);
  const value = await p;
  return { value, fromCache: false };
}
