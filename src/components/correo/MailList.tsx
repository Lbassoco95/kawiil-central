import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Search, SlidersHorizontal, RefreshCw } from "lucide-react";
import { useOutlookEmails } from "@/hooks/useMicrosoft";
import { useQueryClient } from "@tanstack/react-query";
import {
  emailListTimestamp,
  getDateBucket,
  DATE_BUCKET_LABELS,
  type DateBucket,
} from "@/lib/emailChips";
import { MailItem } from "./MailItem";

interface Props {
  folderId: string;
  selectedEmailId: string | null;
  onSelectEmail: (id: string) => void;
}

const FILTERS = [
  { id: "all",      label: "Todos" },
  { id: "unread",   label: "No leídos" },
  { id: "starred",  label: "Destacados" },
  { id: "attach",   label: "Con adjuntos" },
];

export function MailList({ folderId, selectedEmailId, onSelectEmail }: Props) {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);

  const debouncedSearch = useDebouncedValue(search, 350);

  const {
    data,
    isLoading,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useOutlookEmails(folderId, debouncedSearch || undefined);

  const allEmails = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.emails as Record<string, unknown>[]),
    [data]
  );

  const filtered = useMemo(() => {
    let list = allEmails;
    if (activeFilter === "unread") list = list.filter((e) => !e.isRead);
    if (activeFilter === "starred") list = list.filter((e) => e.flag && (e.flag as { flagStatus?: string }).flagStatus === "flagged");
    if (activeFilter === "attach") list = list.filter((e) => e.hasAttachments);
    return list;
  }, [allEmails, activeFilter]);

  // Scroll infinito
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Agrupar por bucket de fecha
  const now = useMemo(() => new Date(), []);
  const groups = useMemo(() => {
    const order: DateBucket[] = ["hoy", "ayer", "semana", "anterior"];
    const map: Record<DateBucket, Record<string, unknown>[]> = { hoy: [], ayer: [], semana: [], anterior: [] };
    for (const email of filtered) {
      const ts = emailListTimestamp({
        receivedDateTime: email.receivedDateTime as string | undefined,
        sentDateTime: email.sentDateTime as string | undefined,
        createdDateTime: email.createdDateTime as string | undefined,
      });
      map[getDateBucket(ts, now)].push(email);
    }
    return order.filter((b) => map[b].length > 0).map((b) => ({ bucket: b, emails: map[b] }));
  }, [filtered, now]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });

  return (
    <div className="mail-list">
      {/* Buscador */}
      <div className="mail-list-head">
        <div className="mail-search">
          <Search size={14} className="s-ico" />
          <input
            type="text"
            placeholder="Buscar correos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="ai-badge">AI</span>
        </div>
        <button
          onClick={refresh}
          title="Actualizar"
          style={{
            background: "transparent",
            border: 0,
            cursor: "pointer",
            padding: "6px",
            borderRadius: "6px",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
        </button>
        <button
          style={{
            background: "transparent",
            border: 0,
            cursor: "pointer",
            padding: "6px",
            borderRadius: "6px",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          <SlidersHorizontal size={14} />
        </button>
      </div>

      {/* Filtros */}
      <div className="mail-list-toolbar">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`mail-filter-chip ${activeFilter === f.id ? "active" : ""}`}
            onClick={() => setActiveFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
          {filtered.length} mensajes
        </span>
      </div>

      {/* Lista con grupos de fecha */}
      <div className="mail-list-scroll" ref={listRef}>
        {isLoading && (
          <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
            Cargando mensajes…
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
            No hay mensajes
          </div>
        )}

        {groups.map(({ bucket, emails }) => (
          <div key={bucket}>
            <div className="mail-date-sep">{DATE_BUCKET_LABELS[bucket]}</div>
            {emails.map((email) => (
              <MailItem
                key={email.id as string}
                email={email}
                isActive={selectedEmailId === (email.id as string)}
                onClick={() => onSelectEmail(email.id as string)}
              />
            ))}
          </div>
        ))}

        {isFetchingNextPage && (
          <div style={{ padding: 12, textAlign: "center", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
            Cargando más…
          </div>
        )}
      </div>
    </div>
  );
}

// ── hook debounce simple ──────────────────────────────────────
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
