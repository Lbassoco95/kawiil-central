import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  bandFor,
  BAND_COLOR_STYLE,
  categoryTone,
  type Questionnaire,
} from "@/lib/questionnaires";
import {
  useQuestionnaires,
  useToggleQuestionnaireActive,
  useResponseCount,
  useQuestionnaireResults,
} from "@/hooks/useQuestionnaires";

export function ResultadosRHPanel() {
  const { data: all = [], isLoading } = useQuestionnaires();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Activa un cuestionario para que el equipo lo responda y revisa los resultados agregados.
        Las respuestas son confidenciales: no se muestran respuestas individuales.
      </p>
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        all.map((q) => <ResultCard key={q.id} q={q} />)
      )}
    </div>
  );
}

function ResultCard({ q }: { q: Questionnaire }) {
  const toggle = useToggleQuestionnaireActive();
  const { data: count = 0 } = useResponseCount(q.id, true);
  const { data: results } = useQuestionnaireResults(q.id, true);

  const band = q.bands?.length && results ? bandFor(q.bands, results.total_avg) : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">{q.title}</span>
          <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            {q.active ? "Abierto" : "Cerrado"}
            <Switch checked={q.active} onCheckedChange={(v) => toggle.mutate({ id: q.id, active: v })} />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> {count} respuesta(s)
        </div>

        {count === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay respuestas.</p>
        ) : (
          <>
            {band && (
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                <span className="text-sm font-medium">Nivel de riesgo (promedio)</span>
                <Badge variant="outline" className={cn(BAND_COLOR_STYLE[band.color] ?? BAND_COLOR_STYLE.slate)}>
                  {band.label} · {results?.total_avg}/{results?.total_max}
                </Badge>
              </div>
            )}
            <div className="space-y-2">
              {(results?.categories ?? []).map((c) => {
                const tone = categoryTone(c.pct, q.higher_is_better);
                return (
                  <div key={c.category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{c.category}</span>
                      <span className="text-muted-foreground">{c.pct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-red-500",
                        )}
                        style={{ width: `${c.pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
