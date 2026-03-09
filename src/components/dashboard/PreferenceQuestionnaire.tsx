import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Sparkles, Clock, ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import { nowMX } from "@/lib/dateUtils";

interface Question {
  key: string;
  label: string;
  type: "select" | "text" | "textarea";
  options?: string[];
  placeholder?: string;
}

const QUESTIONS: Question[] = [
  {
    key: "libro_genero",
    label: "¿Qué género literario prefieres?",
    type: "select",
    options: ["Ficción", "No ficción", "Ciencia ficción", "Fantasía", "Historia", "Biografías", "Desarrollo personal", "Poesía", "Thriller/Misterio", "Romance", "No leo mucho"],
  },
  {
    key: "libro_favorito",
    label: "¿Cuál es tu libro o autor favorito?",
    type: "text",
    placeholder: "Ej: Cien años de soledad, Gabriel García Márquez",
  },
  {
    key: "musica_genero",
    label: "¿Qué género musical disfrutas más?",
    type: "select",
    options: ["Rock", "Pop", "Clásica", "Jazz", "Reggaetón", "Hip-Hop/Rap", "Electrónica", "Regional mexicano", "Indie/Alternativo", "R&B/Soul", "Metal", "Otro"],
  },
  {
    key: "musica_artista",
    label: "¿Tu artista o banda favorita?",
    type: "text",
    placeholder: "Ej: Café Tacvba, Radiohead, Bad Bunny",
  },
  {
    key: "tv_genero",
    label: "¿Qué tipo de series o películas te gustan?",
    type: "select",
    options: ["Drama", "Comedia", "Sci-Fi", "Thriller", "Documentales", "Animación", "Terror", "Acción", "Romance", "Fantasía"],
  },
  {
    key: "tv_favorita",
    label: "¿Tu serie o película favorita?",
    type: "text",
    placeholder: "Ej: Breaking Bad, El Padrino, Studio Ghibli",
  },
  {
    key: "hobby",
    label: "¿Qué actividad disfrutas en tu tiempo libre?",
    type: "text",
    placeholder: "Ej: Correr, cocinar, videojuegos, jardinería...",
  },
  {
    key: "motivacion",
    label: "¿Qué te motiva más en el trabajo?",
    type: "select",
    options: ["Aprender cosas nuevas", "Resolver problemas complejos", "Ayudar a otros", "Alcanzar metas", "Trabajar en equipo", "Creatividad", "Reconocimiento", "Estabilidad"],
  },
  {
    key: "humor",
    label: "¿Con qué tipo de humor conectas más?",
    type: "select",
    options: ["Sarcástico/Irónico", "Absurdo/Random", "Humor negro", "Sutil/Inteligente", "Payasadas/Físico", "Memes", "No tengo preferencia"],
  },
  {
    key: "personaje_inspirador",
    label: "¿Algún personaje (real o ficticio) que te inspire?",
    type: "text",
    placeholder: "Ej: Frida Kahlo, Iron Man, Marie Curie...",
  },
  {
    key: "lugar_favorito",
    label: "¿Tu lugar favorito para recargar energía?",
    type: "text",
    placeholder: "Ej: La playa, las montañas, un café, mi casa...",
  },
  {
    key: "valor_importante",
    label: "¿Qué valor consideras más importante en tu vida?",
    type: "select",
    options: ["Honestidad", "Lealtad", "Libertad", "Familia", "Justicia", "Creatividad", "Perseverancia", "Compasión", "Valentía", "Gratitud"],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
}

export function PreferenceQuestionnaire({ open, onClose, onCompleted }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const now = useMemo(() => nowMX(), []);

  const deadline = new Date("2026-03-24T23:59:59-06:00");
  const timeLeft = deadline.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(timeLeft / (1000 * 60 * 60 * 24)));

  const currentQ = QUESTIONS[step];
  const progress = ((step + 1) / QUESTIONS.length) * 100;

  const handleAnswer = (value: string) => {
    setAnswers((prev) => ({ ...prev, [currentQ.key]: value }));
  };

  const handleNext = () => {
    if (step < QUESTIONS.length - 1) setStep(step + 1);
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

      const { error } = await supabase.from("user_preferences").upsert(
        {
          user_id: user.id,
          organization_id: profile?.organization_id,
          answers,
          completed_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (error) throw error;
      toast.success("¡Gracias! Kawiil ahora te conoce mejor 🎉");
      onCompleted();
      onClose();
    } catch (e: any) {
      toast.error("Error al guardar: " + (e.message || "Error desconocido"));
    } finally {
      setSaving(false);
    }
  };

  const isLastStep = step === QUESTIONS.length - 1;
  const currentAnswer = answers[currentQ?.key] || "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Kawiil quiere conocerte
        </DialogTitle>
        <DialogDescription>
          Responde estas preguntas para personalizar tu experiencia. Tus frases diarias serán únicas.
        </DialogDescription>

        {/* Countdown */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>
            {daysLeft > 0
              ? `Disponible por ${daysLeft} día${daysLeft !== 1 ? "s" : ""} más`
              : "¡Último día para responder!"}
          </span>
        </div>

        {/* Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Pregunta {step + 1} de {QUESTIONS.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        {/* Question */}
        <div className="space-y-3 min-h-[120px]">
          <Label className="text-sm font-medium">{currentQ.label}</Label>

          {currentQ.type === "select" && (
            <Select value={currentAnswer} onValueChange={handleAnswer}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecciona una opción" />
              </SelectTrigger>
              <SelectContent>
                {currentQ.options!.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {currentQ.type === "text" && (
            <Input
              value={currentAnswer}
              onChange={(e) => handleAnswer(e.target.value)}
              placeholder={currentQ.placeholder}
            />
          )}

          {currentQ.type === "textarea" && (
            <Textarea
              value={currentAnswer}
              onChange={(e) => handleAnswer(e.target.value)}
              placeholder={currentQ.placeholder}
              rows={3}
            />
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            disabled={step === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Anterior
          </Button>

          {isLastStep ? (
            <Button size="sm" onClick={handleSubmit} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              Finalizar
            </Button>
          ) : (
            <Button size="sm" onClick={handleNext}>
              Siguiente
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
