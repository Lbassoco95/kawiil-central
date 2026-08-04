import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, Check, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AiFeedback } from "@/components/ai/AiFeedback";
import { aiFeedbackKey } from "@/lib/aiFeedbackKey";

interface Props {
  title: string;
  onGenerated: (description: string) => void;
  /** Origen para la calificación de IA. */
  surface?: string;
  /** Etiqueta de la entidad para el prompt (tarea, proyecto, etc.). */
  entityLabel?: string;
}

export function AIDescriptionButton({
  title,
  onGenerated,
  surface = "task_description",
  entityLabel = "tarea",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const generate = async () => {
    if (!title.trim()) {
      toast.error(`Escribe primero el título de la ${entityLabel}`);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-chat", {
        body: {
          messages: [
            {
              role: "user",
              content: `Actúa como asistente de redacción de un despacho contable y legal. Genera SOLO una descripción profesional y concisa (máximo 3 oraciones) para esta ${entityLabel} laboral, sin encabezados ni explicaciones: "${title}"`,
            },
          ],
          simple: true,
          insightLite: true,
        },
      });

      if (error) throw error;

      const text =
        data?.choices?.[0]?.message?.content ||
        data?.content ||
        data?.reply ||
        (typeof data === "string" ? data : null);

      if (text) {
        // No sobrescribimos: mostramos una previsualización para confirmar.
        setDraft(text.trim());
        setOpen(true);
      } else {
        toast.error("No se pudo generar la descripción");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Intenta de nuevo";
      toast.error("Error al generar: " + msg);
    } finally {
      setLoading(false);
    }
  };

  const apply = () => {
    if (draft) onGenerated(draft);
    toast.success("Descripción aplicada");
    setOpen(false);
    setDraft(null);
  };

  const discard = () => {
    setOpen(false);
    setDraft(null);
  };

  return (
    <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : discard())}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.preventDefault();
            if (!open) void generate();
          }}
          disabled={loading || !title.trim()}
          className="gap-1 text-xs text-muted-foreground hover:text-primary"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {loading ? "Generando..." : "Redactar con IA"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Propuesta de la IA</p>
            <span className="text-[10px] text-muted-foreground">Revisa antes de aplicar</span>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/40 p-2 text-xs whitespace-pre-wrap">
            {draft}
          </div>
          <div className="flex items-center justify-between">
            {draft ? (
              <AiFeedback surface={surface} contextKey={aiFeedbackKey(draft)} label={null} align="start" />
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={discard}>
                <X className="h-3.5 w-3.5" /> Descartar
              </Button>
              <Button type="button" size="sm" className="h-7 gap-1 text-xs" onClick={apply}>
                <Check className="h-3.5 w-3.5" /> Usar
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
