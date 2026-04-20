import { useMemo, useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmailTemplates, useTemplateUsage, pipelineQueryKeys } from "@/hooks/usePipeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PipelineModalHeader } from "@/components/pipeline/modals/PipelineModalHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Plus, Pencil, Sparkles, Mail } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { TablesInsert } from "@/integrations/supabase/types";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";

const SOFTLANDING_SUGGESTED_BODY_HTML = `<p>Hola {{nombre}},</p>
<p>Te adjuntamos en PDF nuestra <strong>propuesta comercial – Softlanding Hub en México</strong>. Incluye alcance, modalidades y siguientes pasos para que <strong>{{empresa}}</strong> pueda revisarlo con el equipo y tomar una decisión informada.</p>
<p>Cuando lo hayan leído, escríbenos si desean <strong>iniciar el proceso</strong> con Kawiil o si prefieren una llamada breve para resolver dudas: basta con responder a este correo.</p>
<p>Saludos cordiales,<br/>Equipo Kawiil</p>`;

const CATEGORY_LABEL: Record<string, string> = {
  first_contact: "Primer contacto",
  follow_up: "Seguimiento",
  proposal: "Propuesta",
  reactivation: "Reactivación",
};

const CATEGORY_ACCENT: Record<string, string> = {
  first_contact: "#3B82F6",
  follow_up: "#A855F7",
  proposal: "#F59E0B",
  reactivation: "#EC4899",
};

