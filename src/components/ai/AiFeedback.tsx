import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DOWN_CATEGORIES = [
  { value: "incorrecto", label: "Incorrecto o impreciso" },
  { value: "incompleto", label: "Incompleto" },
  { value: "tono", label: "Tono o estilo" },
  { value: "alucinacion", label: "Inventó datos" },
  { value: "otro", label: "Otro" },
] as const;

/** Query compartida (cacheada) del organization_id del usuario actual. */
function useFeedbackOrgId() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ai-feedback-org", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data?.organization_id as string | null;
    },
    enabled: !!user,
  });
}

export interface AiFeedbackProps {
  /** Origen de la salida de IA (ej. "task_description", "project_briefing"). */
  surface: string;
  /** Identificador de la salida dentro del surface (id de tarea, hash, etc.). */
  contextKey?: string | null;
  /** Solo para el chat: id del mensaje. Si se pasa, tiene prioridad. */
  chatMessageId?: string | null;
  /** Texto antes de los pulgares. Pon null para ocultarlo. */
  label?: string | null;
  /** Alineación del popover de "¿qué falló?". */
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * Calificación 👍 / 👎 reutilizable para CUALQUIER salida de IA.
 * Registra en public.ai_feedback (chat_message_id para chat, o surface+context_key).
 */
export function AiFeedback({
  surface,
  contextKey = null,
  chatMessageId = null,
  label = "¿Útil?",
  align = "start",
  className,
}: AiFeedbackProps) {
  const { user } = useAuth();
  const { data: orgId } = useFeedbackOrgId();
  const [done, setDone] = useState<null | "up" | "down">(null);
  const [downOpen, setDownOpen] = useState(false);
  const [category, setCategory] = useState<string>("incorrecto");
  const [comment, setComment] = useState("");

  const baseRow = () => ({
    user_id: user!.id,
    organization_id: orgId!,
    chat_message_id: chatMessageId,
    surface,
    context_key: chatMessageId ? null : contextKey,
  });

  const isDuplicate = (error: { message?: string; code?: string }) =>
    (error.message?.includes("duplicate") ?? false) || error.code === "23505";

  const sendUp = async () => {
    if (!user || !orgId || done) return;
    const { error } = await supabase.from("ai_feedback").insert({
      ...baseRow(),
      rating: "up",
      feedback_category: null,
      feedback_comment: null,
    });
    if (error) {
      if (isDuplicate(error)) {
        setDone("up");
        return;
      }
      toast.error(error.message);
      return;
    }
    setDone("up");
    toast.success("Gracias por tu opinión");
  };

  const sendDown = async () => {
    if (!user || !orgId || done) return;
    const { error } = await supabase.from("ai_feedback").insert({
      ...baseRow(),
      rating: "down",
      feedback_category: category,
      feedback_comment: comment.trim() || null,
    });
    if (error) {
      if (isDuplicate(error)) {
        setDone("down");
        setDownOpen(false);
        return;
      }
      toast.error(error.message);
      return;
    }
    setDone("down");
    setDownOpen(false);
    toast.success("Gracias, ayudas a mejorar el asistente");
  };

  return (
    <div className={cn("flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity", className)}>
      {label && <span className="text-[10px] text-muted-foreground mr-1">{label}</span>}
      <button
        type="button"
        disabled={!!done}
        className={cn(
          "p-1 rounded-md hover:bg-secondary/80",
          done === "up" && "text-primary",
          done && "pointer-events-none",
          done && done !== "up" && "opacity-40",
        )}
        aria-label="Respuesta útil"
        onClick={() => void sendUp()}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <Popover open={downOpen} onOpenChange={setDownOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={!!done}
            className={cn(
              "p-1 rounded-md hover:bg-secondary/80",
              done === "down" && "text-destructive",
              done && "pointer-events-none",
              done && done !== "down" && "opacity-40",
            )}
            aria-label="Respuesta poco útil"
            onClick={(e) => {
              e.preventDefault();
              if (!done) setDownOpen(true);
            }}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align={align}>
          <div className="space-y-3">
            <p className="text-xs font-medium">¿Qué falló?</p>
            <div className="space-y-1.5">
              <Label className="text-xs">Categoría</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOWN_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value} className="text-xs">
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Comentario (opcional)</Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="text-xs resize-none"
                placeholder="Detalle breve…"
              />
            </div>
            <Button size="sm" className="w-full" onClick={() => void sendDown()}>
              Enviar
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
