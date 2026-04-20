import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, Tag, FileSearch, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchAiChatSimpleContent } from "@/lib/fetchAiChatSimple";
import { useUpdateDocumentMeta } from "@/hooks/useDocuments";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DocumentLite {
  id: string;
  name: string;
  document_type?: string | null;
  tags?: string[] | null;
  mime_type?: string | null;
  source: string;
  clients?: { name: string } | null;
  projects?: { name: string } | null;
}

interface AiInsight {
  summary: string;
  suggestedType: string | null;
  suggestedTags: string[];
}

interface Props {
  document: DocumentLite | null;
}

const CACHE_PREFIX = "kawiil-doc-ai-insight:";
const TYPES_HINT = [
  "factura",
  "comprobante_fiscal",
  "contrato",
  "constancia_fiscal",
  "estado_cuenta",
  "identificacion_oficial",
  "acta",
  "poder_notarial",
  "declaracion_anual",
  "demanda",
  "amparo",
  "minuta",
  "otro",
];

function readCache(id: string): AiInsight | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiInsight & { ts: number };
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - parsed.ts > SEVEN_DAYS) return null;
    return { summary: parsed.summary, suggestedType: parsed.suggestedType, suggestedTags: parsed.suggestedTags };
  } catch {
    return null;
  }
}

function writeCache(id: string, ins: AiInsight) {
  try {
    localStorage.setItem(CACHE_PREFIX + id, JSON.stringify({ ...ins, ts: Date.now() }));
  } catch {
    /* ignore quota */
  }
}

function parseAiJson(raw: string): AiInsight | null {
  let txt = raw.trim();
  txt = txt.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const obj = JSON.parse(txt.slice(start, end + 1));
    const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    const suggestedType =
      typeof obj.suggestedType === "string" && obj.suggestedType.trim()
        ? obj.suggestedType.trim().toLowerCase()
        : null;
    const suggestedTags = Array.isArray(obj.suggestedTags)
      ? obj.suggestedTags
          .filter((t: unknown): t is string => typeof t === "string")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 8)
      : [];
    if (!summary && !suggestedType && suggestedTags.length === 0) return null;
    return { summary, suggestedType, suggestedTags };
  } catch {
    return null;
  }
}

