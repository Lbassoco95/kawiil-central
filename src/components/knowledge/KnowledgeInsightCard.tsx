import { useInsightSourceChunks, type KnowledgeInsight } from "@/hooks/useKnowledge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { BookMarked, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { getSourceTypeCopy, getInsightTypeCopy, truncateChunkText } from "@/lib/knowledgeLabels";
import { AiFeedback } from "@/components/ai/AiFeedback";

export function KnowledgeInsightCard({ insight, technical }: { insight: KnowledgeInsight; technical: boolean }) {
  const ids = insight.source_chunks?.filter(Boolean);
  const { data: chunks, isLoading } = useInsightSourceChunks(ids?.length ? ids : undefined);
  const typeCopy = getInsightTypeCopy(insight.insight_type);

  return (
    <div className="rounded-lg border border-border/50 bg-card/60 p-3 text-xs space-y-2">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-[10px] font-medium">{typeCopy.label}</Badge>
          {technical && (
            <Badge variant="outline" className="text-[9px] font-mono">{insight.insight_type}</Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">{typeCopy.whatItIs}</p>
        <p className="text-[10px] text-muted-foreground/80 italic">{typeCopy.howUsed}</p>
      </div>
      <p className="font-medium text-foreground text-sm">{insight.title}</p>
      <div className="prose prose-xs dark:prose-invert max-w-none text-xs max-h-48 overflow-y-auto pr-1">
        <ReactMarkdown>{insight.content}</ReactMarkdown>
      </div>
      {insight.content && (
        <div className="mt-2 flex justify-end">
          <AiFeedback surface="knowledge_insight" contextKey={insight.id} />
        </div>
      )}
      {ids && ids.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline data-[state=open]:[&_.chev-evidence]:rotate-90">
            <BookMarked className="h-3.5 w-3.5" />
            Ver fragmentos que respaldan este resumen ({ids.length})
            <ChevronRight className="chev-evidence h-3 w-3 shrink-0 transition-transform" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2 border-t border-border/40 pt-2">
            {isLoading && (
              <>
                <Skeleton className="h-12 w-full rounded-md" />
                <Skeleton className="h-12 w-full rounded-md" />
              </>
            )}
            {!isLoading && (!chunks || chunks.length === 0) && (
              <p className="text-[11px] text-muted-foreground">No se pudieron cargar los fragmentos (puede que ya no existan).</p>
            )}
            {chunks?.map((ch, i) => {
              const src = getSourceTypeCopy(ch.source_type);
              return (
                <div key={ch.id} className="rounded-md bg-secondary/30 p-2 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-medium text-foreground">{i + 1}. {src.label}</span>
                    <span className="hidden sm:inline">· {src.definition.slice(0, 80)}…</span>
                  </div>
                  <p className="text-[11px] text-foreground/90 leading-relaxed">{truncateChunkText(ch.content, 360)}</p>
                  {technical && (
                    <p className="text-[9px] font-mono text-muted-foreground break-all">id: {ch.id}</p>
                  )}
                </div>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
