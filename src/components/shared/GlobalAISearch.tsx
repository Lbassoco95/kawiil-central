import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2, Sparkles, ArrowRight, Users, Briefcase, FolderKanban, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";

interface SearchResult {
  type: "client" | "project" | "task" | "user";
  id: string;
  name: string;
  url: string;
  extra?: string;
}

const ICONS = {
  client: Users,
  project: FolderKanban,
  task: Briefcase,
  user: Users,
};

const TYPE_LABELS: Record<string, string> = {
  client: "Cliente",
  project: "Proyecto",
  task: "Tarea",
  user: "Usuario",
};

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

export function GlobalAISearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [summary, setSummary] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSearch = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setOpen(true);
    setResults([]);
    setNoResults(false);
    setSummary("");

    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return;

      // Direct structured search — no AI needed
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          searchMode: true,
          searchQuery: query.trim(),
        }),
      });

      if (!resp.ok) throw new Error(`Error ${resp.status}`);
      
      const data = await resp.json();
      const searchResults: SearchResult[] = data.results || [];
      
      if (searchResults.length > 0) {
        setResults(searchResults);
        if (data.summary) setSummary(data.summary);
      } else {
        setNoResults(true);
      }
    } catch (err) {
      console.error("Search error:", err);
      setNoResults(true);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  const handleResultClick = (result: SearchResult) => {
    navigate(result.url);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md">
      <div className="relative flex items-center">
        <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Buscar clientes, proyectos, tareas..."
          className="h-8 pl-8 pr-20 text-xs bg-muted/50 border-border/50 focus:bg-background"
        />
        <div className="absolute right-1 flex items-center gap-1">
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => { setQuery(""); setOpen(false); setResults([]); setNoResults(false); setSummary(""); }}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] gap-1"
            onClick={handleSearch}
            disabled={loading || !query.trim()}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            Buscar
          </Button>
        </div>
      </div>

      {/* Results dropdown */}
      {open && (results.length > 0 || loading || noResults) && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border bg-popover shadow-lg overflow-hidden">
          {loading && (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando...
            </div>
          )}

          {summary && (
            <div className="px-3 py-2 border-b bg-muted/30">
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
                <div className="min-w-0 flex-1 [&_p:first-child]:mt-0">
                  <KawiilAiMarkdown variant="compact" className="text-muted-foreground [&_strong]:text-foreground">
                    {summary}
                  </KawiilAiMarkdown>
                </div>
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div className="max-h-[300px] overflow-y-auto">
              {results.map((result, i) => {
                const Icon = ICONS[result.type] || Briefcase;
                return (
                  <button
                    key={`${result.type}-${result.id}-${i}`}
                    className="flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                    onClick={() => handleResultClick(result)}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium">{result.name}</p>
                      {result.extra && (
                        <p className="truncate text-xs text-muted-foreground">{result.extra}</p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {TYPE_LABELS[result.type] || result.type}
                    </Badge>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}

          {noResults && !loading && (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              No se encontraron resultados para "{query}"
            </div>
          )}

          <div className="border-t px-3 py-1.5 flex justify-end">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5" /> Kawiil AI
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
