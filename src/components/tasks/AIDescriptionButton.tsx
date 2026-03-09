import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  title: string;
  onGenerated: (description: string) => void;
}

export function AIDescriptionButton({ title, onGenerated }: Props) {
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!title.trim()) {
      toast.error("Escribe primero el título de la tarea");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-chat", {
        body: {
          messages: [
            {
              role: "user",
              content: `Actúa como asistente de redacción de un despacho contable y legal. Genera SOLO una descripción profesional y concisa (máximo 3 oraciones) para esta tarea laboral, sin encabezados ni explicaciones: "${title}"`,
            },
          ],
          simple: true,
        },
      });

      if (error) throw error;

      const text =
        data?.choices?.[0]?.message?.content ||
        data?.content ||
        data?.reply ||
        (typeof data === "string" ? data : null);

      if (text) {
        onGenerated(text.trim());
        toast.success("Descripción generada");
      } else {
        toast.error("No se pudo generar la descripción");
      }
    } catch (err: any) {
      toast.error("Error al generar: " + (err.message || "Intenta de nuevo"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={generate}
      disabled={loading || !title.trim()}
      className="gap-1 text-xs text-muted-foreground hover:text-primary"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      {loading ? "Generando..." : "Redactar con IA"}
    </Button>
  );
}
