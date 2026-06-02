import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowUp, ArrowDown, Trash2, Plus, Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Question, Questionnaire } from "@/lib/questionnaires";
import {
  useQuestions,
  useUpdateQuestionnaire,
  useCreateQuestion,
  useUpdateQuestion,
  useDeleteQuestion,
  useReorderQuestions,
} from "@/hooks/useQuestionnaires";

interface Props {
  questionnaire: Questionnaire | null;
  hasResponses: boolean;
  onOpenChange: (v: boolean) => void;
}

export function QuestionnaireEditorDialog({ questionnaire, hasResponses, onOpenChange }: Props) {
  const open = !!questionnaire;
  const { data: questions = [] } = useQuestions(questionnaire?.id ?? null);
  const updateQ = useUpdateQuestionnaire();
  const create = useCreateQuestion();
  const reorder = useReorderQuestions();

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [newText, setNewText] = useState("");
  const [newCat, setNewCat] = useState("");
  const [newDom, setNewDom] = useState("");

  // Sincroniza título/descripción al abrir un cuestionario distinto.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (questionnaire && loadedId !== questionnaire.id) {
    setLoadedId(questionnaire.id);
    setTitle(questionnaire.title);
    setDesc(questionnaire.description ?? "");
  }

  if (!questionnaire) return null;
  const qid = questionnaire.id;

  const move = (index: number, dir: -1 | 1) => {
    const next = [...questions];
    const t = index + dir;
    if (t < 0 || t >= next.length) return;
    [next[index], next[t]] = [next[t], next[index]];
    reorder.mutate({ questionnaireId: qid, ordered: next });
  };

  const titleDirty = title.trim() !== questionnaire.title || desc.trim() !== (questionnaire.description ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar cuestionario</DialogTitle></DialogHeader>

        {hasResponses && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            Este cuestionario ya tiene respuestas. Editar ítems puede afectar la comparación de resultados.
          </p>
        )}

        <div className="space-y-2">
          <Label className="text-xs">Título</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-sm" />
          <Label className="text-xs">Descripción</Label>
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} className="h-8 text-sm" />
          {titleDirty && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => updateQ.mutate({ id: qid, title: title.trim(), description: desc.trim() || null })}>
                <Check className="mr-1.5 h-3.5 w-3.5" /> Guardar encabezado
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Ítems ({questions.length}). Marca como “inverso” los ítems redactados en positivo (su puntaje se invierte).
          </Label>
          {questions.map((q, i) => (
            <QuestionEditRow key={q.id} q={q} index={i} total={questions.length} onMove={move} />
          ))}

          {/* Nuevo ítem */}
          <div className="space-y-2 rounded-lg border border-dashed p-2.5">
            <Input value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="Texto del nuevo ítem" className="h-8 text-sm" />
            <div className="flex flex-wrap items-center gap-2">
              <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Categoría" className="h-8 w-40 text-sm" />
              <Input value={newDom} onChange={(e) => setNewDom(e.target.value)} placeholder="Dominio" className="h-8 w-40 text-sm" />
              <Button
                size="sm"
                disabled={!newText.trim() || create.isPending}
                onClick={() => {
                  create.mutate(
                    { questionnaire, text: newText.trim(), category: newCat.trim() || null, domain: newDom.trim() || null, reverse: false, position: questions.length },
                    { onSuccess: () => { setNewText(""); } },
                  );
                }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Agregar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QuestionEditRow({ q, index, total, onMove }: {
  q: Question; index: number; total: number; onMove: (i: number, d: -1 | 1) => void;
}) {
  const update = useUpdateQuestion();
  const del = useDeleteQuestion();
  const [text, setText] = useState(q.text);
  const [cat, setCat] = useState(q.category ?? "");
  const [dom, setDom] = useState(q.domain ?? "");
  const dirty = text.trim() !== q.text || cat.trim() !== (q.category ?? "") || dom.trim() !== (q.domain ?? "");

  return (
    <div className="space-y-1.5 rounded-lg border p-2.5">
      <div className="flex items-start gap-1.5">
        <span className="mt-1.5 w-5 shrink-0 text-right text-xs text-muted-foreground">{index + 1}</span>
        <Input value={text} onChange={(e) => setText(e.target.value)} className="h-8 text-sm" />
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={index === 0} onClick={() => onMove(index, -1)}>
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={index === total - 1} onClick={() => onMove(index, 1)}>
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-red-600" onClick={() => del.mutate({ id: q.id, questionnaireId: q.questionnaire_id })}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Categoría" className="h-7 w-36 text-xs" />
        <Input value={dom} onChange={(e) => setDom(e.target.value)} placeholder="Dominio" className="h-7 w-36 text-xs" />
        <button
          type="button"
          onClick={() => update.mutate({ id: q.id, questionnaireId: q.questionnaire_id, patch: { reverse: !q.reverse } })}
          title="Ítem redactado en positivo (puntaje invertido)"
        >
          <Badge variant="outline" className={cn("cursor-pointer text-[10px]", q.reverse ? "border-sky-300 text-sky-700 dark:text-sky-400" : "text-muted-foreground")}>
            <RefreshCw className="mr-1 h-3 w-3" /> {q.reverse ? "Inverso" : "Normal"}
          </Badge>
        </button>
        {dirty && (
          <Button size="sm" variant="ghost" className="h-7"
            onClick={() => update.mutate({ id: q.id, questionnaireId: q.questionnaire_id, patch: { text: text.trim(), category: cat.trim() || null, domain: dom.trim() || null } })}>
            <Check className="mr-1 h-3.5 w-3.5 text-emerald-600" /> Guardar
          </Button>
        )}
      </div>
    </div>
  );
}