export function DocumentAiInsightsPanel({ document }: Props) {
  const [insight, setInsight] = useState<AiInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateMeta = useUpdateDocumentMeta();

  const docId = document?.id ?? null;
  const docName = document?.name ?? "";

  const docContext = useMemo(() => {
    if (!document) return "";
    const parts = [
      `Nombre: ${document.name}`,
      document.mime_type ? `Tipo MIME: ${document.mime_type}` : null,
      document.document_type ? `Tipo actual: ${document.document_type}` : null,
      document.clients?.name ? `Cliente: ${document.clients.name}` : null,
      document.projects?.name ? `Proyecto: ${document.projects.name}` : null,
      document.source ? `Origen: ${document.source}` : null,
      document.tags?.length ? `Etiquetas actuales: ${document.tags.join(", ")}` : null,
    ].filter(Boolean);
    return parts.join("\n");
  }, [document]);

  useEffect(() => {
    if (!docId) {
      setInsight(null);
      setError(null);
      return;
    }
    const cached = readCache(docId);
    if (cached) {
      setInsight(cached);
      setError(null);
    } else {
      setInsight(null);
      setError(null);
    }
  }, [docId]);

  const runAi = async (force = false) => {
    if (!docId || !docName) return;
    if (loading) return;
    if (!force) {
      const cached = readCache(docId);
      if (cached) {
        setInsight(cached);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const prompt = `Eres asistente del despacho Kawiil (México, español). Vas a deducir, solo a partir del nombre y metadatos del archivo, qué contiene y devolver un JSON estricto.

Datos del documento:
${docContext}

Devuelve EXCLUSIVAMENTE un JSON válido con esta forma:
{
  "summary": "string en español, 1-2 oraciones, qué probablemente contiene este documento",
  "suggestedType": "string en snake_case, uno de: ${TYPES_HINT.join(", ")} (o uno propio si ninguno aplica)",
  "suggestedTags": ["string", "..."] // 3 a 6 etiquetas en español, en minúsculas, palabras o frases muy cortas, sin signos
}

Reglas:
- Si el nombre es muy genérico, marca el tipo como "otro" y deja un summary honesto ("nombre poco descriptivo, posiblemente …").
- Las etiquetas deben servir para búsqueda semántica posterior; preferir términos del dominio fiscal/legal mexicano cuando aplique (sat, csf, isr, iva, rfc, contrato, demanda, etc.).
- No incluyas claves extra. No incluyas markdown ni explicación.`;
      const raw = await fetchAiChatSimpleContent([{ role: "user", content: prompt }], {
        retries: 1,
      });
      const parsed = parseAiJson(raw);
      if (!parsed) throw new Error("La IA no devolvió un JSON válido. Intenta de nuevo.");
      setInsight(parsed);
      writeCache(docId, parsed);
    } catch (e: any) {
      setError(e?.message || "No se pudo generar el análisis IA.");
    } finally {
      setLoading(false);
    }
  };

  const applyType = () => {
    if (!docId || !insight?.suggestedType) return;
    updateMeta.mutate(
      { id: docId, document_type: insight.suggestedType },
      {
        onSuccess: () => toast.success(`Tipo aplicado: ${insight.suggestedType}`),
      },
    );
  };

  const applyAllTags = () => {
    if (!docId || !insight?.suggestedTags?.length) return;
    const merged = Array.from(
      new Set([...(document?.tags ?? []), ...insight.suggestedTags]),
    ).slice(0, 12);
    updateMeta.mutate(
      { id: docId, tags: merged },
      {
        onSuccess: () => toast.success(`${insight.suggestedTags.length} etiqueta(s) aplicadas`),
      },
    );
  };

  const applyOneTag = (tag: string) => {
    if (!docId) return;
    const current = document?.tags ?? [];
    if (current.includes(tag)) return;
    const merged = Array.from(new Set([...current, tag])).slice(0, 12);
    updateMeta.mutate(
      { id: docId, tags: merged },
      {
        onSuccess: () => toast.success(`Etiqueta agregada: ${tag}`),
      },
    );
  };

  if (!document) return null;

  const currentTags = document.tags ?? [];

  return (
    <div className="rounded-xl border border-primary/15 bg-primary/[0.03] p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <h3 className="text-sm font-semibold text-foreground">Insights con IA</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!insight && !loading && (
            <Button size="sm" variant="default" className="h-7 gap-1.5" onClick={() => runAi(false)}>
              <FileSearch className="h-3.5 w-3.5" />
              Analizar
            </Button>
          )}
          {(insight || error) && !loading && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-muted-foreground"
              onClick={() => runAi(true)}
              title="Reanalizar (descarta caché)"
            >
              <RefreshCw className="h-3 w-3" />
              Reanalizar
            </Button>
          )}
          {loading && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Pensando...
            </span>
          )}
        </div>
      </div>

      {error && (
        <p className="text-[12px] text-destructive bg-destructive/5 rounded-md px-2 py-1.5">{error}</p>
      )}

      {!insight && !loading && !error && (
        <p className="text-[12px] text-muted-foreground italic">
          Aún sin análisis. Pulsa "Analizar" para que la IA sugiera resumen, tipo y etiquetas a partir
          del nombre y metadatos del archivo.
        </p>
      )}

      {insight && (
        <div className="space-y-3">
          {insight.summary && (
            <p className="text-[12.5px] text-foreground leading-snug">{insight.summary}</p>
          )}

          {insight.suggestedType && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10.5px] uppercase font-semibold tracking-wide text-muted-foreground">
                Tipo sugerido
              </span>
              <Badge variant="outline" className="text-[11px] capitalize">
                {insight.suggestedType.replace(/_/g, " ")}
              </Badge>
              {document.document_type === insight.suggestedType ? (
                <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600">
                  <Check className="h-3 w-3" /> ya aplicado
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 gap-1 text-[11px] px-2"
                  onClick={applyType}
                  disabled={updateMeta.isPending}
                >
                  Aplicar al documento
                </Button>
              )}
            </div>
          )}

          {insight.suggestedTags.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="inline-flex items-center gap-1 text-[10.5px] uppercase font-semibold tracking-wide text-muted-foreground">
                  <Tag className="h-3 w-3" />
                  Etiquetas sugeridas
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] text-primary"
                  onClick={applyAllTags}
                  disabled={updateMeta.isPending}
                >
                  Aplicar todas
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {insight.suggestedTags.map((t) => {
                  const already = currentTags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => !already && applyOneTag(t)}
                      disabled={already || updateMeta.isPending}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                        already
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 cursor-default"
                          : "border-border/50 bg-background/50 hover:border-primary/30 hover:bg-primary/5 text-foreground",
                      )}
                      title={already ? "Ya aplicada" : "Aplicar etiqueta"}
                    >
                      {already && <Check className="inline h-3 w-3 mr-0.5" />}
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
