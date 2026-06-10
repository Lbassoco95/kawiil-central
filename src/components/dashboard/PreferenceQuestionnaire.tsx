import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Sparkles, ChevronRight, ChevronLeft, Loader2, Check, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

type AnswerValue = string | string[];
type Answers = Record<string, AnswerValue>;

interface BaseQuestion {
  key: string;
  label: string;
  description?: string;
  optional?: boolean;
  /** If provided, question is only shown when this returns true */
  showIf?: (answers: Answers) => boolean;
}
interface SelectQuestion extends BaseQuestion { type: "select"; options: string[]; }
interface MultiSelectQuestion extends BaseQuestion { type: "multiselect"; options: string[]; }
interface TextQuestion extends BaseQuestion { type: "text" | "textarea"; placeholder?: string; }
interface ScaleQuestion extends BaseQuestion { type: "scale"; leftLabel: string; rightLabel: string; }
type Question = SelectQuestion | MultiSelectQuestion | TextQuestion | ScaleQuestion;

const hasHobbyDeporte = (answers: Answers) => {
  const h = answers["hobbies"];
  return Array.isArray(h) && h.includes("Deportes / ejercicio");
};

const QUESTIONS: Question[] = [
  {
    key: "hobbies",
    label: "¿Cuáles son tus hobbies o actividades favoritas fuera del trabajo?",
    description: "Selecciona todas las que apliquen",
    type: "multiselect",
    options: [
      "Deportes / ejercicio",
      "Música (escuchar o tocar)",
      "Lectura / libros",
      "Cine / series",
      "Viajes",
      "Cocinar",
      "Arte / fotografía / diseño",
      "Videojuegos",
      "Meditación / mindfulness",
    ],
  },
  {
    key: "deporte",
    label: "¿Qué deporte o actividad física practicas?",
    type: "text",
    optional: true,
    placeholder: "Ej: fútbol, correr, yoga, CrossFit, ciclismo...",
    showIf: hasHobbyDeporte,
  },
  {
    key: "equipo_artista",
    label: "¿Tienes algún equipo deportivo o artista/banda que te apasione?",
    type: "text",
    optional: true,
    placeholder: "Ej: Chivas, Real Madrid, Coldplay, Bad Bunny...",
  },
  {
    key: "tipo_mensaje",
    label: "¿Qué tipo de mensaje te da más energía en la mañana?",
    type: "select",
    options: [
      "Una frase que me rete y me saque de mi zona de confort",
      "Una cita inspiradora de alguien que admiro",
      "Algo que me haga sonreír o reír",
      "Una reflexión filosófica o profunda",
      "Un dato curioso o hecho interesante",
    ],
  },
  {
    key: "tono_serio_divertido",
    label: "¿Cómo prefieres el tono del mensaje?",
    type: "scale",
    leftLabel: "Muy serio",
    rightLabel: "Muy divertido",
  },
  {
    key: "tono_corto_largo",
    label: "¿Cuánto detalle prefieres en tu frase del día?",
    type: "scale",
    leftLabel: "Corto y directo",
    rightLabel: "Con contexto y explicación",
  },
  {
    key: "figuras_inspiradoras",
    label: "Menciona 2–3 personas que admires o te inspiren",
    description: "Pueden ser atletas, líderes, personajes históricos o de ficción",
    type: "text",
    placeholder: "Ej: Kobe Bryant, Marie Curie, Walter White...",
  },
  {
    key: "obra_favorita",
    label: "¿Hay algún libro, película, serie o podcast que haya marcado tu vida?",
    type: "text",
    optional: true,
    placeholder: "Ej: Atomic Habits, Breaking Bad, The Daily...",
  },
  {
    key: "meta_anio",
    label: "¿Hay algún objetivo personal o meta que estés persiguiendo este año?",
    type: "textarea",
    optional: true,
    placeholder: "Ej: correr un maratón, aprender un idioma, leer 12 libros...",
  },
  {
    key: "excluir_temas",
    label: "¿Hay algún tema del que prefieras NO recibir mensajes?",
    description: "Respetaremos tus preferencias al pie de la letra",
    type: "text",
    optional: true,
    placeholder: "Ej: política, religión, relaciones personales...",
  },
];

/** Keys whose visibility toggle is meaningful (skip internal tone prefs) */
const VISIBILITY_ELIGIBLE_KEYS = new Set([
  "hobbies",
  "deporte",
  "equipo_artista",
  "figuras_inspiradoras",
  "obra_favorita",
  "meta_anio",
]);

interface Props {
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
  initialPublicKeys?: string[];
}

