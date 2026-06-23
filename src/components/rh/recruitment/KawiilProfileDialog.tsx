import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { useOrgCulturalProfile, useSetOrgCulturalProfile } from "@/hooks/useRecruitment";

const PLACEHOLDER = `Ej.: Valores de Kawiil (claridad, dueñismo, servicio…), cómo es la persona que prospera aquí, competencias clave, "banderas rojas" culturales, estilo de trabajo esperado…

La IA usa este texto + los requisitos de cada vacante para evaluar qué tanto se adapta cada candidato al analizar su examen psicométrico.`;

/** Editor del "Perfil Kawiil" (cultura/valores) que alimenta el análisis de IA. */
export function KawiilProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: profile = "", isLoading } = useOrgCulturalProfile();
  const save = useSetOrgCulturalProfile();
  const [text, setText] = useState("");

  useEffect(() => {
    if (open) setText(profile);
  }, [open, profile]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Perfil de Kawiil para IA</DialogTitle>
          <DialogDescription>
            Describe la cultura, valores y competencias de Kawiil. La IA lo combina con los
            requisitos de cada vacante para calcular el “fit” de cada candidato.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            className="min-h-[220px] text-sm"
          />
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => save.mutate(text, { onSuccess: () => onOpenChange(false) })}
            disabled={save.isPending || isLoading}
          >
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
