import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Search, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  useClientsForEmail,
  useDebouncedValue,
  type ClientForEmail,
} from "@/hooks/useClientsForEmail";
import {
  ACCOUNTING_TEMPLATE_CATEGORY_LABELS,
  DEFAULT_VARIABLES_BY_CATEGORY,
  applyAccountingTemplate,
  isAccountingTemplateCategory,
  parseTemplateVariables,
  supportsCurrencyMode,
  type AccountingTemplateVariable,
  type CurrencyMode,
} from "@/lib/accountingTemplateVariables";

export interface AccountingTemplatePickerApplied {
  subject: string;
  bodyHtml: string;
  template: AccountingEmailTemplate;
}

export interface AccountingTemplatePickerClient {
  id: string;
  name: string;
  email: string | null;
  rfc: string | null;
}

interface AccountingTemplatePickerProps {
  onApply: (result: AccountingTemplatePickerApplied) => void;
  onClientSelected?: (client: AccountingTemplatePickerClient) => void;
  defaults?: Record<string, string>;
  triggerLabel?: string;
  buttonVariant?: "ghost" | "outline" | "secondary";
}

export function AccountingTemplatePicker({
  onApply,
  onClientSelected,
  defaults,
  triggerLabel = "Plantillas contables",
  buttonVariant = "ghost",
}: AccountingTemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const { data: templates = [], isLoading } = useAccountingEmailTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, CurrencyMode>>({});

  const [clientQuery, setClientQuery] = useState("");
  const [selectedClient, setSelectedClient] =
    useState<AccountingTemplatePickerClient | null>(null);
  const [showClientList, setShowClientList] = useState(false);
  const debouncedQuery = useDebouncedValue(clientQuery, 180);
  const { data: clientResults = [], isFetching: isSearchingClients } =
    useClientsForEmail(debouncedQuery);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

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
      setModes({});
      return;
    }
    const nextValues: Record<string, string> = {};
    const nextModes: Record<string, CurrencyMode> = {};
    for (const v of variables) {
      const fromDefaults = defaults?.[v.name];
      nextValues[v.name] = fromDefaults ?? "";
      if (supportsCurrencyMode(v)) nextModes[v.name] = "pago";
    }
    setValues(nextValues);
    setModes(nextModes);
  }, [selected, variables, defaults]);

  // Cierra la lista de clientes al hacer click fuera.
  useEffect(() => {
    if (!showClientList) return;
    const handler = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setShowClientList(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showClientList]);

  const handlePickClient = (c: ClientForEmail) => {
    const client: AccountingTemplatePickerClient = {
      id: c.id,
      name: c.name,
      email: c.email,
      rfc: c.rfc,
    };
    setSelectedClient(client);
    setClientQuery(c.name);
    setShowClientList(false);
    setValues((prev) => ({
      ...prev,
      razon_social: c.name,
      rfc: c.rfc ?? prev.rfc ?? "",
    }));
    onClientSelected?.(client);
  };

  const clearClient = () => {
    setSelectedClient(null);
    setClientQuery("");
    setShowClientList(false);
  };

  const handleApply = () => {
    if (!selected) return;
    const result = applyAccountingTemplate({
      subject: selected.subject,
      bodyHtml: selected.body_html,
      variables,
      values,
      modes,
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
    setModes({});
    toast.success(`Plantilla «${selected.name}» aplicada`);
  };

  const handleClose = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSelectedId(null);
      setValues({});
      setModes({});
      setClientQuery("");
      setSelectedClient(null);
      setShowClientList(false);
    }
  };

  const defaultsRazonSocial = defaults?.razon_social?.trim() ?? "";

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
        className="w-[400px] max-h-[75vh] overflow-y-auto p-4 space-y-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-3.5 w-3.5 text-blue-600" />
          Plantillas del área contable
        </div>

        {/* Buscador de cliente */}
        <div className="space-y-1" ref={searchContainerRef}>
          <Label className="text-xs">Cliente</Label>
          {selectedClient ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-sm truncate">
                  <User className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                  <span className="truncate">{selectedClient.name}</span>
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {selectedClient.rfc ?? "sin RFC"}
                  {selectedClient.email ? ` · ${selectedClient.email}` : ""}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={clearClient}
              >
                Cambiar
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
              <Input
                value={clientQuery}
                onChange={(e) => {
                  setClientQuery(e.target.value);
                  setShowClientList(true);
                }}
                onFocus={() => setShowClientList(true)}
                placeholder={
                  defaultsRazonSocial
                    ? `Actual: ${defaultsRazonSocial}`
                    : "Busca por nombre o RFC…"
                }
                className="h-9 text-sm pl-7"
              />
              {showClientList && debouncedQuery.trim().length >= 2 ? (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border bg-popover shadow-md max-h-64 overflow-y-auto">
                  {isSearchingClients ? (
                    <div className="p-2 text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Buscando…
                    </div>
                  ) : clientResults.length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground">
                      Sin resultados.
                    </div>
                  ) : (
                    clientResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-2 py-1.5 hover:bg-accent transition-colors"
                        onClick={() => handlePickClient(c)}
                      >
                        <div className="text-sm truncate">{c.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {c.rfc ?? "sin RFC"}
                          {c.email ? ` · ${c.email}` : ""}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          )}
          {!selectedClient && defaultsRazonSocial ? (
            <p className="text-[10px] text-muted-foreground">
              Se usará <strong>{defaultsRazonSocial}</strong> si no seleccionas
              otro.
            </p>
          ) : null}
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
            {variables.map((v) => {
              const canSwitchMode = supportsCurrencyMode(v);
              const mode = modes[v.name] ?? "pago";
              const isLoss = canSwitchMode && mode === "perdida";
              const isFavor = canSwitchMode && mode === "favor";
              return (
                <div key={v.name} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`tpl-var-${v.name}`} className="text-xs">
                      {v.label}
                      {v.bold ? (
                        <span className="ml-1 text-[10px] text-blue-600 font-semibold">
                          (negritas)
                        </span>
                      ) : null}
                      {v.required && !isLoss ? (
                        <span className="ml-1 text-red-500">*</span>
                      ) : null}
                    </Label>
                    {isFavor ? (
                      <Badge
                        variant="secondary"
                        className="text-[9px] h-4 px-1.5"
                      >
                        saldo a favor
                      </Badge>
                    ) : null}
                  </div>

                  {canSwitchMode ? (
                    <Select
                      value={mode}
                      onValueChange={(val) =>
                        setModes((prev) => ({
                          ...prev,
                          [v.name]: val as CurrencyMode,
                        }))
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pago">Monto a pagar</SelectItem>
                        <SelectItem value="favor">Saldo a favor</SelectItem>
                        <SelectItem value="perdida">
                          Pérdida / No aplica
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}

                  {!isLoss ? (
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
                        setValues((prev) => ({
                          ...prev,
                          [v.name]: e.target.value,
                        }))
                      }
                      className="h-9 text-sm"
                    />
                  ) : (
                    <p className="text-[10px] text-muted-foreground italic">
                      Esta línea se omitirá del correo.
                    </p>
                  )}
                </div>
              );
            })}
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
