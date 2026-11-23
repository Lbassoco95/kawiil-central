import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, Clock3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatMX } from "@/lib/dateUtils";

type Info = {
  activity: {
    name: string; event_date: string | null; event_time: string | null;
    location: string | null; image_url: string | null; closed: boolean;
  };
  guest: {
    first_name: string; confirmed: "si" | "no" | "pendiente"; dietary: string | null;
    responded: boolean; has_plus_one: boolean;
    plus_one_name: string | null; plus_one_dietary: string | null;
    extra_guests_requested: number; extra_guests_status: "none" | "solicitado" | "aprobado" | "rechazado";
    extra_guests_note: string | null;
  };
};

/**
 * Confirmación pública de asistencia: /invitacion/:token (sin login).
 * La imagen es la invitación; el resto de los datos viven en el sistema.
 */
export default function InvitacionPublica() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const [attending, setAttending] = useState<"si" | "no" | null>(null);
  const [dietary, setDietary] = useState("");
  // El +1 va incluido: arranca encendido y la persona lo puede apagar ("voy solo").
  const [wantPlus, setWantPlus] = useState(true);
  const [plusName, setPlusName] = useState("");
  const [plusDietary, setPlusDietary] = useState("");
  const [wantExtra, setWantExtra] = useState(false);
  const [extraCount, setExtraCount] = useState(1);
  const [extraNote, setExtraNote] = useState("");
  const [website, setWebsite] = useState(""); // honeypot

  const hydrate = useCallback((d: Info) => {
    setInfo(d);
    setAttending(d.guest.responded && d.guest.confirmed !== "pendiente" ? d.guest.confirmed : null);
    setDietary(d.guest.dietary ?? "");
    setWantPlus(d.guest.responded ? d.guest.has_plus_one : true);
    setWantExtra(d.guest.extra_guests_requested > 0);
    setExtraCount(d.guest.extra_guests_requested > 0 ? d.guest.extra_guests_requested : 1);
    setExtraNote(d.guest.extra_guests_note ?? "");
    setPlusName(d.guest.plus_one_name ?? "");
    setPlusDietary(d.guest.plus_one_dietary ?? "");
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.functions.invoke("activity-rsvp", {
        body: { action: "info", token },
      });
      if (err || !data || data.error) setError("Este enlace no es válido o ya no está disponible.");
      else hydrate(data as Info);
      setLoading(false);
    })();
  }, [token, hydrate]);

  const submit = async () => {
    if (!attending) return;
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke("activity-rsvp", {
      body: {
        action: "respond", token, attending, dietary,
        want_plus_one: wantPlus,
        plus_one_name: plusName, plus_one_dietary: plusDietary,
        extra_guests: attending === "si" && wantExtra ? extraCount : 0,
        extra_note: extraNote, website,
      },
    });
    setSaving(false);
    if (err || !data || data.error) {
      setError(data?.error ?? "No pudimos guardar tu respuesta. Inténtalo de nuevo en un momento.");
      return;
    }
    if (data.guest) hydrate(data as Info);
    setDone(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const shell = "min-h-screen bg-[#f6f1e8] text-[#2c2a26] flex justify-center px-4 py-6";

  if (loading) {
    return <div className={shell}><Loader2 className="mt-24 h-6 w-6 animate-spin text-[#8a7f6d]" /></div>;
  }
  if (!info) {
    return (
      <div className={shell}>
        <p className="mt-24 max-w-sm text-center text-sm text-[#6b6354]">{error}</p>
      </div>
    );
  }

  const { activity, guest } = info;
  const extraStatus = guest.extra_guests_status;
  const when = [
    activity.event_date ? formatMX(activity.event_date, "EEEE d 'de' MMMM") : null,
    activity.event_time ? `${activity.event_time.slice(0, 5)} h` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className={shell}>
      <main className="w-full max-w-md space-y-5">
        {activity.image_url ? (
          <img src={activity.image_url} alt={`Invitación: ${activity.name}`}
            className="w-full rounded-3xl shadow-xl shadow-black/10" />
        ) : (
          <div className="rounded-3xl bg-white/70 p-6 text-center backdrop-blur">
            <h1 className="text-xl font-semibold">{activity.name}</h1>
            {when && <p className="mt-1 text-sm text-[#6b6354]">{when}</p>}
            {activity.location && <p className="text-sm text-[#6b6354]">{activity.location}</p>}
          </div>
        )}

        <section className="space-y-5 rounded-3xl border border-white/60 bg-white/70 p-5 shadow-lg shadow-black/5 backdrop-blur">
          {done && (
            <div className="flex items-start gap-2 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {attending === "no"
                  ? "Gracias por avisarnos. Te vamos a extrañar."
                  : extraStatus === "solicitado"
                    ? "Listo, quedaste confirmado. Tu solicitud de invitaciones adicionales está en revisión; te avisamos en cuanto la aprueben."
                    : "Listo, quedaste confirmado. ¡Te esperamos!"}
              </p>
            </div>
          )}

          <div>
            <h2 className="text-lg font-semibold">Hola, {guest.first_name}</h2>
            <p className="text-sm text-[#6b6354]">
              {guest.responded ? "Puedes cambiar tu respuesta cuando quieras." : "¿Nos acompañas?"}
            </p>
          </div>

          {activity.closed ? (
            <p className="text-sm text-[#6b6354]">Este evento ya no recibe confirmaciones.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {([["si", "Sí voy"], ["no", "No puedo"]] as const).map(([v, label]) => (
                  <Button key={v} type="button" variant={attending === v ? "default" : "outline"}
                    className="h-12 rounded-2xl" onClick={() => setAttending(v)}>
                    {label}
                  </Button>
                ))}
              </div>

              {attending === "si" && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="rsvp-diet">¿Eres alérgico o tienes alguna restricción alimentaria?</Label>
                    <Input id="rsvp-diet" maxLength={200} placeholder="Ej: mariscos, vegetariano… (vacío si no)"
                      value={dietary} onChange={(e) => setDietary(e.target.value)} />
                  </div>

                  <div className="space-y-3 rounded-2xl border border-[#e6dccb] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label htmlFor="rsvp-plus">Vengo con mi +1</Label>
                        <p className="text-xs text-[#6b6354]">
                          Tu invitación incluye un acompañante. Apágalo si vas solo.
                        </p>
                      </div>
                      <Switch id="rsvp-plus" checked={wantPlus} onCheckedChange={setWantPlus} />
                    </div>
                    {wantPlus && (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="rsvp-plus-name">Nombre de tu acompañante</Label>
                          <Input id="rsvp-plus-name" maxLength={120} placeholder="Si aún no lo sabes, puedes dejarlo vacío"
                            value={plusName} onChange={(e) => setPlusName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="rsvp-plus-diet">¿Tu acompañante es alérgico a algo?</Label>
                          <Input id="rsvp-plus-diet" maxLength={200} placeholder="Déjalo vacío si no"
                            value={plusDietary} onChange={(e) => setPlusDietary(e.target.value)} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 rounded-2xl border border-[#e6dccb] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label htmlFor="rsvp-extra">¿Necesitas más invitaciones?</Label>
                        <p className="text-xs text-[#6b6354]">
                          Si quieres llevar a alguien más aparte de tu +1, manda la solicitud y el equipo la aprueba.
                        </p>
                      </div>
                      <Switch id="rsvp-extra" checked={wantExtra} onCheckedChange={setWantExtra} />
                    </div>
                    {wantExtra && (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="rsvp-extra-count">¿Cuántas más?</Label>
                          <div className="flex items-center gap-3">
                            <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-full"
                              disabled={extraCount <= 1} onClick={() => setExtraCount((c) => Math.max(1, c - 1))}>−</Button>
                            <span id="rsvp-extra-count" className="w-6 text-center text-lg font-semibold">{extraCount}</span>
                            <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-full"
                              disabled={extraCount >= 5} onClick={() => setExtraCount((c) => Math.min(5, c + 1))}>+</Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="rsvp-extra-note">¿Quiénes son? (y si son alérgicos a algo)</Label>
                          <Input id="rsvp-extra-note" maxLength={300} value={extraNote}
                            onChange={(e) => setExtraNote(e.target.value)} />
                        </div>
                        {extraStatus === "solicitado" && (
                          <p className="flex items-center gap-1.5 text-xs text-amber-800">
                            <Clock3 className="h-3.5 w-3.5" /> Tu solicitud está en revisión.
                          </p>
                        )}
                        {extraStatus === "aprobado" && (
                          <p className="flex items-center gap-1.5 text-xs text-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Aprobadas. ¡Las esperamos!
                          </p>
                        )}
                        {extraStatus === "rechazado" && (
                          <p className="text-xs text-[#6b6354]">Por ahora no pudimos aprobar invitaciones adicionales.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* honeypot anti-spam */}
              <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden"
                value={website} onChange={(e) => setWebsite(e.target.value)} />

              {error && <p className="text-sm text-rose-700">{error}</p>}
              <Button className="h-12 w-full rounded-2xl" onClick={submit}
                disabled={!attending || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : guest.responded || done ? "Actualizar respuesta" : "Enviar respuesta"}
              </Button>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