export function PreferenceQuestionnaire({ open, onClose, onCompleted, initialPublicKeys = [] }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [publicKeys, setPublicKeys] = useState<string[]>(initialPublicKeys);
  const [saving, setSaving] = useState(false);

  // Only show questions whose showIf condition (if any) is satisfied
  const visibleQuestions = useMemo(
    () => QUESTIONS.filter((q) => !q.showIf || q.showIf(answers)),
    [answers],
  );

  const currentQ = visibleQuestions[step] ?? visibleQuestions[0];
  const progress = ((step + 1) / visibleQuestions.length) * 100;
  const isLastStep = step === visibleQuestions.length - 1;

  const getCurrentValue = (): AnswerValue =>
    answers[currentQ.key] ?? (currentQ.type === "multiselect" ? [] : "");

  const handleTextAnswer = (value: string) =>
    setAnswers((prev) => ({ ...prev, [currentQ.key]: value }));

  const handleSelectAnswer = (value: string) =>
    setAnswers((prev) => ({ ...prev, [currentQ.key]: value }));

  const handleMultiSelectToggle = (option: string) => {
    const current = (answers[currentQ.key] as string[]) ?? [];
    const next = current.includes(option)
      ? current.filter((o) => o !== option)
      : [...current, option];
    setAnswers((prev) => ({ ...prev, [currentQ.key]: next }));
  };

  const handleScaleAnswer = (value: number) =>
    setAnswers((prev) => ({ ...prev, [currentQ.key]: String(value) }));

  const togglePublic = (key: string) =>
    setPublicKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const canProceed = (): boolean => {
    if (currentQ.optional) return true;
    const val = answers[currentQ.key];
    if (currentQ.type === "multiselect") return Array.isArray(val) && val.length > 0;
    return typeof val === "string" && val.trim().length > 0;
  };

  const handleNext = () => {
    if (step < visibleQuestions.length - 1) setStep(step + 1);
  };
  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleSubmit = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user.id)
        .single();

      const now = new Date().toISOString();
      const { error } = await supabase.from("user_preferences").upsert(
        {
          user_id: user.id,
          organization_id: profile?.organization_id,
          answers,
          public_answers: publicKeys,
          completed_at: now,
          updated_at: now,
        } as any,
        { onConflict: "user_id" }
      );

      if (error) throw error;

      toast.success("¡Gracias! Kawiil ahora te conoce mejor 🎉");
      onCompleted();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      toast.error("Error al guardar: " + msg);
    } finally {
      setSaving(false);
    }
  };

  const isPublicEligible = VISIBILITY_ELIGIBLE_KEYS.has(currentQ.key);
  const isPublic = publicKeys.includes(currentQ.key);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Kawiil quiere conocerte
        </DialogTitle>
        <DialogDescription>
          Responde para que tus frases diarias sean realmente tuyas. Menos de 3 minutos.
        </DialogDescription>

        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Pregunta {step + 1} de {visibleQuestions.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        <div className="space-y-3 min-h-[180px]">
          <div>
            <Label className="text-sm font-medium leading-snug">{currentQ.label}</Label>
            {currentQ.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{currentQ.description}</p>
            )}
            {currentQ.optional && (
              <span className="ml-2 text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                opcional
              </span>
            )}
          </div>

          {currentQ.type === "multiselect" && (
            <MultiSelectInput
              options={(currentQ as MultiSelectQuestion).options}
              selected={(getCurrentValue() as string[]) ?? []}
              onToggle={handleMultiSelectToggle}
            />
          )}

          {currentQ.type === "select" && (
            <SelectInput
              options={(currentQ as SelectQuestion).options}
              value={(getCurrentValue() as string) ?? ""}
              onSelect={handleSelectAnswer}
            />
          )}

          {currentQ.type === "text" && (
            <Input
              value={(getCurrentValue() as string) ?? ""}
              onChange={(e) => handleTextAnswer(e.target.value)}
              placeholder={(currentQ as TextQuestion).placeholder}
            />
          )}

          {currentQ.type === "textarea" && (
            <Textarea
              value={(getCurrentValue() as string) ?? ""}
              onChange={(e) => handleTextAnswer(e.target.value)}
              placeholder={(currentQ as TextQuestion).placeholder}
              rows={3}
            />
          )}

          {currentQ.type === "scale" && (
            <ScaleInput
              value={parseInt((getCurrentValue() as string) ?? "0", 10) || 0}
              leftLabel={(currentQ as ScaleQuestion).leftLabel}
              rightLabel={(currentQ as ScaleQuestion).rightLabel}
              onSelect={handleScaleAnswer}
            />
          )}

          {isPublicEligible && (
            <button
              type="button"
              onClick={() => togglePublic(currentQ.key)}
              className={cn(
                "flex items-center gap-1.5 text-xs transition-colors mt-1",
                isPublic
                  ? "text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isPublic
                ? <Eye className="h-3 w-3 shrink-0" />
                : <EyeOff className="h-3 w-3 shrink-0" />}
              {isPublic ? "Visible en mi perfil" : "Solo yo · toca para hacerlo público"}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={handleBack} disabled={step === 0}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Anterior
          </Button>

          {isLastStep ? (
            <Button size="sm" onClick={handleSubmit} disabled={saving || !canProceed()}>
              {saving
                ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                : <Sparkles className="h-4 w-4 mr-1" />}
              Finalizar
            </Button>
          ) : (
            <Button size="sm" onClick={handleNext} disabled={!canProceed()}>
              Siguiente
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MultiSelectInput({
  options, selected, onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (opt: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {active && <Check className="h-3 w-3 shrink-0" />}
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function SelectInput({
  options, value, onSelect,
}: {
  options: string[];
  value: string;
  onSelect: (opt: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onSelect(opt)}
          className={cn(
            "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
            value === opt
              ? "border-primary bg-primary/10 text-primary font-medium"
              : "border-border bg-background text-foreground hover:border-primary/40",
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function ScaleInput({
  value, leftLabel, rightLabel, onSelect,
}: {
  value: number;
  leftLabel: string;
  rightLabel: string;
  onSelect: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onSelect(n)}
            className={cn(
              "h-10 flex-1 rounded-full border text-sm font-semibold transition-colors",
              value === n
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground px-1">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}
