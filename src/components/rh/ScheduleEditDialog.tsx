import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  ISO_WEEKDAYS,
  WORK_MODES,
  WORK_MODE_EMOJI,
  WORK_MODE_LABEL,
  type RhEmploymentType,
  type RhWeeklyPlan,
  type RhWorkMode,
  type RhWorkSchedule,
} from "@/lib/rh";
import { useSaveSchedule, useOfficeLocations } from "@/hooks/useRh";

type DayValue = RhWorkMode | "off";

const DAY_OPTIONS: { value: DayValue; label: string }[] = [
  ...WORK_MODES.map((m) => ({ value: m as DayValue, label: `${WORK_MODE_EMOJI[m]} ${WORK_MODE_LABEL[m]}` })),
  { value: "off", label: "💤 Descanso" },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  userName: string;
  existing: RhWorkSchedule | null;
}

function defaultPlan(mode: RhWorkMode): Record<string, DayValue> {
  return {
    "1": mode,
    "2": mode,
    "3": mode,
    "4": mode,
    "5": mode,
    "6": "off",
    "7": "off",
  };
}

export function ScheduleEditDialog({ open, onOpenChange, userId, userName, existing }: Props) {
  const save = useSaveSchedule();
  const { data: offices = [] } = useOfficeLocations();

  const [shiftLabel, setShiftLabel] = useState("Turno general");
  const [employmentType, setEmploymentType] = useState<RhEmploymentType>("full_time");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [defaultMode, setDefaultMode] = useState<RhWorkMode>("office");
  const [officeId, setOfficeId] = useState<string>("none");
  const [notes, setNotes] = useState("");
  const [plan, setPlan] = useState<Record<string, DayValue>>(defaultPlan("office"));

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setShiftLabel(existing.shift_label);
      setEmploymentType(existing.employment_type ?? "full_time");
      setStartTime(existing.start_time.slice(0, 5));
      setEndTime(existing.end_time.slice(0, 5));
      setDefaultMode(existing.default_work_mode);
      setOfficeId(existing.office_location_id ?? "none");
      setNotes(existing.notes ?? "");
      const p: Record<string, DayValue> = {};
      for (const { key } of ISO_WEEKDAYS) {
        const v = existing.weekly_plan?.[key];
        p[key] = v === null ? "off" : (v ?? existing.default_work_mode);
      }
      setPlan(p);
    } else {
      setShiftLabel("Turno general");
      setEmploymentType("full_time");
      setStartTime("09:00");
      setEndTime("18:00");
      setDefaultMode("office");
      setOfficeId("none");
      setNotes("");
      setPlan(defaultPlan("office"));
    }
  }, [open, existing]);

  function handleSave() {
    const weekly_plan: RhWeeklyPlan = {};
    for (const { key } of ISO_WEEKDAYS) {
      const v = plan[key];
      weekly_plan[key] = v === "off" ? null : v;
    }
    save.mutate(
      {
        user_id: userId,
        shift_label: shiftLabel.trim() || "Turno general",
        employment_type: employmentType,
        start_time: startTime,
        end_time: endTime,
        default_work_mode: defaultMode,
        weekly_plan,
        office_location_id: officeId === "none" ? null : officeId,
        notes: notes.trim() || null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Turno de {userName}</DialogTitle>
          <DialogDescription>
            Define el horario y la modalidad de cada día (oficina, home office o de comisión).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nombre del turno</Label>
              <Input value={shiftLabel} onChange={(e) => setShiftLabel(e.target.value)} placeholder="Matutino" />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de jornada</Label>
              <Select value={employmentType} onValueChange={(v) => setEmploymentType(v as RhEmploymentType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {EMPLOYMENT_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Entrada</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Salida</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Modalidad por defecto</Label>
            <Select value={defaultMode} onValueChange={(v) => setDefaultMode(v as RhWorkMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORK_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {WORK_MODE_EMOJI[m]} {WORK_MODE_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Plan semanal</Label>
            <div className="space-y-1.5">
              {ISO_WEEKDAYS.map(({ key, long }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-24 text-sm">{long}</span>
                  <Select value={plan[key]} onValueChange={(v) => setPlan((p) => ({ ...p, [key]: v as DayValue }))}>
                    <SelectTrigger className={cn("h-9 flex-1", plan[key] === "off" && "text-muted-foreground")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Oficina de referencia (geocerca)</Label>
            <Select value={officeId} onValueChange={setOfficeId}>
              <SelectTrigger>
                <SelectValue placeholder="Sin oficina" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin oficina específica</SelectItem>
                {offices.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar turno
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
