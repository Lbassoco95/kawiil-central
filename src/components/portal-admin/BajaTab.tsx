/**
 * Central → Portal de clientes → «Baja y resguardo» (B1 y B4).
 *   · Plazo de resguardo del cliente premier: 5 (omisión) o 10 años, a solicitud
 *     del cliente. Solo G3/G4; la base lo exige (portal_staff_set_client_retention).
 *   · Baja del cliente del portal (fin del servicio): muestra antes qué se elimina y
 *     qué se resguarda, y pide doble confirmación. La ejecuta portal-api; la base
 *     vuelve a comprobar rol y confirmaciones.
 * Los textos de aviso son MARCADORES que Polo reemplaza.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { portalDb, portalApi } from "@/lib/portalAdmin";
import { ClientPicker, Section, date, useClients } from "./shared";

interface Item { key: string; label: string; cantidad?: number; detalle?: string }
interface Persona { nombre: string | null; correo: string; rol: string; estado: string; otras_empresas: number; se_elimina_la_cuenta: boolean }
interface OffPlan {
  cliente: { id: string; nombre: string; rfc: string | null };
  bloqueada: boolean; bloqueos: { motivo: string }[];
  personas: Persona[]; elimina: Item[]; conserva: Item[];
  resguardo: { anios: number; hasta: string; fijado_por: "kawiil" | "omision"; para: string };
  confirmacion: { palabra: string; dato: "rfc" | "nombre" };
}
interface Req { id: string; status: string; requested_at: string; executed_at: string | null; error: string | null; result: { verificacion?: { ok: boolean } } | null }

const PALABRA = "DAR DE BAJA";
const day = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? `${m[3]}/${m[2]}/${m[1]}` : date(d); };

export default function BajaTab() {
  const clients = useClients();
  const [client, setClient] = useState("");
  const [years, setYears] = useState<number | null>(null);
  const [newYears, setNewYears] = useState<5 | 10>(5);
  const [motivo, setMotivo] = useState("");
  const [plan, setPlan] = useState<OffPlan | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [palabra, setPalabra] = useState("");
  const [dato, setDato] = useState("");
  const [entendido, setEntendido] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reqs, setReqs] = useState<Req[]>([]);

  const load = useCallback(async () => {
    setPlan(null); setPlanErr(null); setPalabra(""); setDato(""); setEntendido(false);
    if (!client) return;
    const [{ data: s }, { data: p, error }, { data: r }] = await Promise.all([
      portalDb.from("portal_client_settings").select("retention_years").eq("client_id", client).maybeSingle(),
      portalDb.rpc("portal_client_offboarding_plan", { _client_id: client }),
      portalDb.from("portal_deletion_requests").select("id, status, requested_at, executed_at, error, result").eq("client_id", client).order("requested_at", { ascending: false }).limit(10),
    ]);
    setYears((s?.retention_years as number | null) ?? null);
    setNewYears(((s?.retention_years as 5 | 10 | null) ?? 5));
    if (error) setPlanErr(error.message); else setPlan(p as OffPlan);
    setReqs((r as Req[]) ?? []);
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  const saveYears = async () => {
    const { error } = await portalDb.rpc("portal_staff_set_client_retention", { _client_id: client, _years: newYears, _motivo: motivo });
    if (error) toast.error(error.message); else { toast.success(`Plazo de resguardo: ${newYears} años`); setMotivo(""); }
    await load();
  };

  const esperado = plan ? (plan.confirmacion.dato === "rfc" ? plan.cliente.rfc ?? "" : plan.cliente.nombre) : "";
  const listo = !!plan && !plan.bloqueada && palabra === PALABRA && dato.replace(/\s/g, "").toUpperCase() === esperado.replace(/\s/g, "").toUpperCase() && entendido;

  const baja = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await portalApi.call<{ estado: string; verificacion: { ok: boolean } | null; cuentas_pendientes: number }>("central/cliente.baja", body);
      if (r.estado === "ejecutada" && r.verificacion?.ok) toast.success("Cliente dado de baja. La verificación no encontró certificados, contraseñas, accesos ni adjuntos.");
      else toast.warning(`Baja registrada con pendientes (${r.cuentas_pendientes} cuentas por cerrar${r.verificacion?.ok === false ? ", la verificación encontró hallazgos" : ""}). Reintente.`);
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="max-w-md"><ClientPicker value={client} onChange={setClient} clients={clients} /></div>
      {client && planErr && <p className="text-sm text-destructive">{planErr}</p>}

      {client && plan && (
        <Section title="Plazo de resguardo del cliente" desc="Cinco años por omisión; diez si el cliente lo solicita. Solo G3/G4. Si el cliente ya se dio de baja, el cambio es una nueva elección expresa y modifica el resguardo en curso.">
          <p className="text-sm">Plazo actual: <strong>{years ?? 5} años</strong> {years == null && <Badge variant="secondary">omisión</Badge>}</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <fieldset className="flex gap-3 text-sm">
              {[5, 10].map((y) => (
                <label key={y} className="flex items-center gap-1"><input type="radio" name="anios" checked={newYears === y} onChange={() => setNewYears(y as 5 | 10)} />{y} años</label>
              ))}
            </fieldset>
            <label className="text-sm">Motivo (solicitud del cliente)<Input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="w-72" /></label>
            <Button onClick={saveYears} disabled={!motivo.trim()}>Guardar plazo</Button>
          </div>
        </Section>
      )}

      {client && plan && (
        <Section title="Dar de baja al cliente del portal" desc="Fin del servicio. Se ejecuta de una sola vez y queda registrada.">
          <p className="kw-placeholder mb-2 rounded-md p-2 text-sm">[MARCADOR — texto de Polo] Aviso interno antes de dar de baja a un cliente.</p>
          {plan.bloqueada ? (
            <div className="space-y-1">{plan.bloqueos.map((b, i) => <p key={i} className="text-sm text-destructive">{b.motivo}</p>)}</div>
          ) : (
            <>
              <h4 className="text-sm font-semibold">Se eliminará de inmediato</h4>
              <ul className="list-disc pl-5 text-sm">{plan.elimina.map((i) => (
                <li key={i.key}><strong>{i.label} ({i.cantidad ?? 0})</strong>{i.detalle ? `: ${i.detalle}` : ""}</li>))}</ul>
              <h4 className="mt-2 text-sm font-semibold">Personas</h4>
              <ul className="text-sm">{plan.personas.map((p) => (
                <li key={p.correo}>{p.nombre ?? p.correo} · {p.correo} · {p.rol}{p.estado !== "activa" ? ` (${p.estado})` : ""} — {p.se_elimina_la_cuenta ? "se elimina su cuenta" : `conserva su cuenta (tiene ${p.otras_empresas} empresa(s) más)`}</li>))}
                {plan.personas.length === 0 && <li className="text-muted-foreground">Sin personas en el portal.</li>}
              </ul>
              <h4 className="mt-2 text-sm font-semibold">Se resguardará {plan.resguardo.anios} años, hasta el {day(plan.resguardo.hasta)}</h4>
              <p className="text-xs text-muted-foreground">{plan.resguardo.para} Plazo {plan.resguardo.fijado_por === "kawiil" ? "fijado por Kawiil a solicitud del cliente" : "por omisión"}.</p>
              <ul className="list-disc pl-5 text-sm">{plan.conserva.map((i) => <li key={i.key}>{i.label} ({i.cantidad ?? 0})</li>)}</ul>
              <div className="mt-3 grid max-w-xl gap-2">
                <label className="text-sm">1. Escriba <strong>{PALABRA}</strong><Input value={palabra} onChange={(e) => setPalabra(e.target.value)} /></label>
                <label className="text-sm">2. Escriba el {plan.confirmacion.dato === "rfc" ? "RFC" : "nombre"} del cliente<Input value={dato} onChange={(e) => setDato(e.target.value)} /></label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={entendido} onChange={(e) => setEntendido(e.target.checked)} />Entiendo que los certificados y accesos se destruyen y no se pueden recuperar.</label>
                <Button variant="destructive" className="w-fit" disabled={!listo || busy}
                  onClick={() => baja({ client_id: client, confirmacion: palabra, rfc: dato })}>Dar de baja</Button>
              </div>
            </>
          )}
        </Section>
      )}

      {client && reqs.length > 0 && (
        <Section title="Solicitudes de baja de este cliente">
          <ul className="space-y-1 text-sm">{reqs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <Badge variant={r.status === "ejecutada" ? "default" : r.status === "error" ? "destructive" : "secondary"}>{r.status}</Badge>
              {date(r.requested_at)}{r.error ? ` · ${r.error}` : ""}
              {r.result?.verificacion && <span>· verificación {r.result.verificacion.ok ? "sin hallazgos" : "con hallazgos"}</span>}
              {r.status === "error" && <Button size="sm" variant="outline" disabled={busy} onClick={() => baja({ request_id: r.id })}>Reintentar</Button>}
            </li>))}
          </ul>
        </Section>
      )}
    </div>
  );
}
