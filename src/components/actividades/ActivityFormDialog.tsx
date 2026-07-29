import { useState, useEffect, type ReactNode } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Plus } from "lucide-react";
import { useProfiles } from "@/hooks/useTasks";
import {
  useCreateActivity, useUpdateActivity, type Activity,
} from "@/hooks/useActivities";
import {
  ACTIVITY_TYPE_OPTIONS, ACTIVITY_STATUS_OPTIONS,
} from "@/lib/activityTypes";

interface Props {
  /** Si se pasa, el diálogo edita esa actividad; si no, crea una nueva. */
  activity?: Activity;
  /** Trigger personalizado. Por defecto, un botón "Nueva actividad". */
  trigger?: ReactNode;
}

const emptyNum = (s: string) => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function ActivityFormDialog({ activity, trigger }: Props) {
  const isEdit = !!activity;
  const [open, setOpen] = useState(false);
  const { data: profiles } = useProfiles();
  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();

  const [name, setName] = useState("");
  const [activityType, setActivityType] = useState("");
  const [status, setStatus] = useState("planeacion");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [budgetEstimated, setBudgetEstimated] = useState("");
  const [budgetSpent, setBudgetSpent] = useState("");
  const [dropboxUrl, setDropboxUrl] = useState("");
  const [notes, setNotes] = useState("");

  // Rehidrata el formulario al abrir (modo edición o reset en creación).
  useEffect(() => {
    if (!open) return;
    setName(activity?.name ?? "");
    setActivityType(activity?.activity_type ?? "");
    setStatus(activity?.status ?? "planeacion");
    setEventDate(activity?.event_date ?? "");
    setLocation(activity?.location ?? "");
    setResponsibleUserId(activity?.responsible_user_id ?? "");
    setBudgetEstimated(activity?.budget_estimated != null ? String(activity.budget_estimated) : "");
    setBudgetSpent(activity?.budget_spent != null ? String(activity.budget_spent) : "");
    setDropboxUrl(activity?.dropbox_url ?? "");
    setNotes(activity?.notes ?? "");
  }, [open, activity]);

  const profileOptions = (profiles || []).map((p) => ({ value: p.user_id, label: p.full_name }));

  const isPending = createActivity.isPending || updateActivity.isPending;

  const handleSubmit = () => {
    const payload = {
      name: name.trim(),
      activity_type: activityType || null,
      status,
      event_date: eventDate || null,
      location: location.trim() || null,
      responsible_user_id: responsibleUserId || null,
      budget_estimated: emptyNum(budgetEstimated),
      budget_spent: emptyNum(budgetSpent),
      dropbox_url: dropboxUrl.trim() || null,
      notes: notes.trim() || null,
    };
    if (isEdit) {
      updateActivity.mutate({ id: activity!.id, ...payload }, { onSuccess: () => setOpen(false) });
    } else {
      createActivity.mutate(payload, { onSuccess: () => setOpen(false) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Nueva actividad
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar actividad" : "Nueva actividad"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="activity-name">Nombre *</Label>
            <Input
              id="activity-name" placeholder="Ej: Fin de Año 2026"
              value={name} onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo de actividad</Label>
              <SearchableSelect
                options={ACTIVITY_TYPE_OPTIONS} value={activityType}
                onValueChange={setActivityType}
                placeholder="Seleccionar tipo" searchPlaceholder="Buscar tipo..."
              />
            </div>
            <div className="space-y-2">
              <Label>Estatus</Label>
              <SearchableSelect
                options={ACTIVITY_STATUS_OPTIONS} value={status}
                onValueChange={setStatus}
                placeholder="Estatus" searchPlaceholder="Buscar..."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="activity-date">Fecha del evento</Label>
              <Input
                id="activity-date" type="date"
                value={eventDate} onChange={(e) => setEventDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Responsable</Label>
              <SearchableSelect
                options={profileOptions} value={responsibleUserId}
                onValueChange={setResponsibleUserId}
                placeholder="Sin responsable" searchPlaceholder="Buscar persona..."
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="activity-location">Sede / Lugar</Label>
            <Input
              id="activity-location" placeholder="Ej: CDMX, casa por definir"
              value={location} onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="activity-budget-est">Presupuesto estimado (MXN)</Label>
              <Input
                id="activity-budget-est" type="number" min="0" step="1" placeholder="0"
                value={budgetEstimated} onChange={(e) => setBudgetEstimated(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="activity-budget-spent">Gasto real (MXN)</Label>
              <Input
                id="activity-budget-spent" type="number" min="0" step="1" placeholder="0"
                value={budgetSpent} onChange={(e) => setBudgetSpent(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="activity-dropbox">Link de Dropbox (opcional)</Label>
            <Input
              id="activity-dropbox" placeholder="https://dropbox.com/..."
              value={dropboxUrl} onChange={(e) => setDropboxUrl(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="activity-notes">Notas</Label>
            <Textarea
              id="activity-notes" placeholder="Detalles, acuerdos, etc."
              value={notes} onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || isPending}>
            {isEdit ? "Guardar" : "Crear actividad"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
