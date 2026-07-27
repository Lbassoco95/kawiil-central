import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useJornada } from "@/hooks/useRh";
import { useCalendarEvents } from "@/hooks/useMicrosoft";

/* eslint-disable @typescript-eslint/no-explicit-any */

const RH_JORNADA_ROUTE = "/hub?tab=rh&rh=jornada";

// Cadencias
const START_FIRST_DELAY = 3 * 60_000; // primer aviso a los 3 min de abrir
const START_REPEAT = 15 * 60_000;
const LUNCH_REPEAT = 15 * 60_000;
const RETURN_REPEAT = 10 * 60_000;
const CHECKOUT_REPEAT = 30 * 60_000;

function isoWeekday(d: Date): number {
  const wd = d.getDay(); // 0=Dom..6=Sáb
  return wd === 0 ? 7 : wd; // 1=Lun..7=Dom
}

function todayAt(hms: string): number {
  const [h, m, s] = hms.split(":").map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, s || 0, 0);
  return d.getTime();
}

function localYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtHm(ms: number): string {
  return new Date(ms).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function dayKey(): string {
  return `jornada-reminders:${localYmd()}`;
}
function getFlag(key: string): boolean {
  try {
    const raw = localStorage.getItem(dayKey());
    return raw ? !!JSON.parse(raw)[key] : false;
  } catch {
    return false;
  }
}
function setFlag(key: string) {
  try {
    const raw = localStorage.getItem(dayKey());
    const obj = raw ? JSON.parse(raw) : {};
    obj[key] = true;
    localStorage.setItem(dayKey(), JSON.stringify(obj));
  } catch {
    /* ignore */
  }
}

/**
 * Recordatorios de jornada (in-app, mientras la sesión está abierta):
 *  - Iniciar registro si en día hábil no se ha iniciado (a los 3 min, repite c/15).
 *  - Hora de comida (ir a comer / no voy a comer + motivo).
 *  - Regreso de comida.
 *  - Salida (desde el fin de turno, c/30 min: "¿ya saliste?").
 * Se monta una sola vez a nivel global (AppTopbar).
 */
export function JornadaReminders() {
  const { session, schedule, summary, act } = useJornada();
  const navigate = useNavigate();
  const ymd = localYmd();
  // Eventos de hoy (para detectar reuniones que chocan con la comida). Si no hay
  // M365 conectado devuelve [] y todo funciona igual (sin detección de reunión).
  const { data: events = [] } = useCalendarEvents(`${ymd}T00:00:00.000Z`, `${ymd}T23:59:59.999Z`);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [savingReason, setSavingReason] = useState(false);

  const ref = useRef({ session, schedule, summary, act, events });
  ref.current = { session, schedule, summary, act, events };
  const mountedAt = useRef(Date.now());
  const lastShown = useRef<Record<string, number>>({});

  useEffect(() => {
    function evaluate() {
      const { schedule, summary, act } = ref.current;
      if (!schedule) return;
      const now = Date.now();
      const wd = isoWeekday(new Date(now));
      if (wd < 1 || wd > 5) return; // solo lunes a viernes
      if (schedule.weekly_plan && schedule.weekly_plan[String(wd)] === null) return; // día de descanso del turno

      const startMs = todayAt(schedule.start_time);
      const endMs = todayAt(schedule.end_time);
      const lunchStartMs = todayAt(schedule.lunch_start);
      const lunchEndMs = todayAt(schedule.lunch_end);
      const nightCap = endMs + 3 * 3_600_000; // no molestar de madrugada

      const due = (type: string, repeat: number, firstDelay = 0) => {
        if (firstDelay && now - mountedAt.current < firstDelay) return false;
        return now - (lastShown.current[type] ?? 0) >= repeat;
      };
      const mark = (type: string) => {
        lastShown.current[type] = now;
      };

      // 1) Iniciar jornada
      if (summary.state === "none" && now >= startMs && now <= nightCap && due("start", START_REPEAT, START_FIRST_DELAY)) {
        mark("start");
        toast("Aún no inicias tu jornada", {
          id: "jr-start",
          description: "Registra tu hora de entrada.",
          duration: 20_000,
          action: { label: "Registrar", onClick: () => navigate(RH_JORNADA_ROUTE) },
        });
        return;
      }

      // 2) Hora de comida (con detección de reunión que choca con la comida)
      if (
        summary.state === "working" &&
        now >= lunchStartMs &&
        now <= nightCap &&
        summary.lunchMs === 0 &&
        !getFlag("skipLunch")
      ) {
        // ¿Hay una reunión (ocupado) que se traslapa con la ventana de comida?
        let meeting: { end: number; subject: string } | null = null;
        for (const ev of ref.current.events as any[]) {
          const sRaw = ev?.start?.dateTime;
          const eRaw = ev?.end?.dateTime;
          if (!sRaw || !eRaw || ev?.isAllDay || ev?.isCancelled || ev?.showAs === "free") continue;
          const s = new Date(sRaw).getTime();
          const e = new Date(eRaw).getTime();
          if (isNaN(s) || isNaN(e)) continue;
          if (s < lunchEndMs && e > lunchStartMs && (!meeting || e > meeting.end)) {
            meeting = { end: e, subject: ev.subject || "reunión" };
          }
        }

        // Si sigue en la reunión, avisar una sola vez y esperar a que termine.
        if (meeting && now < meeting.end) {
          if (!getFlag("lunchMeetingInformed")) {
            setFlag("lunchMeetingInformed");
            toast(`Tienes "${meeting.subject}" hasta ${fmtHm(meeting.end)}`, {
              id: "jr-lunch-mtg",
              description: "Te recuerdo tu comida en cuanto termine la reunión.",
              duration: 12_000,
            });
          }
          return;
        }

        if (due("lunch", LUNCH_REPEAT)) {
          mark("lunch");
          toast(meeting ? "¿Ya puedes comer? 🍽️" : "Es hora de comer 🍽️", {
            id: "jr-lunch",
            description: meeting
              ? "Terminó tu reunión. Registra tu salida a comida."
              : "Registra tu salida a comida.",
            duration: 25_000,
            action: { label: "Ir a comer", onClick: () => act({ type: "lunch_start" } as any) },
            cancel: { label: "No voy a comer", onClick: () => setReasonOpen(true) },
          });
        }
        return;
      }

      // 3) Regreso de comida
      if (summary.state === "lunch" && now >= lunchEndMs && due("return", RETURN_REPEAT)) {
        mark("return");
        toast("¿Ya regresaste de comer?", {
          id: "jr-return",
          description: "Registra tu regreso para no descontar de más.",
          duration: 20_000,
          action: { label: "Registrar regreso", onClick: () => act({ type: "lunch_end" } as any) },
        });
        return;
      }

      // 4) Salida (desde el fin de turno, cada 30 min)
      if (summary.state === "working" && now >= endMs && due("checkout", CHECKOUT_REPEAT)) {
        mark("checkout");
        toast("¿Ya terminaste tu jornada?", {
          id: "jr-checkout",
          description: "Registra tu salida para dejar la hora correcta.",
          duration: 25_000,
          action: { label: "Ya salí", onClick: () => act({ type: "check_out" } as any) },
        });
      }
    }

    const interval = setInterval(evaluate, 60_000);
    const kickoff = setTimeout(evaluate, 5_000);
    return () => {
      clearInterval(interval);
      clearTimeout(kickoff);
    };
  }, [navigate]);

  async function saveReason() {
    const { session } = ref.current;
    setSavingReason(true);
    try {
      if (session?.id) {
        const prev = (session.notes ?? "").trim();
        const note = `Sin comida: ${reason.trim() || "sin motivo"}`;
        await supabase
          .from("rh_attendance")
          .update({ notes: prev ? `${prev} | ${note}` : note })
          .eq("id", session.id);
      }
      setFlag("skipLunch");
      toast.success("Registramos que hoy no tomarás comida.");
      setReasonOpen(false);
      setReason("");
    } catch {
      toast.error("No se pudo guardar el motivo.");
    } finally {
      setSavingReason(false);
    }
  }

  return (
    <Dialog open={reasonOpen} onOpenChange={setReasonOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>¿Por qué no tomarás comida?</DialogTitle>
          <DialogDescription>Queda registrado en tu jornada de hoy.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {["Tuve reunión", "Carga de trabajo", "Preferí no comer", "Diligencia"].map((q) => (
            <Button
              key={q}
              size="sm"
              variant={reason === q ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setReason(q)}
            >
              {q}
            </Button>
          ))}
        </div>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (opcional)"
          rows={3}
          className="text-sm"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setReasonOpen(false)}>Cancelar</Button>
          <Button onClick={saveReason} disabled={savingReason}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
