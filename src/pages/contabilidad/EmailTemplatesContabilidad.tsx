import { useMemo, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Badge } from "@/components/ui/badge";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@/components/microsoft/RichTextEditor";
import { toast } from "sonner";
import {
  useAccountingEmailTemplates,
  useCreateAccountingEmailTemplate,
  useUpdateAccountingEmailTemplate,
  useDeleteAccountingEmailTemplate,
  type AccountingEmailTemplate,
} from "@/hooks/useAccountingEmailTemplates";
import {
  ACCOUNTING_TEMPLATE_CATEGORIES,
  ACCOUNTING_TEMPLATE_CATEGORY_LABELS,
  DEFAULT_VARIABLES_BY_CATEGORY,
  isAccountingTemplateCategory,
  parseTemplateVariables,
  type AccountingTemplateCategory,
  type AccountingTemplateVariable,
} from "@/lib/accountingTemplateVariables";
import type { Json } from "@/integrations/supabase/types";

export default function EmailTemplatesContabilidad() {
  const { data: templates = [], isLoading } = useAccountingEmailTemplates();
  const createMutation = useCreateAccountingEmailTemplate();
  const updateMutation = useUpdateAccountingEmailTemplate();
  const deleteMutation = useDeleteAccountingEmailTemplate();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [category, setCategory] = useState<AccountingTemplateCategory>("isn_imss");
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [editorKey, setEditorKey] = useState(0);

  const variablesForCategory = useMemo<AccountingTemplateVariable[]>(() => {
    return DEFAULT_VARIABLES_BY_CATEGORY[category] ?? [];
  }, [category]);

  const reset = () => {
    setEditId(null);
    setName("");
    setSubject("");
    setBodyHtml("");
    setCategory("isn_imss");
    setEditorKey((k) => k + 1);
  };

  const openNew = () => {
    reset();
    setOpen(true);
  };

  const openEdit = (t: AccountingEmailTemplate) => {
    setEditId(t.id);
    setName(t.name);
    setSubject(t.subject);
    setBodyHtml(t.body_html);
    const cat = isAccountingTemplateCategory(t.category) ? t.category : "isn_imss";
    setCategory(cat);
    setEditorKey((k) => k + 1);
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim() || !subject.trim()) {
      toast.error("Nombre y asunto son obligatorios");
      return;
    }
    const variablesForSave = DEFAULT_VARIABLES_BY_CATEGORY[category] ?? [];
    try {
      if (editId) {
        await updateMutation.mutateAsync({
          id: editId,
          name: name.trim(),
          subject: subject.trim(),
          body_html: bodyHtml,
          category,
          variables: variablesForSave as unknown as Json,
        });
      } else {
        await createMutation.mutateAsync({
          name: name.trim(),
          subject: subject.trim(),
          body_html: bodyHtml,
          category,
          variables: variablesForSave as unknown as Json,
        });
      }
      toast.success("Plantilla guardada");
      setOpen(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Desactivar esta plantilla?")) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success("Plantilla desactivada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al desactivar");
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Plantillas de correo – Contabilidad
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Estas plantillas aparecen en el compositor de Microsoft 365 al
            redactar un correo. Usa variables como{" "}
            <code className="text-[11px]">{"{{razon_social}}"}</code>,{" "}
            <code className="text-[11px]">{"{{monto_isn}}"}</code>, etc.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) reset();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4 mr-1" />
              Nueva plantilla
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editId ? "Editar plantilla" : "Nueva plantilla"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Nombre interno</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej. ISN e IMSS"
                  />
                </div>
                <div>
                  <Label>Categoría</Label>
                  <Select
                    value={category}
                    onValueChange={(v) =>
                      setCategory(v as AccountingTemplateCategory)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNTING_TEMPLATE_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {ACCOUNTING_TEMPLATE_CATEGORY_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Asunto</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Asunto del correo"
                />
              </div>
              <div>
                <Label>Cuerpo</Label>
                <RichTextEditor
                  key={editorKey}
                  ref={editorRef}
                  initialHtml={bodyHtml}
                  placeholder="Escribe el cuerpo de la plantilla…"
                  onHtmlChange={(html) => setBodyHtml(html)}
                  className="min-h-[260px]"
                />
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <p className="text-xs font-medium mb-2">
                  Variables disponibles para «
                  {ACCOUNTING_TEMPLATE_CATEGORY_LABELS[category]}»:
                </p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {variablesForCategory.map((v) => (
                    <li key={v.name} className="flex items-center gap-2">
                      <code className="text-[11px] bg-background border rounded px-1 py-0.5">{`{{${v.name}}}`}</code>
                      <span>{v.label}</span>
                      {v.bold ? (
                        <Badge variant="secondary" className="text-[10px]">
                          negritas
                        </Badge>
                      ) : null}
                      <span className="text-[10px] uppercase tracking-wide">
                        {v.type}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Los valores en negritas se aplican automáticamente al insertar
                  la plantilla desde el compositor.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={save}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {editId ? "Guardar cambios" : "Crear plantilla"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Aún no hay plantillas contables. Crea la primera con «Nueva
            plantilla».
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => {
            const cat = isAccountingTemplateCategory(t.category)
              ? ACCOUNTING_TEMPLATE_CATEGORY_LABELS[t.category]
              : t.category;
            const vars = parseTemplateVariables(t.variables);
            return (
              <Card key={t.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-sm truncate">
                        {t.name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {cat}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(t)}
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleDelete(t.id)}
                        title="Desactivar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs font-medium truncate">{t.subject}</p>
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none text-xs mt-2 max-h-32 overflow-hidden line-clamp-6 [&_p]:my-1"
                    dangerouslySetInnerHTML={{ __html: t.body_html }}
                  />
                  {vars.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {vars.map((v) => (
                        <Badge
                          key={v.name}
                          variant="outline"
                          className="text-[10px]"
                        >
                          {v.name}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
