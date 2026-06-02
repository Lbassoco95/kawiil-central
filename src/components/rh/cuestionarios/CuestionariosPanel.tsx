import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ClipboardCheck, CheckCircle2 } from "lucide-react";
import { useQuestionnaires, useMyResponse } from "@/hooks/useQuestionnaires";
import type { Questionnaire } from "@/lib/questionnaires";
import { SurveyAnswerDialog } from "./SurveyAnswerDialog";

export function CuestionariosPanel() {
  const { data: all = [], isLoading } = useQuestionnaires();
  const [answering, setAnswering] = useState<Questionnaire | null>(null);
  const active = all.filter((q) => q.active);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Cuestionarios disponibles. Tus respuestas son confidenciales y solo se reportan de forma agregada.
      </p>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : active.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ClipboardCheck className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No hay cuestionarios abiertos por ahora.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {active.map((q) => <QuestionnaireRow key={q.id} q={q} onAnswer={() => setAnswering(q)} />)}
        </div>
      )}

      <SurveyAnswerDialog questionnaire={answering} onOpenChange={(v) => !v && setAnswering(null)} />
    </div>
  );
}

function QuestionnaireRow({ q, onAnswer }: { q: Questionnaire; onAnswer: () => void }) {
  const { data: response } = useMyResponse(q.id);
  const done = !!response;
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{q.title}</p>
          {q.description && <p className="truncate text-xs text-muted-foreground">{q.description}</p>}
        </div>
        {done ? (
          <Badge variant="outline" className="shrink-0 border-emerald-300 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Respondido
          </Badge>
        ) : (
          <Button size="sm" onClick={onAnswer}>Responder</Button>
        )}
      </CardContent>
    </Card>
  );
}
