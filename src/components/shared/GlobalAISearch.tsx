import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2, Sparkles, ArrowRight, Users, Briefcase, FolderKanban, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

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
      const { supabase } = await import("@/integrations/supabase/client");
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return;

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `Busca en la plataforma: "${query}". Usa la herramienta search_across para encontrar resultados. Después, presenta los resultados encontrados de forma clara y concisa, mencionando el tipo (cliente, proyecto, tarea) y un dato extra relevante. Si no encuentras nada, dilo amablemente.`,
            },
          ],
        }),
      });

      if (!resp.ok) throw new Error(`Error ${resp.status}`);
      if (!resp.body) throw new Error("No stream body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let fullContent = "";
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) fullContent += content;
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Parse search results from the AI's response
      // The AI uses search_across tool which returns structured data
      // Try to extract navigable results from the text response
      const parsedResults = parseSearchResults(fullContent);
      if (parsedResults.length > 0) {
        setResults(parsedResults);
      }
      setSummary(fullContent);
    } catch (err) {
      console.error("AI Search error:", err);
      setSummary("Error al buscar. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const parseSearchResults = (text: string): SearchResult[] => {
    // Try to extract mentions of clients, projects, tasks from the AI response
    const results: SearchResult[] = [];
    
    // Look for patterns like "Cliente: Name" or bullet points with entity types
    const patterns = [
      { regex: /\*?\*?(?:Cliente|client)[:\s]*\*?\*?\s*([^\n,\-–]+)/gi, type: "client" as const },
      { regex: /\*?\*?(?:Proyecto|project)[:\s]*\*?\*?\s*([^\n,\-–]+)/gi, type: "project" as const },
      { regex: /\*?\*?(?:Tarea|task)[:\s]*\*?\*?\s*([^\n,\-–]+)/gi, type: "task" as const },
    ];

    for (const { regex, type } of patterns) {
      let match;
      while ((match = regex.exec(text)) !== null) {
        const name = match[1].trim().replace(/\*+/g, "").trim();
        if (name.length > 2 && name.length < 100) {
          results.push({
            type,
            id: "",
            name,
            url: type === "client" ? "/clientes" : type === "project" ? "/proyectos" : "/tareas",
          });
        }
      }
    }

    return results.slice(0, 10);
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
          onFocus={() => (results.length > 0 || summary) && setOpen(true)}
          placeholder="Buscar con AI..."
          className="h-8 pl-8 pr-20 text-xs bg-muted/50 border-border/50 focus:bg-background"
        />
        <div className="absolute right-1 flex items-center gap-1">
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => { setQuery(""); setOpen(false); setResults([]); setSummary(""); }}
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
              Buscando con Claude...
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
            <div className="border-t px-3 py-2 text-xs text-muted-foreground bg-muted/30 max-h-[200px] overflow-y-auto whitespace-pre-wrap">
              {summary}
            </div>
          )}

          <div className="border-t px-3 py-1.5 flex justify-end">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5" /> Powered by Claude
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
