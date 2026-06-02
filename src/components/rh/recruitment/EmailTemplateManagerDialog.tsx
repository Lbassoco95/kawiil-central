import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Save } from "lucide-react";
import {
  TEMPLATE_VARIABLES,
  type EmailTemplate,
} from "@/lib/recruitment";
import {
  useEmailTemplates,
  useCreateEmailTemplate,
  useUpdateEmailTemplate,
  useDeleteEmailTemplate,
} from "@/hooks/useRecruitment";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function VariableHelp() {
  return (
    <div className="flex flex-wrap gap-1">
      {TEMPLATE_VARIABLES.map((v) => (
        <Badge key={v.key} variant="secondary" className="text-[10px]" title={v.help}>{v.key}</Badge>
      ))}
    </div>
  );
}

function TemplateRow({ tpl }: { tpl: EmailTemplate }) {
  const update = useUpdateEmailTemplate();
  const remove = useDeleteEmailTemplate();
  const [name, setName] = useState(tpl.name);
  const [subject, setSubject] = useState(tpl.subject);
  const [body, setBody] = useState(tpl.body);
  const dirty = name !== tpl.name || subject !== tpl.subject || body !== tpl.body;

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-1.5">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm font-medium" />
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-red-600" onClick={() => remove.mutate({ id: tpl.id })}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto" className="h-8 text-sm" />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className="text-sm" />
      {dirty && (
        <div className="flex justify-end">
          <Button size="sm" disabled={!name.trim() || update.isPending}
            onClick={() => update.mutate({ id: tpl.id, name: name.trim(), subject, body })}>
            <Save className="mr-1.5 h-3.5 w-3.5" /> Guardar
          </Button>
        </div>
      )}
    </div>
  );
}

export function EmailTemplateManagerDialog({ open, onOpenChange }: Props) {
  const { data: templates = [] } = useEmailTemplates();
  const create = useCreateEmailTemplate();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  function resetNew() {
    setName(""); setSubject(""); setBody(""); setAdding(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Plantillas de correo</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Variables disponibles (se sustituyen al elegir la plantilla):</p>
        <VariableHelp />

        <div className="space-y-3">
          {templates.map((t) => <TemplateRow key={t.id} tpl={t} />)}

          {adding ? (
            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la plantilla" className="h-8 text-sm font-medium" />
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto" className="h-8 text-sm" />
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="Cuerpo del mensaje…" className="text-sm" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={resetNew}>Cancelar</Button>
                <Button size="sm" disabled={!name.trim() || create.isPending}
                  onClick={() => create.mutate({ name: name.trim(), subject, body }, { onSuccess: resetNew })}>
                  Crear
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Nueva plantilla
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
