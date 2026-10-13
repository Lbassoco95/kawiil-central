import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scale, Plus, Pencil, Trash2, Calendar, AlertTriangle, Gavel, FolderOpen } from "lucide-react";
import { isPast, isToday } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatMX } from "@/lib/dateUtils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { LawsuitWorkspaceSheet } from "@/components/projects/LawsuitWorkspaceSheet";
import {
  CLOSED_LAWSUIT_STATUSES,
  LAWSUIT_STATUS_OPTIONS,
  LAWSUIT_TYPE_OPTIONS,
} from "@/lib/lawsuits";
import type { Database } from "@/integrations/supabase/types";

type LawsuitRow = Database["public"]["Tables"]["project_lawsuits"]["Row"];

interface FormState {
  name: string;
  lawsuit_type: string;
  case_number: string;
  court: string;
  plaintiff: string;
  defendant: string;
  status: string;
  current_stage: string;
  filed_date: string;
  next_hearing_date: string;
  next_deadline_date: string;
  next_deadline_note: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  lawsuit_type: "",
  case_number: "",
  court: "",
  plaintiff: "",
  defendant: "",
  status: "en_tramite",
  current_stage: "",
  filed_date: "",
  next_hearing_date: "",
  next_deadline_date: "",
  next_deadline_note: "",
  notes: "",
};

function toForm(l: LawsuitRow): FormState {
  return {
    name: l.name,
    lawsuit_type: l.lawsuit_type ?? "",
    case_number: l.case_number ?? "",
    court: l.court ?? "",
    plaintiff: l.plaintiff ?? "",
    defendant: l.defendant ?? "",
    status: l.status,
    current_stage: l.current_stage ?? "",
    filed_date: l.filed_date ?? "",
    next_hearing_date: l.next_hearing_date ?? "",
    next_deadline_date: l.next_deadline_date ?? "",
    next_deadline_note: l.next_deadline_note ?? "",
    notes: l.notes ?? "",
  };
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);

function DateChip({ label, date }: { label: string; date: string | null }) {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  const overdue = isPast(d) && !isToday(d);
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}
    >
      {overdue ? <AlertTriangle className="h-3 w-3" /> : <Calendar className="h-3 w-3" />}
      {label}: {formatMX(date, "d MMM yyyy")}
    </span>
  );
}

interface ProjectLawsuitsTabProps {
  projectId: string;
  organizationId: string;
  clientId?: string | null;
}

