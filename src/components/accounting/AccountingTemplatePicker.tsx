import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  useAccountingEmailTemplates,
  type AccountingEmailTemplate,
} from "@/hooks/useAccountingEmailTemplates";
import {
  ACCOUNTING_TEMPLATE_CATEGORY_LABELS,
  DEFAULT_VARIABLES_BY_CATEGORY,
  applyAccountingTemplate,
  isAccountingTemplateCategory,
  parseTemplateVariables,
  type AccountingTemplateVariable,
} from "@/lib/accountingTemplateVariables";

export interface AccountingTemplatePickerApplied {
  subject: string;
  bodyHtml: string;
  template: AccountingEmailTemplate;
}

interface AccountingTemplatePickerProps {
  onApply: (result: AccountingTemplatePickerApplied) => void;
  defaults?: Record<string, string>;
  triggerLabel?: string;
  buttonVariant?: "ghost" | "outline" | "secondary";
}

export function AccountingTemplatePicker({
  onApply,
  defaults,
  triggerLabel = "Plantillas contables",
  buttonVariant = "ghost",
}: AccountingTemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const { data: templates = [], isLoading } = useAccountingEmailTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const variables = useMemo<AccountingTemplateVariable[]>(() => {
    if (!selected) return [];
    const fromDb = parseTemplateVariables(selected.variables);
    if (fromDb.length > 0) return fromDb;
    if (isAccountingTemplateCategory(selected.category)) {
      return DEFAULT_VARIABLES_BY_CATEGORY[selected.category];
    }
    return [];
  }, [selected]);

  useEffect(() => {
    if (!selected) {
      setValues({});
      return;
    }
    const next: Record<string, string> = {};
    for (const v of variables) {
      const fromDefaults = defaults?.[v.name];
      next[v.name] = fromDefaults ?? "";
    }
    setValues(next);
  }, [selected, variables, defaults]);

  const handleApply = () => {
    if (!selected) return;
    const result = applyAccountingTemplate({
      subject: selected.subject,
      bodyHtml: selected.body_html,
      variables,
      values,
    });
    if (result.missing.length > 0) {
      toast.error(
        `Faltan datos: ${result.missing.map((v) => v.label).join(", ")}`,
      );
      return;
    }
    onApply({
      subject: result.subject,
      bodyHtml: result.bodyHtml,
      template: selected,
    });
    setOpen(false);
    setSelectedId(null);
    setValues({});
    toast.success(`Plantilla «${selected.name}» aplicada`);
  };

  const handleClose = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSelectedId(null);
      setValues({});
    }
  };

  return (
    <Popover open={open} onOpenChange={handleClose}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={buttonVariant}
          size="sm"
          className="gap-1 text-xs h-7 px-2"
          onMouseDown={(e) => e.preventDefault()}
        >
          <FileText className="h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[360px] max-h-[70vh] overflow-y-auto p-4 space-y-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-3.5 w-3.5 text-blue-600" />
          Plantillas del área contable
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Cargando plantillas…
          </div>
        ) : templates.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No hay plantillas configuradas. Pide al equipo contable crearlas en{" "}
            <span className="font-medium">/contabilidad/plantillas</span>.
          </p>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs">Plantilla</Label>
            <Select
              value={selectedId ?? ""}
              onValueChange={(v) => setSelectedId(v)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Selecciona una plantilla" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex flex-col">
                      <span className="text-sm">{t.name}</span>
                      {isAccountingTemplateCategory(t.category) ? (
                        <span className="text-[10px] text-muted-foreground">
                          {ACCOUNTING_TEMPLATE_CATEGORY_LABELS[t.category]}
                        </span>
                      ) : null}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selected && variables.length > 0 && (
          <div className="space-y-2 pt-1 border-t border-border">
            <p className="text-xs text-muted-foreground pt-2">
              Completa los campos. Los marcados se insertarán en{" "}
              <strong>negritas</strong>.
            </p>
            {variables.map((v) => (
              <div key={v.name} className="space-y-1">
                <Label htmlFor={`tpl-var-${v.name}`} className="text-xs">
                  {v.label}
                  {v.bold ? (
                    <span className="ml-1 text-[10px] text-blue-600 font-semibold">
                      (negritas)
                    </span>
                  ) : null}
                  {v.required ? (
                    <span className="ml-1 text-red-500">*</span>
                  ) : null}
                </Label>
                <Input
                  id={`tpl-var-${v.name}`}
                  type={
                    v.type === "date"
                      ? "date"
                      : v.type === "currency"
                      ? "number"
                      : "text"
                  }
                  step={v.type === "currency" ? "0.01" : undefined}
                  inputMode={v.type === "currency" ? "decimal" : undefined}
                  placeholder={
                    v.type === "currency"
                      ? "Ej. 1234.56"
                      : v.type === "date"
                      ? ""
                      : `Ej. ${v.label}`
                  }
                  value={values[v.name] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [v.name]: e.target.value }))
                  }
                  className="h-9 text-sm"
                />
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleClose(false)}
              >
                Cancelar
              </Button>
              <Button type="button" size="sm" onClick={handleApply}>
                Aplicar plantilla
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
