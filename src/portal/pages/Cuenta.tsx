import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { db } from "../lib/supabase";
import { callApi } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Notice, PageTitle, StatusPill } from "../components/ui";
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

const ROLE: Record<string, string> = { administrador: "Administrador", operativo: "Operativo", consulta: "Consulta" };

export default function Cuenta() {
  const { me, active, setActive } = usePortal();
  const navigate = useNavigate();
  const isAdmin = active?.role === "administrador";

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
          <Notice tone="info" title="No disponible en esta fase">
            En esta fase solo consultas la información de tu cuenta. No se carga CSD, e.firma ni CIEC en el portal.
            La emisión y el sellado las maneja el equipo de Kawiil.
          </Notice>
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
