import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  useG4PorCelula,
  useOrgProfiles,
  useSwitchboardConfig,
  useUpdateSwitchboardConfig,
} from "@/hooks/useConmutador";
import { CELULA_LABELS, type G4PorCelula, type SwitchboardConfig } from "@/lib/conmutador";

const NO_OVERRIDE = "__none__";

export function ConfigEditor() {
  const { data: configs, isLoading } = useSwitchboardConfig();
  const { data: g4s } = useG4PorCelula();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    );
  }
  if (!configs || configs.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay configuración de células.</p>;
  }

  const g4Map = new Map<string, G4PorCelula>((g4s ?? []).map((g) => [g.celula, g]));

  return (
    <div className="space-y-4">
      {configs.map((cfg) => (
        <CelulaConfigCard key={cfg.id} cfg={cfg} g4={g4Map.get(cfg.celula) ?? null} />
      ))}
    </div>
  );
}

function CelulaConfigCard({ cfg, g4 }: { cfg: SwitchboardConfig; g4: G4PorCelula | null }) {
  const update = useUpdateSwitchboardConfig();
  const { data: profiles } = useOrgProfiles();

  const [preguntas, setPreguntas] = useState<string[]>(cfg.preguntas);
  const [slug, setSlug] = useState(cfg.celula_slug ?? "");
  const [voz, setVoz] = useState(cfg.voz ?? "");
  const [promptOverride, setPromptOverride] = useState(cfg.prompt_override ?? "");
  const [override, setOverride] = useState(cfg.g4_override_user_id ?? NO_OVERRIDE);

  // Resincroniza si cambian los datos del servidor.
  useEffect(() => {
    setPreguntas(cfg.preguntas);
    setSlug(cfg.celula_slug ?? "");
    setVoz(cfg.voz ?? "");
    setPromptOverride(cfg.prompt_override ?? "");
    setOverride(cfg.g4_override_user_id ?? NO_OVERRIDE);
  }, [cfg]);

  const save = () => {
    update.mutate({
      id: cfg.id,
      patch: {
        preguntas: preguntas.map((p) => p.trim()).filter(Boolean),
        celula_slug: slug.trim() || null,
        voz: voz.trim() || null,
        prompt_override: promptOverride.trim() || null,
        g4_override_user_id: override === NO_OVERRIDE ? null : override,
      },
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>
            {cfg.celula} · {CELULA_LABELS[cfg.celula]}
          </span>
          {g4?.g4_nombre ? (
            <Badge variant={g4.source === "override" ? "secondary" : "outline"}>
              G4: {g4.g4_nombre}
              {!g4.g4_telefono && " (sin teléfono)"}
              {g4.source === "override" && " · override"}
            </Badge>
          ) : (
            <Badge variant="destructive">Sin G4 asignado</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`slug-${cfg.id}`}>Célula RH (slug)</Label>
            <Input
              id={`slug-${cfg.id}`}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="p. ej. contabilidad"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Override de G4</Label>
            <Select value={override} onValueChange={setOverride}>
              <SelectTrigger>
                <SelectValue placeholder="Usar G4 de RH" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_OVERRIDE}>Usar G4 de RH (por slug)</SelectItem>
                {(profiles ?? []).map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>
                    {p.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`voz-${cfg.id}`}>Voz (ElevenLabs voice_id)</Label>
          <Input
            id={`voz-${cfg.id}`}
            value={voz}
            onChange={(e) => setVoz(e.target.value)}
            placeholder="voice_id (opcional)"
          />
        </div>

        <div className="space-y-2">
          <Label>Preguntas mínimas (ruta estándar)</Label>
          {preguntas.map((q, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={q}
                onChange={(e) =>
                  setPreguntas((arr) => arr.map((v, idx) => (idx === i ? e.target.value : v)))
                }
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setPreguntas((arr) => arr.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPreguntas((arr) => [...arr, ""])}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Agregar pregunta
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`prompt-${cfg.id}`}>Prompt override (opcional)</Label>
          <Textarea
            id={`prompt-${cfg.id}`}
            value={promptOverride}
            onChange={(e) => setPromptOverride(e.target.value)}
            rows={3}
            placeholder="Deja vacío para usar el prompt base"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={update.isPending}>
            <Save className="mr-1.5 h-4 w-4" />
            {update.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
