import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ACTIVE_SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  usePipelineStages,
  usePipelineAutomations,
  useUpdatePipelineAutomation,
  pipelineQueryKeys,
  type PipelineStage,
} from "@/hooks/usePipeline";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Check,
  Copy,
  Upload,
  FileText,
  GripVertical,
  Sparkles,
  Bot,
  MoveRight,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { KAWIIL_AI_SOFT_BG } from "@/lib/kawiilAi";
import { hexToRgba } from "@/lib/pipelineFormat";

const fnUrl = (name: string) => `${ACTIVE_SUPABASE_URL}/functions/v1/${name}`;

// ─── Stages drag-and-drop ────────────────────────────────────────────────────

function StagePill({ stage }: { stage: PipelineStage }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: hexToRgba(stage.color, 0.14),
    borderColor: hexToRgba(stage.color, 0.5),
    color: stage.color,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm"
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing touch-none"
        aria-label={`Arrastrar ${stage.name}`}
        {...listeners}
        {...attributes}
      >
        <GripVertical className="h-3.5 w-3.5 opacity-60" />
      </button>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden />
      <span>{stage.name}</span>
      <span className="text-[10px] opacity-60 font-normal">({stage.slug})</span>
    </div>
  );
}

function StagesReorder({ stages }: { stages: PipelineStage[] }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<PipelineStage[]>(stages);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setItems(stages);
  }, [stages]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIndex = items.findIndex((s) => s.id === e.active.id);
    const newIndex = items.findIndex((s) => s.id === e.over!.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    setSaving(true);
    try {
      const updates = next.map((s, i) =>
        supabase.from("pipeline_stages").update({ position: i }).eq("id", s.id),
      );
      const results = await Promise.all(updates);
      const firstError = results.find((r) => r.error);
      if (firstError?.error) throw firstError.error;
      await qc.invalidateQueries({ queryKey: pipelineQueryKeys.stages });
      toast.success("Orden actualizado");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar el orden");
      setItems(stages);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        Arrastra para reordenar. Los slugs no cambian (son el contrato con integraciones).
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex flex-wrap gap-2">
            {items.map((s) => (
              <StagePill key={s.id} stage={s} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {saving ? <p className="mt-2 text-[11px] text-muted-foreground">Guardando orden…</p> : null}
    </div>
  );
}

// ─── Webhook + CSV + Automations ─────────────────────────────────────────────

const AUTOMATION_META: Record<string, { title: string; description: string; icon: typeof Bot; accent: string }> = {
  auto_cool_down_14d: {
    title: "Mover a 'Frío' después de 14 días sin actividad",
    description: "Kawiil mueve el lead al stage Frío si nadie escribió, llamó o registró actividad en 14 días.",
    icon: Bot,
    accent: "#3B82F6",
  },
  auto_advance_on_reply: {
    title: "Avanzar etapa cuando el lead responde",
    description: "Cuando un lead responde a un correo del pipeline, lo movemos a la siguiente etapa natural.",
    icon: MoveRight,
    accent: "#10B981",
  },
  auto_score_boost_on_open: {
    title: "Subir score al abrir correo o responder",
    description: "Aumenta el score del lead automáticamente cuando hay señales positivas (apertura, clic, respuesta).",
    icon: TrendingUp,
    accent: "#F59E0B",
  },
};

export default function PipelineSettings() {
  const { data: stages = [], isLoading: sl } = usePipelineStages();
  const { data: automations = [], isLoading: al } = usePipelineAutomations();
  const updateAutomation = useUpdatePipelineAutomation();

  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const webhookUrl = fnUrl("meta-webhook-leads");

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast.success("URL copiada");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      toast.error("Archivo debe ser CSV");
      return;
    }
    if (fileRef.current) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileRef.current.files = dt.files;
    }
    setFileName(file.name);
  };

  const uploadCsv = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      toast.error("Elige un archivo CSV");
      return;
    }
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sesión requerida");
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(fnUrl("import-leads-csv"), {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      toast.success(
        `Importación: ${j.inserted ?? 0} nuevos, ${j.duplicates ?? 0} duplicados, ${j.errors?.length ?? 0} errores`,
      );
      if (fileRef.current) fileRef.current.value = "";
      setFileName(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al importar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl animate-fade-in">
      {/* Webhook */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Webhook Meta (Lead Ads)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">
            Configura esta URL en Meta for Developers → Webhooks → Page → leadgen. Despliega la función{" "}
            <code className="text-xs bg-muted px-1 rounded">meta-webhook-leads</code> con{" "}
            <code className="text-xs bg-muted px-1 rounded">--no-verify-jwt</code>.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button size="sm" variant="outline" onClick={() => void copyWebhook()} className="shrink-0">
              {copied ? <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* CSV */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Importar leads (CSV)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Columnas sugeridas: full_name, email, phone, company_name, campaign_name, meta_lead_id. Se deduplica por
            email o meta_lead_id.
          </p>
          <label
            htmlFor="csv-input"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            className={cn(
              "relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors cursor-pointer",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border/60 bg-muted/30 hover:bg-muted/50",
            )}
          >
            <span
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-full",
                dragOver ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              <Upload className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold">
              {fileName ? fileName : "Arrastra tu CSV aquí o haz clic para seleccionar"}
            </p>
            <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <FileText className="h-3 w-3" />
              Archivo .csv · UTF-8
            </p>
            <input
              id="csv-input"
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="flex justify-end">
            <Button type="button" onClick={() => void uploadCsv()} disabled={busy || !fileName}>
              {busy ? "Importando…" : "Subir CSV"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Etapas */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Etapas del pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          {sl ? <Skeleton className="h-10 w-full" /> : <StagesReorder stages={stages} />}
        </CardContent>
      </Card>

      {/* Automatizaciones IA */}
      <Card>
        <CardHeader
          className="pb-3"
          style={{ background: KAWIIL_AI_SOFT_BG, borderTopLeftRadius: "inherit", borderTopRightRadius: "inherit" }}
        >
          <CardTitle className="text-base inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-sky-500" />
            Automatizaciones IA
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5 font-normal">
            Kawiil trabaja por ti entre etapas. Activa las reglas que prefieras.
          </p>
        </CardHeader>
        <CardContent className="pt-3 space-y-2">
          {al ? (
            <Skeleton className="h-[120px] w-full" />
          ) : automations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Aún no hay automatizaciones disponibles para tu organización.
            </p>
          ) : (
            automations.map((a) => {
              const meta =
                AUTOMATION_META[a.key] ?? {
                  title: a.key,
                  description: "",
                  icon: Bot,
                  accent: "#64748B",
                };
              const Icon = meta.icon;
              return (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-card px-3 py-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: hexToRgba(meta.accent, 0.14), color: meta.accent }}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{meta.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{meta.description}</p>
                    </div>
                  </div>
                  <Switch
                    checked={a.enabled}
                    onCheckedChange={(checked) =>
                      updateAutomation.mutate({ id: a.id, enabled: checked })
                    }
                    disabled={updateAutomation.isPending}
                    className="mt-1 shrink-0"
                  />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
