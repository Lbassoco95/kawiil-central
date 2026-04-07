import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmailTemplates, pipelineQueryKeys } from "@/hooks/usePipeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import type { TablesInsert } from "@/integrations/supabase/types";

const SOFTLANDING_SUGGESTED_BODY_HTML = `<p>Hola {{nombre}},</p>
<p>Gracias por tu interés en Kawiil. Te adjuntamos el documento <strong>Kawiil – Softlanding Hub en México</strong>, con información sobre cómo acompañamos a empresas en su implantación en el país.</p>
<p>Encontrarás un resumen de servicios, contexto regulatorio y posibles siguientes pasos. Si en <strong>{{empresa}}</strong> quieren profundizar en algún tema concreto, responde a este correo y coordinamos una llamada.</p>
<p>Saludos cordiales,<br/>Equipo Kawiil</p>`;

export default function EmailTemplates() {
  const qc = useQueryClient();
  const { data: templates = [], isLoading } = useEmailTemplates();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [category, setCategory] = useState<string>("first_contact");
  const [defaultAttachmentKey, setDefaultAttachmentKey] = useState<string>("__none__");

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

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) reset();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => reset()}>
              <Plus className="h-4 w-4 mr-1" />
              Nueva plantilla
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editId ? "Editar plantilla" : "Nueva plantilla"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
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
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim() || !subject.trim()}>
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {templates.length === 0 ? (
          <p className="text-muted-foreground text-sm">No hay plantillas. Crea una para usarla en secuencias.</p>
        ) : (
          templates.map((t) => (
            <Card key={t.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-medium">{t.name}</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => openEdit(t)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{t.subject}</p>
                <p className="mt-1 text-xs">{t.category}</p>
                {t.default_attachment_key === "softlanding_hub_mexico" && (
                  <p className="mt-1 text-xs text-foreground">Incluye PDF Softlanding Hub (México)</p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
