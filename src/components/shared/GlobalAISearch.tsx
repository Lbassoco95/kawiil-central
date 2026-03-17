import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2, Sparkles, ArrowRight, Users, Briefcase, FolderKanban, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

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

export function GlobalAISearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close on outside click
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
    setSummary("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await supabase.functions.invoke("ai-chat", {
        body: {
          messages: [
            {
              role: "system",
              content: `Eres un buscador inteligente. El usuario busca entidades en su organización. 
Usa los tools disponibles para buscar clientes, proyectos, tareas y miembros del equipo.
Responde con un JSON array de resultados encontrados en este formato exacto:
\`\`\`json
[{"type": "client|project|task|user", "id": "uuid", "name": "nombre", "extra": "info adicional breve"}]
\`\`\`
Máximo 10 resultados más relevantes. Si no encuentras nada, devuelve [].
Después del JSON, agrega un resumen de 1 línea.`,
            },
            { role: "user", content: query },
          ],
        },
      });

      if (response.error) throw response.error;

      const content = response.data?.choices?.[0]?.message?.content || response.data?.content || "";
      
      // Parse results from response
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        try {
          const jsonStr = jsonMatch[1] || jsonMatch[0];
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed)) {
            setResults(
              parsed.map((r: any) => ({
                type: r.type || "project",
                id: r.id || "",
                name: r.name || "Sin nombre",
                url: r.type === "client" ? `/clientes/${r.id}` :
                     r.type === "project" ? `/proyectos/${r.id}` :
                     r.type === "task" ? `/tareas` :
                     `/admin`,
                extra: r.extra || "",
              }))
            );
          }
        } catch {}
      }

      // Extract summary (text after JSON)
      const summaryText = content.replace(/```json[\s\S]*?```/, "").replace(/\[[\s\S]*?\]/, "").trim();
      if (summaryText) setSummary(summaryText);
    } catch (err) {
      console.error("AI Search error:", err);
      setSummary("Error al buscar. Intenta de nuevo.");
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
          placeholder="Buscar con AI..."
          className="h-8 pl-8 pr-20 text-xs bg-muted/50 border-border/50 focus:bg-background"
        />
        <div className="absolute right-1 flex items-center gap-1">
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => { setQuery(""); setOpen(false); setResults([]); }}
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
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-primary" />}
            AI
          </Button>
        </div>
      </div>

      {/* Results dropdown */}
      {open && (results.length > 0 || loading || summary) && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border bg-popover shadow-lg overflow-hidden">
          {loading && (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando...
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

          {summary && !loading && (
            <div className="border-t px-3 py-2 text-xs text-muted-foreground bg-muted/30">
              {summary}
            </div>
          )}

          <div className="border-t px-3 py-1.5 flex justify-end">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5" /> Powered by AI
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