export default function EmailTemplates() {
  const qc = useQueryClient();
  const { data: templates = [], isLoading } = useEmailTemplates();
  const { data: usageMap = new Map<string, number>() } = useTemplateUsage();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [category, setCategory] = useState<string>("first_contact");
  const [defaultAttachmentKey, setDefaultAttachmentKey] = useState<string>("__none__");

  const [aiOpen, setAiOpen] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const [aiCategory, setAiCategory] = useState<string>("first_contact");
  const [aiTone, setAiTone] = useState<string>("cordial");
  const [aiLoading, setAiLoading] = useState(false);

  const reset = () => {
    setEditId(null);
    setName("");
    setSubject("");
    setBodyHtml("");
    setCategory("first_contact");
    setDefaultAttachmentKey("__none__");
  };

  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data: org } = await supabase.rpc("get_user_org_id", { _user_id: u.user!.id });
      const orgId = org as string;
      const row: TablesInsert<"email_templates"> = {
        organization_id: orgId,
        name: name.trim(),
        subject: subject.trim(),
        body_html: bodyHtml,
        category: category as TablesInsert<"email_templates">["category"],
        default_attachment_key:
          defaultAttachmentKey === "__none__" || defaultAttachmentKey === ""
            ? null
            : defaultAttachmentKey,
        created_by: u.user?.id ?? null,
      };
      if (editId) {
        const { error } = await supabase.from("email_templates").update(row).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("email_templates").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Plantilla guardada");
      void qc.invalidateQueries({ queryKey: pipelineQueryKeys.templates });
      setOpen(false);
      reset();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = (t: (typeof templates)[0]) => {
    setEditId(t.id);
    setName(t.name);
    setSubject(t.subject);
    setBodyHtml(t.body_html);
    setCategory(t.category);
    setDefaultAttachmentKey(t.default_attachment_key || "__none__");
    setOpen(true);
  };

  const generateWithAi = async () => {
    if (!aiBrief.trim()) {
      toast.error("Cuéntame qué debe decir la plantilla");
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-email-draft", {
        body: {
          action: "draft",
          instruction: `Redacta una plantilla de correo HTML reutilizable (usa variables {{nombre}}, {{empresa}} cuando aplique). Propósito: ${CATEGORY_LABEL[aiCategory] ?? aiCategory}. Brief del usuario: ${aiBrief.trim()}`,
          tone: aiTone,
          context: { subject: aiBrief.slice(0, 80), to: "{{email}}" },
        },
      });
      if (error) throw error;
      const text = (data as { text?: string } | null)?.text ?? "";
      if (!text) throw new Error("La IA no devolvió texto");
      // Heurística: primer renglón como asunto si empieza con "Asunto:" o contiene " | "
      let draftSubject = "";
      let draftBody = text;
      const subjectMatch = text.match(/^asunto\s*:\s*(.+)/i);
      if (subjectMatch) {
        draftSubject = subjectMatch[1].trim();
        draftBody = text.replace(subjectMatch[0], "").trim();
      }
      // Envuelve en párrafos si es texto plano
      const html = /<[a-z][^>]*>/i.test(draftBody)
        ? draftBody
        : draftBody
            .split(/\n\s*\n/)
            .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
            .join("\n");
      reset();
      setCategory(aiCategory);
      setSubject(draftSubject || aiBrief.slice(0, 60));
      setBodyHtml(html);
      setName(`${CATEGORY_LABEL[aiCategory] ?? "Plantilla"} IA · ${new Date().toLocaleDateString("es-MX")}`);
      setAiOpen(false);
      setAiBrief("");
      setOpen(true);
      toast.success("Borrador IA listo · revísalo y guarda");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al generar");
    } finally {
      setAiLoading(false);
    }
  };

  const orderedTemplates = useMemo(
    () => [...templates].sort((a, b) => (usageMap.get(b.id) ?? 0) - (usageMap.get(a.id) ?? 0)),
    [templates, usageMap],
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {templates.length} plantilla{templates.length === 1 ? "" : "s"} reutilizable{templates.length === 1 ? "" : "s"} en correos y secuencias.
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="text-white border-0"
            style={{ background: KAWIIL_AI_GRADIENT }}
            onClick={() => setAiOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Generar con IA
          </Button>
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) reset();
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" onClick={() => reset()}>
                <Plus className="h-4 w-4 mr-1" />
                Nueva plantilla
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden p-0 [&>button.absolute]:text-white [&>button.absolute]:hover:bg-white/15 [&>button.absolute]:top-3 [&>button.absolute]:right-3 flex flex-col">
              <PipelineModalHeader
                icon={<FileText className="h-4 w-4" />}
                title={editId ? "Editar plantilla" : "Nueva plantilla"}
                subtitle="Reusable en correos del pipeline"
              />
              <div className="space-y-3 px-4 pb-4 pt-3 sm:px-5 overflow-y-auto">
                <div>
                  <Label>Nombre interno</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label>Asunto (variables: {"{{nombre}}"}, {"{{empresa}}"}…)</Label>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
                <div>
                  <Label>Categoría</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="first_contact">Primer contacto</SelectItem>
                      <SelectItem value="follow_up">Seguimiento</SelectItem>
                      <SelectItem value="proposal">Propuesta</SelectItem>
                      <SelectItem value="reactivation">Reactivación</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Adjunto fijo al enviar</Label>
                  <Select value={defaultAttachmentKey} onValueChange={setDefaultAttachmentKey}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin adjunto del sistema</SelectItem>
                      <SelectItem value="softlanding_hub_mexico">
                        PDF «Softlanding Hub en México»
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    El PDF se adjunta automáticamente al enviar desde el pipeline o la cola de secuencias (no hace falta subirlo a mano).
                  </p>
                  {defaultAttachmentKey === "softlanding_hub_mexico" && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => setBodyHtml(SOFTLANDING_SUGGESTED_BODY_HTML)}
                    >
                      Insertar cuerpo sugerido para este PDF
                    </Button>
                  )}
                </div>
                <div>
                  <Label>HTML</Label>
                  <Textarea rows={10} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} className="font-mono text-xs" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Vista previa aproximada (sin interpolar variables):
                </p>
                <div
                  className="border rounded-md p-3 text-sm max-h-[160px] overflow-auto bg-muted/30 prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: bodyHtml || "<p>(vacío)</p>" }}
                />
              </div>
              <DialogFooter className="px-4 pb-4 sm:px-5">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => save.mutate()}
                  disabled={save.isPending || !name.trim() || !subject.trim()}
                >
                  Guardar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[180px]" />
          ))}
        </div>
      ) : orderedTemplates.length === 0 ? (
        <Card>
          <CardContent className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Todavía no tienes plantillas. Crea una manual o pide a Kawiil que la redacte por ti.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {orderedTemplates.map((t) => {
            const usage = usageMap.get(t.id) ?? 0;
            const accent = CATEGORY_ACCENT[t.category] ?? "#64748B";
            return (
              <Card
                key={t.id}
                className="overflow-hidden border-border/60 transition-colors hover:border-primary/40"
              >
                <CardHeader
                  className="flex flex-row items-start justify-between space-y-0 pb-2"
                  style={{ borderTop: `3px solid ${accent}` }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
                      <span
                        className="inline-flex items-center rounded-full border px-1.5 py-0 text-[9.5px] font-bold uppercase tracking-[0.08em]"
                        style={{
                          color: accent,
                          borderColor: `${accent}40`,
                          backgroundColor: `${accent}14`,
                        }}
                      >
                        {t.category}
                      </span>
                    </div>
                    <h3 className="mt-1 text-sm font-bold leading-tight">{t.name}</h3>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(t)} className="shrink-0 h-7 w-7">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground line-clamp-2">{t.subject}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      Usada {usage}×
                    </span>
                    {t.default_attachment_key === "softlanding_hub_mexico" ? (
                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
                        📎 Softlanding PDF
                      </span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog Generar con IA */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="overflow-hidden p-0">
          <div
            className="px-4 py-3 sm:px-5 text-white"
            style={{ background: KAWIIL_AI_HEADER_BG }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <DialogHeader className="space-y-0.5 flex-1">
                <DialogTitle className="text-base font-bold text-white">Generar plantilla con IA</DialogTitle>
                <p className="text-[11px] text-white/85">Kawiil redacta la base. Tú la pules.</p>
              </DialogHeader>
            </div>
          </div>
          <div className="space-y-3 px-4 pb-4 pt-3 sm:px-5">
            <div>
              <Label>¿Qué debe decir la plantilla?</Label>
              <Textarea
                rows={5}
                value={aiBrief}
                onChange={(e) => setAiBrief(e.target.value)}
                placeholder="Ej: Seguimiento a cliente que no respondió propuesta hace 7 días. Cordial pero directo. Mencionar que el equipo está disponible para resolver dudas por llamada."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Categoría</Label>
                <Select value={aiCategory} onValueChange={setAiCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="first_contact">Primer contacto</SelectItem>
                    <SelectItem value="follow_up">Seguimiento</SelectItem>
                    <SelectItem value="proposal">Propuesta</SelectItem>
                    <SelectItem value="reactivation">Reactivación</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tono</Label>
                <Select value={aiTone} onValueChange={setAiTone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cordial">Cordial</SelectItem>
                    <SelectItem value="formal">Formal</SelectItem>
                    <SelectItem value="directo">Directo</SelectItem>
                    <SelectItem value="consultivo">Consultivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="px-4 pb-4 sm:px-5">
            <Button variant="outline" onClick={() => setAiOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void generateWithAi()}
              disabled={aiLoading || !aiBrief.trim()}
              className="text-white border-0"
              style={{ background: KAWIIL_AI_GRADIENT }}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              {aiLoading ? "Redactando…" : "Generar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
