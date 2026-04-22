/**
 * Best-effort filename from a public Dropbox share URL (no network).
 * Supports common /s/... and /scl/fi/... patterns.
 */
export function extractDropboxFilenameFromUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const href = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
    const u = new URL(href);
    if (!u.hostname.toLowerCase().endsWith("dropbox.com")) return null;
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;

    // https://www.dropbox.com/s/<id>/<filename>
    if (segments[0] === "s" && segments.length >= 3) {
      const last = segments[segments.length - 1];
      return safeDecodeFilename(last);
    }

    // https://www.dropbox.com/scl/fi/<id>/<filename>
    if (segments[0] === "scl" && segments[1] === "fi" && segments.length >= 4) {
      const last = segments[segments.length - 1];
      return safeDecodeFilename(last);
    }

    // /sh/<share_id>/<optional_name> — use last segment if it looks like a file
    if (segments[0] === "sh" && segments.length >= 2) {
      const last = segments[segments.length - 1];
      if (looksLikeFilename(last)) return safeDecodeFilename(last);
    }

    const last = segments[segments.length - 1];
    if (looksLikeFilename(last)) return safeDecodeFilename(last);

    return null;
  } catch {
    return null;
  }
}

function looksLikeFilename(segment: string): boolean {
  if (!segment || segment.length > 240) return false;
  return segment.includes(".") && !/^rlkey=/i.test(segment);
}

function safeDecodeFilename(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function shortUrlForDisplay(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const href = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
    const u = new URL(href);
    const path = u.pathname.length > 25 ? u.pathname.slice(0, 22) + "…" : u.pathname;
    return u.hostname + path;
  } catch {
    return trimmed;
  }
}

/** Label for UI: stored name wins, then derived Dropbox filename, then shortened URL. */
export function getDropboxLinkDisplayLabel(url: string, storedName?: string | null): string {
  const stored = storedName?.trim();
  if (stored) return stored;
  const derived = extractDropboxFilenameFromUrl(url);
  if (derived) return derived;
  return shortUrlForDisplay(url);
}
