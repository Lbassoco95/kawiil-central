import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExpenseFormDialog({ open, onOpenChange }: Props) {
  const createExpense = useCreateExpense();
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();

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
    });
    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva solicitud de gasto</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría *</FormLabel>
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
                  <FormLabel>
                    Cliente {watchCategory === "terceros" && "*"}
                  </FormLabel>
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
  );
}
