import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { db } from "../lib/supabase";
import { callApi, fileToBase64, PortalApiError } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Notice, PageTitle, StatusPill } from "../components/ui";
import { csdExpiryLevel } from "../../../supabase/functions/_shared/portal/csd.ts";
import { hastaPara, PLAZO_OMISION, PLAZOS, type Plazo, type ResguardoItem } from "../lib/retention";

interface PlanItem extends ResguardoItem { key: string; label: string; detalle: string; cantidad?: number; client?: string; para?: string }
interface Plan {
  bloqueada: boolean; bloqueos: { client: string; motivo: string }[]; elimina: PlanItem[]; conserva: PlanItem[];
  resguardo: { elige: boolean; omision: number; opciones: { anios: Plazo; hasta: string }[] };
  politica: { fiscal_retention_years: number; confirmada: boolean };
}

/**
 * Eliminar la cuenta (C4, B1–B3). El DESGLOSE sale de la base (portal_account_deletion_plan):
 * lo que se elimina y lo que se resguarda según los datos reales y la política vigente.
 * Si la persona es titular de un básico elige el plazo: 5 años (preseleccionado) o 10.
 * Los textos de encabezado son MARCADORES que Polo reemplaza.
 */
function DeletionSection({ onDone }: { onDone: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [confirm, setConfirm] = useState("");
  const [plazo, setPlazo] = useState<Plazo>(PLAZO_OMISION);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  useEffect(() => {
    callApi<Plan>("cuenta.plan_baja").then(setPlan).catch(() => setPlan(null));
  }, []);
  const itemText = (i: PlanItem) => `${i.label}${i.client ? ` — ${i.client}` : ""}${typeof i.cantidad === "number" ? ` (${i.cantidad})` : ""}`;
  return (
    <section className="rounded-xl border border-destructive/40 bg-card p-4" aria-labelledby="del-t">
      <h2 id="del-t" className="text-lg text-destructive">Eliminar mi cuenta</h2>
      <p className="kw-placeholder mt-2 rounded-md p-2 text-sm">[MARCADOR — texto de Polo] Explicación general sobre la eliminación de la cuenta y el resguardo de la información fiscal.</p>
      {!plan ? <p className="mt-2 text-sm text-muted-foreground">Calculando qué se eliminará y qué se resguardará…</p> : (
        <>
          <h3 className="mt-3 font-semibold">Se eliminará de inmediato</h3>
          <ul className="list-disc pl-5 text-sm">{plan.elimina.map((i, n) => <li key={n}><strong>{itemText(i)}</strong>: {i.detalle}</li>)}</ul>
          {plan.resguardo?.elige && (
            <fieldset className="mt-3 rounded-md border p-3" data-testid="plazo">
              <legend className="px-1 text-sm font-semibold">¿Cuánto tiempo resguardamos su información fiscal?</legend>
              <p className="kw-placeholder mb-2 rounded-md p-2 text-xs">[MARCADOR — texto de Polo] Por qué se resguarda y en qué caso conviene elegir diez años.</p>
              {PLAZOS.map((p) => {
                const op = plan.resguardo.opciones.find((o) => o.anios === p);
                return (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="plazo" value={p} checked={plazo === p} onChange={() => setPlazo(p)} />
                    {p} años{p === PLAZO_OMISION ? " (recomendado)" : ""}{op ? ` — hasta el ${fmtDate(op.hasta)}` : ""}
                  </label>
                );
              })}
            </fieldset>
          )}
          <h3 className="mt-3 font-semibold">Se resguardará, para qué y hasta cuándo</h3>
          <ul className="list-disc pl-5 text-sm">{plan.conserva.map((i, n) => {
            const h = hastaPara(i, plazo);
            return (
              <li key={n}><strong>{itemText(i)}</strong>: {i.para ? `${i.para} ` : ""}{i.detalle}{h.hasta ? ` Hasta el ${fmtDate(h.hasta)} (${h.anios} años).` : ""}</li>
            );
          })}</ul>
          <p className="mt-2 text-xs text-muted-foreground">Nunca se resguardan certificados, llaves, contraseñas, accesos ni mensajes.</p>
          {plan.bloqueada ? (
            <div className="mt-3 space-y-2">{plan.bloqueos.map((b, n) => <Notice key={n} tone="warn" title={`No se puede eliminar todavía: ${b.client}`}>{b.motivo}</Notice>)}</div>
          ) : (
            <>
              <Label htmlFor="del" className="mt-3 block text-sm">Escriba ELIMINAR para confirmar</Label>
              <Input id="del" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1 max-w-xs" />
              <Button className="mt-2" variant="destructive" disabled={confirm !== "ELIMINAR"} onClick={async () => {
                try {
                  await callApi("cuenta.eliminar", { confirmacion: "ELIMINAR", ...(plan.resguardo?.elige ? { plazo_anios: plazo } : {}) });
                  await db.auth.signOut(); onDone();
                } catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
              }}>Eliminar mi cuenta</Button>
            </>
          )}
        </>
      )}
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </section>
  );
}

interface Csd { registry_id: string; cert_serial: string | null; cert_not_after: string | null; revoked_at: string | null; registered_via: string; last_used_at: string | null }
const ROLE: Record<string, string> = { administrador: "Administrador", operativo: "Operativo", consulta: "Consulta" };

export default function Cuenta() {
  const { me, active, setActive } = usePortal();
  const navigate = useNavigate();
  const [csd, setCsd] = useState<Csd[]>([]);
  const [cer, setCer] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [pwd, setPwd] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const isAdmin = active?.role === "administrador";

  const [req, setReq] = useState<{ ok: boolean; missing: { key: string; label: string }[] } | null>(null);
  const loadCsd = async () => {
    if (!active || !isAdmin) return;
    setReq(await callApi<{ ok: boolean; missing: { key: string; label: string }[] }>("csd.requisitos", { client_id: active.client_id }).catch(() => null));
    const r = await callApi<{ csd: Csd[] }>("csd.estado", { client_id: active.client_id }).catch(() => ({ csd: [] }));
    setCsd(r.csd);
  };
  useEffect(() => { void loadCsd(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const uploadCsd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cer || !key || !pwd || !active) return;
    try {
      await callApi("csd.cargar", { client_id: active.client_id, cer_base64: await fileToBase64(cer), key_base64: await fileToBase64(key), password: pwd });
      setPwd(""); setCer(null); setKey(null);
      setMsg({ tone: "ok", text: "Certificado guardado y cifrado. Por seguridad no se puede ver ni descargar de nuevo." });
      await loadCsd();
    } catch (err) {
      setPwd(""); // nunca se conserva la contraseña en pantalla tras un intento fallido
      setMsg({ tone: "bad", text: err instanceof PortalApiError ? err.message : "No se pudo guardar el certificado." });
    }
  };

  return (
    <>
      <PageTitle title="Su cuenta" subtitle={me?.email} />
      <section className="mb-4 rounded-xl border bg-card p-4">
        <h2 className="text-lg">Empresas</h2>
        <p className="text-sm text-muted-foreground">Nivel: {me?.tier === "premier" ? "Cliente de Kawiil" : "Básico"}</p>
        <ul className="mt-2 space-y-1">{me?.clients?.map((c) => (
          <li key={c.client_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{c.client_name} <span className="kw-mono text-xs text-muted-foreground">{c.rfc}</span> · {ROLE[c.role]}</span>
            {active?.client_id === c.client_id ? <StatusPill tone="ok">Trabajando con esta</StatusPill> : <Button size="sm" variant="outline" onClick={() => setActive(c.client_id)}>Trabajar con esta</Button>}
          </li>))}
        </ul>
      </section>

      {isAdmin && (
        <section className="mb-4 rounded-xl border bg-card p-4" aria-labelledby="csd-t">
          <h2 id="csd-t" className="text-lg">Certificado de sello digital (CSD)</h2>
          <p className="text-sm text-muted-foreground">Se usa solo para sellar sus facturas. Se carga una vez, se guarda cifrado y nunca se vuelve a mostrar ni descargar. Nunca le pediremos su e.firma ni su CIEC en el portal.</p>
          {csd.map((c) => {
            const exp = csdExpiryLevel(c.cert_not_after);
            return (
              <div key={c.registry_id} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <span>Serie <span className="kw-mono">{c.cert_serial}</span> · vence {fmtDate(c.cert_not_after)}</span>
                {c.revoked_at ? <StatusPill tone="bad">Revocado</StatusPill> : <StatusPill tone={exp.level === "ok" ? "ok" : exp.level === "aviso" ? "warn" : "bad"}>{exp.level === "vencido" ? "Vencido" : `Vence en ${exp.days} días`}</StatusPill>}
                {!c.revoked_at && <Button size="sm" variant="ghost" onClick={async () => { await callApi("csd.revocar", { registry_id: c.registry_id }); await loadCsd(); }}>Revocar</Button>}
              </div>
            );
          })}
          {req && !req.ok && (
            <div className="mt-3"><Notice tone="warn" title="Antes de recibir su certificado falta:">
              <ul className="list-disc pl-5">{req.missing.map((m) => <li key={m.key}>{m.label}</li>)}</ul>
            </Notice></div>
          )}
          {req?.ok && <form onSubmit={uploadCsd} className="mt-3 grid gap-2 md:grid-cols-3">
            <div><Label htmlFor="cer">Archivo .cer</Label><Input id="cer" type="file" accept=".cer" onChange={(e) => setCer(e.target.files?.[0] ?? null)} /></div>
            <div><Label htmlFor="key">Archivo .key</Label><Input id="key" type="file" accept=".key" onChange={(e) => setKey(e.target.files?.[0] ?? null)} /></div>
            <div><Label htmlFor="pwd">Contraseña de la llave</Label><Input id="pwd" type="password" autoComplete="off" value={pwd} onChange={(e) => setPwd(e.target.value)} /></div>
            <Button type="submit" className="md:col-span-3 md:w-fit" disabled={!cer || !key || !pwd}>Guardar certificado</Button>
          </form>}
          {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        </section>
      )}

      <section className="mb-4 rounded-xl border bg-card p-4">
        <h2 className="text-lg">Seguridad</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" onClick={async () => { await db.auth.signOut({ scope: "global" }); navigate("/ingresar"); }}>Cerrar sesión en todos los dispositivos</Button>
          <Button variant="outline" onClick={() => navigate("/restablecer")}>Cambiar contraseña</Button>
          <a className="self-center text-sm underline" href="/legal/aviso_privacidad">Aviso de privacidad</a>
        </div>
      </section>

      <DeletionSection onDone={() => navigate("/ingresar")} />
    </>
  );
}
