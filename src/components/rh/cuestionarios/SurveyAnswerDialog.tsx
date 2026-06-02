import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Questionnaire } from "@/lib/questionnaires";
import { useQuestions, useSubmitSurvey } from "@/hooks/useQuestionnaires";

interface Props {
  questionnaire: Questionnaire | null;
  onOpenChange: (v: boolean) => void;
}

export function SurveyAnswerDialog({ questionnaire, onOpenChange }: Props) {
  const open = !!questionnaire;
  const { data: questions = [], isLoading } = useQuestions(questionnaire?.id ?? null);
  const submit = useSubmitSurvey();
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id] != null);

  function handleSubmit() {
    if (!questionnaire) return;
    if (!allAnswered) {
      toast.error("Responde todas las preguntas.");
      return;
    }
    submit.mutate(
      { questionnaire, answers: questions.map((q) => ({ question_id: q.id, value: answers[q.id] })) },
      { onSuccess: () => { onOpenChange(false); setAnswers({}); } },
    );
  }

  let lastDomain = "";

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setAnswers({}); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{questionnaire?.title}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Tus respuestas son confidenciales: solo se reportan de forma agregada.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {questions.map((q, idx) => {
              const showDomain = q.domain && q.domain !== lastDomain;
              if (q.domain) lastDomain = q.domain;
              return (
                <div key={q.id} className="space-y-1.5">
                  {showDomain && (
                    <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{q.domain}</p>
                  )}
                  <p className="text-sm">{idx + 1}. {q.text}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(questionnaire?.scale ?? []).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt.value }))}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-xs transition-colors",
                          answers[q.id] === opt.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">
            {Object.keys(answers).length}/{questions.length} respondidas
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!allAnswered || submit.isPending}>
            {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
