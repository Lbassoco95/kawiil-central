import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Firma HTML opcional: precede a inferencia desde Enviados y al fallback de perfil Graph
 * (Graph no expone la firma OWA de forma oficial).
 */
export function OutlookSignatureSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("outlook_signature_html")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      toast.error("No se pudo cargar la firma");
      return;
    }
    setValue(String((data as { outlook_signature_html?: string | null })?.outlook_signature_html || ""));
    setLoaded(true);
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const trimmed = value.trim();
      const { error } = await supabase
        .from("profiles")
        .update({
          outlook_signature_html: trimmed.length ? trimmed : null,
        })
        .eq("user_id", user.id);
      if (error) throw error;
      toast.success(trimmed.length ? "Firma guardada" : "Firma eliminada");
      await queryClient.invalidateQueries({ queryKey: ["outlook-compose-signature"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const clear = () => {
    setValue("");
    void (async () => {
      if (!user?.id) return;
      setSaving(true);
      try {
        const { error } = await supabase
          .from("profiles")
          .update({ outlook_signature_html: null })
          .eq("user_id", user.id);
        if (error) throw error;
        toast.success("Firma personalizada quitada");
        await queryClient.invalidateQueries({ queryKey: ["outlook-compose-signature"] });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      } finally {
        setSaving(false);
      }
    })();
  };

  if (!user) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border/60 bg-muted/15">
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center justify-between gap-2 px-4 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors",
          open && "bg-muted/25",
        )}
      >
        <span>Firma de correo (Outlook / Microsoft 365)</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 px-4 pb-4 max-w-3xl">
          <p className="text-[11px] text-muted-foreground leading-snug">
            Si guardas HTML aquí, se usará al redactar un correo nuevo (antes que la detección por enviados
            o el bloque de perfil). Cópiala desde Outlook: archivo → opciones → correo → firmas, o
            pega el HTML de “Outlook en la web”.
          </p>
          {!loaded ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="outlook-sig-html" className="text-xs">
                  HTML de firma
                </Label>
                <Textarea
                  id="outlook-sig-html"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="<table>...</table> o texto con formato que pegues desde Outlook"
                  className="min-h-[120px] font-mono text-[11px] leading-relaxed"
                  spellCheck={false}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" className="gap-1.5" onClick={() => void save()} disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Guardar
                </Button>
                <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={clear} disabled={saving || !value.trim()}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Quitar firma guardada
                </Button>
              </div>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
