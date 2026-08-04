import { useMemo, useState } from "react";
import { Loader2, Search, Sparkles, Eye, Star, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { fetchAiChatSimpleContent } from "@/lib/fetchAiChatSimple";
import { DocumentTile, extensionAccent, inferExtension } from "@/components/documentos/DocumentTile";
import { DocumentPreviewDialog } from "@/components/documents/DocumentPreviewDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { useDeleteDocument } from "@/hooks/useDocuments";
import { formatMX } from "@/lib/dateUtils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AiFeedback } from "@/components/ai/AiFeedback";
import { aiFeedbackKey } from "@/lib/aiFeedbackKey";

interface DocLite {
  id: string;
  name: string;
  source: string;
  document_type?: string | null;
  tags?: string[] | null;
  external_path?: string | null;
  file_path?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  created_at?: string | null;
  clients?: { name: string } | null;
  projects?: { name: string } | null;
  uploader_profile?: { full_name: string } | null;
}

interface Props {
  documents: DocLite[] | undefined;
  isLoading?: boolean;
  favorites?: Set<string>;
  onToggleFavorite?: (documentId: string, isFavorite: boolean) => void;
}

interface ScoredResult {
  id: string;
  score: number;
  reason: string;
}

const QUICK_PROMPTS = [
  "facturas del cliente Globalsat",
  "constancia fiscal vigente",
  "minutas de juntas con cliente",
  "amparos en proceso",
  "estados de cuenta del último trimestre",
];

const MAX_DOCS_FOR_AI = 60;

function parseAiResults(raw: string): ScoredResult[] | null {
  let txt = raw.trim();
  txt = txt.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  const start = txt.indexOf("[");
  const end = txt.lastIndexOf("]");
  if (start === -1 || end === -1) return null;
  try {
    const arr = JSON.parse(txt.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    return arr
      .map((r: any) => ({
        id: typeof r?.id === "string" ? r.id : String(r?.id ?? ""),
        score: typeof r?.score === "number" ? r.score : Number(r?.score ?? 0),
        reason: typeof r?.reason === "string" ? r.reason : "",
      }))
      .filter((r) => r.id && Number.isFinite(r.score))
      .sort((a, b) => b.score - a.score);
  } catch {
    return null;
  }
}

export function DocumentSemanticSearch({
  documents,
  isLoading,
  favorites,
  onToggleFavorite,
}: Props) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ScoredResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocLite | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; source: string; file_path: string | null } | null>(null);
  const deleteDocument = useDeleteDocument();

  const docsById = useMemo(() => {
    const m = new Map<string, DocLite>();
    for (const d of documents ?? []) m.set(d.id, d);
    return m;
  }, [documents]);

  const candidates = useMemo(() => {
    const docs = documents ?? [];
    if (docs.length === 0) return [] as DocLite[];
    return [...docs]
      .sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      })
      .slice(0, MAX_DOCS_FOR_AI);
  }, [documents]);

  const runSemanticSearch = async (q?: string) => {
    const text = (q ?? query).trim();
    if (!text) {
      toast.info("Escribe qué quieres buscar.");
      return;
    }
    if (candidates.length === 0) {
      toast.info("No hay documentos para buscar.");
      return;
    }
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const list = candidates
        .map((d) => {
          const parts = [
            `id=${d.id}`,
            `nombre="${d.name.slice(0, 80)}"`,
            d.document_type ? `tipo=${d.document_type}` : null,
            d.tags?.length ? `tags=${d.tags.slice(0, 6).join(",")}` : null,
            d.clients?.name ? `cliente="${d.clients.name}"` : null,
            d.projects?.name ? `proyecto="${d.projects.name}"` : null,
            d.created_at ? `fecha=${d.created_at.slice(0, 10)}` : null,
          ].filter(Boolean);
          return parts.join(" | ");
        })
        .join("\n");

      const prompt = `Eres motor de búsqueda semántica de documentos para el despacho Kawiil (México). Recibes una consulta en lenguaje natural y un catálogo de documentos. Devuelves SOLO los documentos relevantes a la consulta.

Consulta del usuario: "${text}"

Catálogo (un documento por línea, formato clave=valor separados por |):
${list}

Devuelve EXCLUSIVAMENTE un arreglo JSON con esta forma:
[
  { "id": "string-uuid", "score": number_0_a_1, "reason": "string corta en español" },
  ...
]

Reglas:
- Devuelve máximo 12 documentos, ordenados por score descendente.
- Solo incluye documentos cuyo score sea ≥ 0.4.
- "reason" debe explicar en una frase corta por qué es relevante.
- No incluyas markdown ni explicaciones fuera del JSON.
- Si nada es relevante devuelve [].`;

      const raw = await fetchAiChatSimpleContent([{ role: "user", content: prompt }], {
        retries: 1,
      });
      const parsed = parseAiResults(raw);
      if (!parsed) throw new Error("La IA no devolvió un JSON válido. Prueba reformular tu búsqueda.");
      setResults(parsed.filter((r) => docsById.has(r.id)));
    } catch (e: any) {
      setError(e?.message || "No se pudo realizar la búsqueda semántica.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Búsqueda con IA</h2>
          <span className="ml-auto text-[10.5px] text-muted-foreground">
            Analiza nombre, tipo, etiquetas, cliente y proyecto · {candidates.length}/{documents?.length ?? 0} docs
          </span>
        </div>
        <p className="text-[11.5px] text-muted-foreground mb-3 leading-snug">
          Escribe en lenguaje natural lo que necesitas (ej: "facturas del cliente X" o "constancias fiscales del año pasado") y la IA elegirá los documentos más relevantes del catálogo.
        </p>

        <div className="flex flex-col sm:flex-row items-stretch gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 h-10 text-sm bg-background"
              placeholder="¿Qué documento necesitas?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !searching) void runSemanticSearch();
              }}
              disabled={searching || isLoading}
            />
          </div>
          <Button
            onClick={() => runSemanticSearch()}
            disabled={searching || isLoading || !query.trim()}
            className="gap-2 sm:w-auto"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {searching ? "Buscando..." : "Buscar con IA"}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px] text-muted-foreground uppercase tracking-wide font-semibold">
            Sugerencias:
          </span>
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setQuery(p);
                void runSemanticSearch(p);
              }}
              disabled={searching || isLoading}
              className="rounded-full border border-border/40 bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-colors disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
          {error}
        </div>
      )}

      {searching && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-12">
          <Loader2 className="h-4 w-4 animate-spin" />
          Analizando catálogo con IA...
        </div>
      )}

      {!searching && results && results.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/60 bg-muted/20 px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">Sin resultados relevantes</p>
          <p className="mt-1 text-xs text-muted-foreground">
            La IA no encontró documentos que coincidan. Prueba reformular o sé más específico.
          </p>
        </div>
      )}

      {!searching && results && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">{results.length}</strong> resultado(s) ordenados por relevancia
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {results.map((r) => {
              const doc = docsById.get(r.id);
              if (!doc) return null;
              const ext = inferExtension(doc.name);
              const accent = doc.source === "dropbox" ? "hsl(217 91% 60%)" : extensionAccent(ext);
              const scorePct = Math.round(r.score * 100);
              return (
                <div key={r.id} className="space-y-1">
                  <DocumentTile
                    name={doc.name}
                    extension={ext}
                    icon={null}
                    accentColor={accent}
                    onClick={() => setPreviewDoc(doc)}
                    isFavorite={favorites?.has(doc.id)}
                    onToggleFavorite={
                      onToggleFavorite ? () => onToggleFavorite(doc.id, !!favorites?.has(doc.id)) : undefined
                    }
                    meta={
                      <>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] tabular-nums px-1.5 py-0",
                            scorePct >= 80
                              ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                              : scorePct >= 60
                                ? "border-amber-500/30 text-amber-700 dark:text-amber-400"
                                : "border-border/40 text-muted-foreground",
                          )}
                        >
                          IA · {scorePct}%
                        </Badge>
                        {doc.document_type && <span className="capitalize">{doc.document_type.replace(/_/g, " ")}</span>}
                        {doc.created_at && <span>{formatMX(doc.created_at, "dd MMM yyyy")}</span>}
                        {doc.clients?.name && <span className="truncate max-w-[120px]">{doc.clients.name}</span>}
                      </>
                    }
                    trailing={
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewDoc(doc);
                          }}
                          aria-label="Vista previa"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {doc.source === "dropbox" && doc.external_path && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(doc.external_path!, "_blank");
                            }}
                            aria-label="Abrir en Dropbox"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({ id: doc.id, source: doc.source, file_path: doc.file_path ?? null });
                          }}
                          aria-label="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    }
                  />
                  {r.reason && (
                    <p className="px-2 text-[11px] text-muted-foreground italic line-clamp-2">{r.reason}</p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-end">
            <AiFeedback surface="doc_semantic_search" contextKey={aiFeedbackKey(JSON.stringify(results))} />
          </div>
        </div>
      )}

      {!searching && !results && !error && (
        <div className="rounded-2xl border border-dashed border-border/40 bg-background/30 px-6 py-12 text-center">
          <Sparkles className="mx-auto h-7 w-7 text-primary/40" />
          <p className="mt-3 text-sm font-medium text-foreground">Empieza a buscar con IA</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto leading-snug">
            La búsqueda funciona sobre los últimos {MAX_DOCS_FOR_AI} documentos registrados en la
            aplicación. Escribe lo que necesitas o usa una sugerencia.
          </p>
        </div>
      )}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteDocument.mutate(deleteTarget, {
            onSettled: () => setDeleteTarget(null),
          });
        }}
        isPending={deleteDocument.isPending}
        title="Eliminar documento"
        description="¿Estás seguro de que deseas eliminar este documento? Esta acción no se puede deshacer."
      />

      <DocumentPreviewDialog
        open={!!previewDoc}
        onOpenChange={(o) => {
          if (!o) setPreviewDoc(null);
        }}
        document={previewDoc as any}
      />
    </div>
  );
}