export function ProjectLawsuitsTab({ projectId, organizationId, clientId }: ProjectLawsuitsTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get("lawsuitId");
  const setOpenId = (id: string | null) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (id) p.set("lawsuitId", id);
        else p.delete("lawsuitId");
        return p;
      },
      { replace: true },
    );
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<LawsuitRow | null>(null);

  const queryKey = ["project-lawsuits", projectId];
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["dashboard-lawsuits"] });
    queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
  };

  const { data: lawsuits = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_lawsuits")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as LawsuitRow[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        lawsuit_type: orNull(form.lawsuit_type),
        case_number: orNull(form.case_number),
        court: orNull(form.court),
        plaintiff: orNull(form.plaintiff),
        defendant: orNull(form.defendant),
        status: form.status,
        current_stage: orNull(form.current_stage),
        filed_date: orNull(form.filed_date),
        next_hearing_date: orNull(form.next_hearing_date),
        next_deadline_date: orNull(form.next_deadline_date),
        next_deadline_note: orNull(form.next_deadline_note),
        notes: orNull(form.notes),
      };
      if (editingId) {
        const { error } = await supabase.from("project_lawsuits").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("project_lawsuits").insert({
          ...payload,
          project_id: projectId,
          organization_id: organizationId,
          created_by: user?.id ?? null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success(editingId ? "Juicio actualizado" : "Juicio agregado");
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error("No se pudo guardar el juicio: " + e.message),
  });

  const quickStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("project_lawsuits").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error("No se pudo cambiar el estatus: " + e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("project_lawsuits").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Juicio eliminado");
      if (deleting?.id === openId) setOpenId(null);
      setDeleting(null);
    },
    onError: (e: Error) => toast.error("No se pudo eliminar: " + e.message),
  });

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (l: LawsuitRow) => {
    setEditingId(l.id);
    setForm(toForm(l));
    setDialogOpen(true);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const activeCount = lawsuits.filter((l) => !CLOSED_LAWSUIT_STATUSES.includes(l.status)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Scale className="h-4 w-4" /> Juicios del proyecto
          </h3>
          <p className="text-[11px] text-muted-foreground/90 mt-0.5">
            {lawsuits.length === 0
              ? "Aún no hay juicios registrados"
              : `${activeCount} activo${activeCount === 1 ? "" : "s"} · ${lawsuits.length} en total`}
          </p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> Agregar juicio
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : lawsuits.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <Gavel className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Registra cada juicio que lleva este proyecto, con su expediente, juzgado, etapa y fechas clave.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {lawsuits.map((l) => {
            const status = LAWSUIT_STATUS_OPTIONS.find((s) => s.value === l.status) ?? LAWSUIT_STATUS_OPTIONS[0];
            const typeLabel = LAWSUIT_TYPE_OPTIONS.find((t) => t.value === l.lawsuit_type)?.label;
            const parties = [l.plaintiff, l.defendant].filter(Boolean).join(" vs ");
            return (
              <Card key={l.id} className={CLOSED_LAWSUIT_STATUSES.includes(l.status) ? "opacity-70" : undefined}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button className="font-medium text-left hover:underline" onClick={() => setOpenId(l.id)}>
                          {l.name}
                        </button>
                        {typeLabel && <Badge variant="outline">{typeLabel}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground space-x-2">
                        {l.case_number && <span>Exp. {l.case_number}</span>}
                        {l.court && <span>· {l.court}</span>}
                      </div>
                      {parties && <div className="text-xs text-muted-foreground">{parties}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Select
                        value={l.status}
                        onValueChange={(status) => quickStatus.mutate({ id: l.id, status })}
                      >
                        <SelectTrigger className={`h-7 w-[130px] text-xs border ${status.className}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LAWSUIT_STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpenId(l.id)}>
                        <FolderOpen className="h-3.5 w-3.5 mr-1" /> Abrir
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(l)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => setDeleting(l)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {l.current_stage && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Etapa actual: </span>
                      {l.current_stage}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <DateChip label="Presentado" date={l.filed_date} />
                    <DateChip label="Próxima audiencia" date={l.next_hearing_date} />
                    <DateChip
                      label={l.next_deadline_note ? `Plazo (${l.next_deadline_note})` : "Próximo plazo"}
                      date={l.next_deadline_date}
                    />
                  </div>

                  {l.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{l.notes}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar juicio" : "Agregar juicio"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Nombre del juicio *</Label>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Ej. Juicio sucesorio Porfirio Tacuba"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Materia</Label>
              <Select value={form.lawsuit_type} onValueChange={(v) => set("lawsuit_type", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  {LAWSUIT_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Estatus</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LAWSUIT_STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Número de expediente</Label>
              <Input value={form.case_number} onChange={(e) => set("case_number", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Juzgado / autoridad</Label>
              <Input value={form.court} onChange={(e) => set("court", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Actor</Label>
              <Input value={form.plaintiff} onChange={(e) => set("plaintiff", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Demandado</Label>
              <Input value={form.defendant} onChange={(e) => set("defendant", e.target.value)} />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Etapa actual</Label>
              <Input
                value={form.current_stage}
                onChange={(e) => set("current_stage", e.target.value)}
                placeholder="Ej. Contestación de demanda"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fecha de presentación</Label>
              <Input type="date" value={form.filed_date} onChange={(e) => set("filed_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Próxima audiencia</Label>
              <Input
                type="date"
                value={form.next_hearing_date}
                onChange={(e) => set("next_hearing_date", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Próximo plazo (fecha)</Label>
              <Input
                type="date"
                value={form.next_deadline_date}
                onChange={(e) => set("next_deadline_date", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descripción del plazo</Label>
              <Input
                value={form.next_deadline_note}
                onChange={(e) => set("next_deadline_note", e.target.value)}
                placeholder="Ej. Ofrecer pruebas"
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Notas</Label>
              <Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending}>
              {save.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LawsuitWorkspaceSheet
        lawsuit={lawsuits.find((l) => l.id === openId) ?? null}
        clientId={clientId}
        onClose={() => setOpenId(null)}
        onEdit={openEdit}
      />

      <DeleteConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title="Eliminar juicio"
        description={`Se eliminará "${deleting?.name ?? ""}" del proyecto. Esta acción no se puede deshacer.`}
      />
    </div>
  );
}
