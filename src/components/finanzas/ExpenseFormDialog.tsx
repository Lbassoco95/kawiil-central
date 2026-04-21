import { useEffect, useState, useCallback, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Sparkles, Loader2, Wallet, X } from "lucide-react";
import {
  Dialog, DialogContent,
} from "@/components/ui/dialog";
import { KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { useCreateExpense } from "@/hooks/useExpenses";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { expensesLimits } from "@/lib/fileIntake/limits";
import {
  DuplicateFileResolutionDialog,
  type DuplicateResolutionChoice,
} from "@/components/shared/DuplicateFileResolutionDialog";
import { useResolveDuplicateFilenames } from "@/hooks/useResolveDuplicateFilenames";
import { fetchAiChatSimpleContent } from "@/lib/fetchAiChatSimple";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const CATEGORY_OPTIONS = [
  { value: "terceros", label: "Gastos por terceros / cliente" },
  { value: "viaticos", label: "Viáticos" },
  { value: "operativo", label: "Gastos operativos internos" },
  { value: "contratacion_externa", label: "Contrataciones externas" },
];

const schema = z.object({
  category: z.string().min(1, "Selecciona una categoría"),
  amount: z.coerce.number().positive("El monto debe ser mayor a 0"),
  currency: z.string().default("MXN"),
  description: z.string().min(1, "La descripción es requerida"),
  client_id: z.string().optional().or(z.literal("")),
  project_id: z.string().optional().or(z.literal("")),
  expense_date: z.string().min(1, "La fecha es requerida"),
  notes: z.string().optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

const MAX_EXPENSE_FILES = expensesLimits.maxFiles;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExpenseFormDialog({ open, onOpenChange }: Props) {
  const createExpense = useCreateExpense();
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupName, setDupName] = useState("");
  const dupResolver = useRef<((c: DuplicateResolutionChoice) => void) | null>(null);
  const [aiClassifying, setAiClassifying] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);

  const duplicatePrompt = useCallback((fileName: string) => {
    setDupName(fileName);
    setDupOpen(true);
    return new Promise<DuplicateResolutionChoice>((resolve) => {
      dupResolver.current = resolve;
    });
  }, []);

  const onDupResolve = useCallback((c: DuplicateResolutionChoice) => {
    setDupOpen(false);
    dupResolver.current?.(c);
    dupResolver.current = null;
  }, []);

  const resolveExpenseDuplicates = useResolveDuplicateFilenames(duplicatePrompt);

  const handlePendingFilesChange = useCallback(
    async (next: File[]) => {
      const resolved = await resolveExpenseDuplicates(next);
      setPendingFiles(resolved);
    },
    [resolveExpenseDuplicates]
  );

  useEffect(() => {
    if (!open) {
      setPendingFiles([]);
      setAiHint(null);
    }
  }, [open]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      category: "",
      amount: 0,
      currency: "MXN",
      description: "",
      client_id: "",
      project_id: "",
      expense_date: new Date().toISOString().slice(0, 10),
      notes: "",
    },
  });

  const watchCategory = form.watch("category");
  const watchClient = form.watch("client_id");

  const clientOptions = clients.map((c) => ({ value: c.id, label: c.name }));
  const projectOptions = projects
    .filter((p: any) => !watchClient || p.client_id === watchClient)
    .map((p: any) => ({ value: p.id, label: p.name }));

  const handleAiClassify = async () => {
    const description = form.getValues("description").trim();
    const notes = form.getValues("notes")?.trim() ?? "";
    const amount = Number(form.getValues("amount") || 0);
    if (!description) {
      toast.error("Escribe primero una descripción para que la IA pueda clasificar.");
      return;
    }
    setAiClassifying(true);
    setAiHint(null);
    try {
      const prompt = `Clasifica el siguiente gasto en UNA categoría de Kawiil. Devuelve SOLO un objeto JSON válido sin texto adicional, con esta forma exacta:
{"category":"terceros|viaticos|operativo|contratacion_externa","reason":"Explica en máximo 80 caracteres por qué."}

Reglas para elegir category:
- "terceros": gasto que se paga POR cuenta de un cliente (notarios, gestoría, derechos, copias, etc.) y luego se le repercute.
- "viaticos": viajes, transporte, hospedaje, comidas en gestiones fuera de oficina.
- "operativo": gastos internos del despacho (papelería, software, renta, servicios, suscripciones).
- "contratacion_externa": pago a un tercero/proveedor por un servicio profesional (peritos, abogados externos, contadores externos, freelancers).

Datos del gasto:
- Descripción: ${description}
- Monto: ${amount} MXN
- Notas adicionales: ${notes || "(sin notas)"}`;

      const raw = await fetchAiChatSimpleContent([{ role: "user", content: prompt }]);
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      let parsed: { category?: string; reason?: string } | null = null;
      try {
        parsed = JSON.parse(cleaned) as { category?: string; reason?: string };
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]) as { category?: string; reason?: string };
          } catch {
            /* ignore */
          }
        }
      }
      const validCats = CATEGORY_OPTIONS.map((o) => o.value);
      if (parsed?.category && validCats.includes(parsed.category)) {
        form.setValue("category", parsed.category, { shouldValidate: true, shouldDirty: true });
        const label = CATEGORY_OPTIONS.find((o) => o.value === parsed!.category)?.label ?? parsed.category;
        const reason = (parsed.reason ?? "").trim().slice(0, 120);
        setAiHint(reason ? `${label} — ${reason}` : `Sugerencia: ${label}`);
        toast.success("Categoría sugerida por IA aplicada.");
      } else {
        toast.error("La IA no pudo clasificar este gasto. Revisa la descripción.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al consultar la IA.");
    } finally {
      setAiClassifying(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    await createExpense.mutateAsync({
      category: values.category,
      amount: values.amount,
      currency: values.currency,
      description: values.description,
      client_id: values.client_id || null,
      project_id: values.project_id || null,
      expense_date: values.expense_date,
      notes: values.notes || null,
      files: pendingFiles,
    });
    form.reset();
    setPendingFiles([]);
    onOpenChange(false);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden p-0 [&>button.absolute]:hidden flex flex-col rounded-2xl border-sky-200/40 dark:border-sky-900/40">
        <header
          className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 text-white shrink-0"
          style={{ background: KAWIIL_AI_HEADER_BG }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/15 backdrop-blur-sm">
              <Wallet className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold leading-tight">Nueva solicitud de gasto</p>
              <p className="mt-0.5 truncate text-[11px] leading-tight text-white/80">
                Adjunta comprobantes y deja a Kawiil ayudarte con la descripción
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-white/90 hover:bg-white/15"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 px-4 pb-4 pt-3 sm:px-5 overflow-y-auto">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>Categoría *</FormLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleAiClassify}
                      disabled={aiClassifying}
                      className={cn(
                        "h-7 gap-1 px-2 text-[11px]",
                        "text-primary hover:bg-primary/10",
                      )}
                      title="Pide a la IA que sugiera la categoría según la descripción y el monto."
                    >
                      {aiClassifying ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      {aiClassifying ? "Pensando…" : "Sugerir con IA"}
                    </Button>
                  </div>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {aiHint && (
                    <p className="mt-1 flex items-start gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-[11px] text-primary">
                      <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="leading-snug">{aiHint}</span>
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto *</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Moneda</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="MXN">MXN</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción *</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Describe el gasto..." rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expense_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha del gasto *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="client_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cliente</FormLabel>
                  <SearchableSelect
                    options={[{ value: "", label: "Ninguno" }, ...clientOptions]}
                    value={field.value || ""}
                    onValueChange={field.onChange}
                    placeholder="Seleccionar cliente..."
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="project_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proyecto</FormLabel>
                  <SearchableSelect
                    options={[{ value: "", label: "Ninguno" }, ...projectOptions]}
                    value={field.value || ""}
                    onValueChange={field.onChange}
                    placeholder="Seleccionar proyecto..."
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas adicionales</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Información adicional..." rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <FormLabel className="text-sm font-medium">Comprobantes (opcional)</FormLabel>
              <p className="text-xs text-muted-foreground">
                Facturas, tickets o capturas. Hasta {MAX_EXPENSE_FILES} archivos, 20 MB c/u. Puedes arrastrar un .zip y se expanden.
              </p>
              <FileDropzone
                files={pendingFiles}
                onChange={handlePendingFilesChange}
                limits={expensesLimits}
                variant="area"
                hint="Arrastra archivos o haz click"
                subhint="PDF, imágenes, Office o .zip"
                showSize
                enableFolderPicker
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createExpense.isPending}>
                {createExpense.isPending ? "Enviando..." : "Enviar solicitud"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
    <DuplicateFileResolutionDialog
      open={dupOpen}
      fileName={dupName}
      onResolve={onDupResolve}
    />
    </>
  );
}
