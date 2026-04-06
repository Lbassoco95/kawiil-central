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

export function AiMessageFeedback({ messageId }: { messageId: string }) {
  const { user } = useAuth();
  const [done, setDone] = useState(false);
  const [downOpen, setDownOpen] = useState(false);
  const [category, setCategory] = useState<string>("incorrecto");
  const [comment, setComment] = useState("");

  const { data: orgId } = useQuery({
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

  const sendUp = async () => {
    if (!user || !orgId || done) return;
    const { error } = await supabase.from("ai_feedback").insert({
      user_id: user.id,
      organization_id: orgId,
      chat_message_id: messageId,
      rating: "up",
      feedback_category: null,
      feedback_comment: null,
    });
    if (error) {
      if (error.message.includes("duplicate") || error.code === "23505") {
        setDone(true);
        return;
      }
      toast.error(error.message);
      return;
    }
    setDone(true);
    toast.success("Gracias por tu opinión");
  };

  const sendDown = async () => {
    if (!user || !orgId || done) return;
    const { error } = await supabase.from("ai_feedback").insert({
      user_id: user.id,
      organization_id: orgId,
      chat_message_id: messageId,
      rating: "down",
      feedback_category: category,
      feedback_comment: comment.trim() || null,
    });
    if (error) {
      if (error.message.includes("duplicate") || error.code === "23505") {
        setDone(true);
        setDownOpen(false);
        return;
      }
      toast.error(error.message);
      return;
    }
    setDone(true);
    setDownOpen(false);
    toast.success("Gracias, ayudas a mejorar el asistente");
  };

  return (
    <div className="flex items-center gap-1 mt-1.5 ml-10 opacity-70 hover:opacity-100 transition-opacity">
      <span className="text-[10px] text-muted-foreground mr-1">¿Útil?</span>
      <button
        type="button"
        disabled={done}
        className={cn("p-1 rounded-md hover:bg-secondary/80", done && "pointer-events-none opacity-40")}
        aria-label="Respuesta útil"
        onClick={() => void sendUp()}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <Popover open={downOpen} onOpenChange={setDownOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={done}
            className={cn("p-1 rounded-md hover:bg-secondary/80", done && "pointer-events-none opacity-40")}
            aria-label="Respuesta poco útil"
            onClick={(e) => {
              e.preventDefault();
              if (!done) setDownOpen(true);
            }}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start">
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
