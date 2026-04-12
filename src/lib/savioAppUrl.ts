/** URL del panel web Savio (prod o sandbox) para enlaces «Abrir en Savio». Sin barra final. */
export function getSavioAppPanelUrl(): string | null {
  const raw = import.meta.env.VITE_SAVIO_APP_URL;
  if (typeof raw !== "string") return null;
  const u = raw.trim();
  if (!u) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return u.replace(/\/+$/, "");
  } catch {
    return null;
  }
}
