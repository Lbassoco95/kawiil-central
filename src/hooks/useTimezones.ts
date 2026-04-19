import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "kawiil-sb-tz";

export type TimezoneEntry = {
  /** IANA timezone, e.g. "America/Los_Angeles" */
  zone: string;
  /** Short label shown in the chip, e.g. "SF" */
  code: string;
  /** Optional flag emoji */
  flag?: string;
};

export const DEFAULT_TIMEZONES: TimezoneEntry[] = [
  { zone: "America/Los_Angeles", code: "SF", flag: "🇺🇸" },
  { zone: "America/New_York", code: "NY", flag: "🇺🇸" },
  { zone: "Europe/Madrid", code: "MAD", flag: "🇪🇸" },
];

export const TIMEZONE_PRESETS: TimezoneEntry[] = [
  { zone: "America/Los_Angeles", code: "SF", flag: "🇺🇸" },
  { zone: "America/Denver", code: "DEN", flag: "🇺🇸" },
  { zone: "America/Chicago", code: "CHI", flag: "🇺🇸" },
  { zone: "America/New_York", code: "NY", flag: "🇺🇸" },
  { zone: "America/Mexico_City", code: "CDMX", flag: "🇲🇽" },
  { zone: "America/Bogota", code: "BOG", flag: "🇨🇴" },
  { zone: "America/Santiago", code: "SCL", flag: "🇨🇱" },
  { zone: "America/Argentina/Buenos_Aires", code: "BUE", flag: "🇦🇷" },
  { zone: "Europe/Madrid", code: "MAD", flag: "🇪🇸" },
  { zone: "Europe/London", code: "LON", flag: "🇬🇧" },
  { zone: "Europe/Paris", code: "PAR", flag: "🇫🇷" },
  { zone: "Europe/Berlin", code: "BER", flag: "🇩🇪" },
  { zone: "Asia/Tokyo", code: "TYO", flag: "🇯🇵" },
  { zone: "Asia/Hong_Kong", code: "HKG", flag: "🇭🇰" },
  { zone: "Asia/Shanghai", code: "SHA", flag: "🇨🇳" },
  { zone: "Asia/Dubai", code: "DXB", flag: "🇦🇪" },
];

function readInitial(): TimezoneEntry[] {
  if (typeof window === "undefined") return DEFAULT_TIMEZONES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TIMEZONES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_TIMEZONES;
    return parsed.filter((p) => p && typeof p.zone === "string" && typeof p.code === "string");
  } catch {
    return DEFAULT_TIMEZONES;
  }
}

export function useTimezones() {
  const [zones, setZonesState] = useState<TimezoneEntry[]>(readInitial);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setZonesState(readInitial());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((next: TimezoneEntry[]) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const add = useCallback(
    (entry: TimezoneEntry) => {
      setZonesState((prev) => {
        if (prev.some((z) => z.zone === entry.zone)) return prev;
        const next = [...prev, entry];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const remove = useCallback(
    (zone: string) => {
      setZonesState((prev) => {
        const next = prev.filter((z) => z.zone !== zone);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    setZonesState(DEFAULT_TIMEZONES);
    persist(DEFAULT_TIMEZONES);
  }, [persist]);

  return { zones, add, remove, reset };
}

export function formatTimeInZone(date: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return "—";
  }
}
