import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { db } from "../lib/supabase";
import { callApi, PortalApiError } from "../lib/api";
import { fmtMoney } from "../lib/format";
import { Notice, PageTitle, StatusPill } from "../components/ui";
import LegalText, { useLegal } from "../components/LegalText";
import { C_FORMA_PAGO, C_REGIMEN_FISCAL, C_USO_CFDI } from "../../../supabase/functions/_shared/portal/validate.ts";
import type { BorradorFactura, ConceptoBorrador, ErrorValidacion, Totales } from "../../../supabase/functions/_shared/portal/emission/types.ts";

interface Dossier { complete: boolean; origin: string; checks: { key: string; ok: boolean; label: string; detail: string }[] }
interface Validation { validacion: { ok: boolean; errores: ErrorValidacion[]; totales: Totales }; expediente: Dossier; emision_habilitada: boolean; uso_basico: { usadas: number; limite: number; origin: string } | null; emisor: string }

const concepto = (): ConceptoBorrador => ({ claveProdServ: "", claveUnidad: "E48", descripcion: "", cantidad: 1, valorUnitario: 0, objetoImp: "02", ivaTasa: 0.16 });

export default function NuevaFactura() {
  const { active } = usePortal();
  const [b, setB] = useState<Omit<BorradorFactura, "emisor">>({
    receptor: { rfc: "", nombre: "", regimen: "601", cp: "", uso: "G03" }, formaPago: "03", metodoPago: "PUE", moneda: "MXN", conceptos: [concepto()],
  });
  const [v, setV] = useState<Validation | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const contrato = useLegal("contrato_uso");

  const validate = async () => {
    if (!active) return;
    try {
      setV(await callApi<Validation>("facturas.validar", { client_id: active.client_id, borrador: b }));
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof PortalApiError ? e.message : "No se pudo validar." });
    }
  };
  useEffect(() => { void validate(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (active?.role !== "administrador") return <Notice tone="warn">Solo un administrador del cliente puede emitir facturas.</Notice>;

  const errFor = (campo: string) => v?.validacion.errores.filter((e) => e.campo === campo).map((e) => e.mensaje).join(" ");
  const setR = (k: keyof BorradorFactura["receptor"], val: string) => setB({ ...b, receptor: { ...b.receptor, [k]: val } });
  const setC = (i: number, patch: Partial<ConceptoBorrador>) => setB({ ...b, conceptos: b.conceptos.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const basicLimitReached = v?.uso_basico?.origin === "basico" && v.uso_basico.usadas >= v.uso_basico.limite;
  const contratoPendiente = v?.expediente.checks.find((c) => c.key === "contrato_uso" && !c.ok);

  const emit = async () => {
    if (!active) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await callApi<{ uuid: string; prueba: boolean; totales: Totales }>("facturas.crear", { client_id: active.client_id, borrador: b });
      setMsg({ tone: r.prueba ? "warn" : "ok", text: r.prueba
        ? `Factura de PRUEBA generada (${r.uuid}) por ${fmtMoney(r.totales.total)}. No tiene validez fiscal: el timbrado real se activa cuando Kawiil conecte su proveedor de certificación.`
        : `Factura emitida: ${r.uuid}.` });
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof PortalApiError ? e.message : "No se pudo emitir." });
      await validate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle title="Crear factura de ingreso" subtitle="Solo facturas de ingreso. Para recibos, complementos de pago o notas de crédito, escriba a su equipo." actions={<Link className="text-sm underline" to="/facturas">Volver a facturas</Link>} />
      {v && (
        <section className="mb-4 rounded-xl border bg-card p-4" aria-labelledby="exp-t">
          <h2 id="exp-t" className="text-lg">Expediente de emisión</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {v.expediente.checks.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-2"><StatusPill tone={c.ok ? "ok" : "bad"}>{c.ok ? "Completo" : "Falta"}</StatusPill><span className="font-medium">{c.label}:</span><span className="text-muted-foreground">{c.detail}</span></li>
            ))}
          </ul>
          {!v.emision_habilitada && <div className="mt-3"><Notice tone="wait">La emisión está apagada para este cliente. Kawiil la activa cuando el expediente esté completo.</Notice></div>}
          {v.uso_basico?.origin === "basico" && <p className="mt-2 text-sm">Facturas incluidas en el nivel básico: <span className="kw-mono">{v.uso_basico.usadas} de {v.uso_basico.limite}</span></p>}
          {basicLimitReached && <div className="mt-2"><Notice tone="warn" title="Llegó al límite del nivel básico">Para seguir facturando, contrate un plan con Kawiil. <Link to="/mensajes" className="underline">Escríbanos aquí</Link>.</Notice></div>}
        </section>
      )}
      {contratoPendiente && (
        <section className="mb-4 rounded-xl border bg-card p-4">
          <h2 className="text-lg">Contrato de uso</h2>
          <LegalText doc={contrato} />
          <Button className="mt-3" onClick={async () => { await db.rpc("portal_accept_legal", { _kind: "contrato_uso", _client_id: active!.client_id, _user_agent: navigator.userAgent }); await validate(); }}>Acepto el contrato de uso</Button>
        </section>
      )}

      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void validate(); }}>
        <fieldset className="grid gap-3 rounded-xl border p-4 md:grid-cols-2">
          <legend className="px-1 font-semibold">Receptor</legend>
          <div><Label htmlFor="r-rfc">RFC</Label><Input id="r-rfc" className="kw-mono uppercase" value={b.receptor.rfc} onChange={(e) => setR("rfc", e.target.value.toUpperCase())} aria-invalid={!!errFor("receptor.rfc")} aria-describedby="r-rfc-e" /><p id="r-rfc-e" className="text-xs text-destructive">{errFor("receptor.rfc")}</p></div>
          <div><Label htmlFor="r-nombre">Nombre o razón social (como en su constancia)</Label><Input id="r-nombre" value={b.receptor.nombre} onChange={(e) => setR("nombre", e.target.value.toUpperCase())} aria-describedby="r-nombre-e" /><p id="r-nombre-e" className="text-xs text-destructive">{errFor("receptor.nombre")}</p></div>
          <div><Label htmlFor="r-cp">Código postal fiscal</Label><Input id="r-cp" inputMode="numeric" maxLength={5} className="kw-mono" value={b.receptor.cp} onChange={(e) => setR("cp", e.target.value.replace(/\D/g, ""))} aria-describedby="r-cp-e" /><p id="r-cp-e" className="text-xs text-destructive">{errFor("receptor.cp")}</p></div>
          <div><Label htmlFor="r-reg">Régimen fiscal</Label><select id="r-reg" className="h-10 w-full rounded-md border px-2" value={b.receptor.regimen} onChange={(e) => setR("regimen", e.target.value)}>{C_REGIMEN_FISCAL.map((r) => <option key={r.clave} value={r.clave}>{r.clave} · {r.descripcion}</option>)}</select><p className="text-xs text-destructive">{errFor("receptor.regimen")}</p></div>
          <div className="md:col-span-2"><Label htmlFor="r-uso">Uso de CFDI</Label><select id="r-uso" className="h-10 w-full rounded-md border px-2" value={b.receptor.uso} onChange={(e) => setR("uso", e.target.value)}>{C_USO_CFDI.map((u) => <option key={u.clave} value={u.clave}>{u.clave} · {u.descripcion}</option>)}</select><p className="text-xs text-destructive">{errFor("receptor.uso")}</p></div>
        </fieldset>
        <fieldset className="grid gap-3 rounded-xl border p-4 md:grid-cols-2">
          <legend className="px-1 font-semibold">Pago</legend>
          <div><Label htmlFor="p-met">Método de pago</Label><select id="p-met" className="h-10 w-full rounded-md border px-2" value={b.metodoPago} onChange={(e) => setB({ ...b, metodoPago: e.target.value as "PUE" | "PPD", formaPago: e.target.value === "PPD" ? "99" : b.formaPago })}><option value="PUE">PUE · Pago en una sola exhibición</option><option value="PPD">PPD · Pago en parcialidades o diferido</option></select></div>
          <div><Label htmlFor="p-forma">Forma de pago</Label><select id="p-forma" className="h-10 w-full rounded-md border px-2" value={b.formaPago} onChange={(e) => setB({ ...b, formaPago: e.target.value })}>{C_FORMA_PAGO.map((f) => <option key={f.clave} value={f.clave}>{f.clave} · {f.descripcion}</option>)}</select><p className="text-xs text-destructive">{errFor("formaPago")}</p></div>
        </fieldset>
        <fieldset className="space-y-3 rounded-xl border p-4">
          <legend className="px-1 font-semibold">Conceptos</legend>
          {b.conceptos.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-3 md:grid-cols-6">
              <div className="md:col-span-2"><Label htmlFor={`c-d-${i}`}>Descripción</Label><Input id={`c-d-${i}`} value={c.descripcion} onChange={(e) => setC(i, { descripcion: e.target.value })} /></div>
              <div><Label htmlFor={`c-k-${i}`}>Clave SAT (8 dígitos)</Label><Input id={`c-k-${i}`} className="kw-mono" inputMode="numeric" maxLength={8} value={c.claveProdServ} onChange={(e) => setC(i, { claveProdServ: e.target.value.replace(/\D/g, "") })} /></div>
              <div><Label htmlFor={`c-u-${i}`}>Unidad</Label><Input id={`c-u-${i}`} className="kw-mono uppercase" value={c.claveUnidad} onChange={(e) => setC(i, { claveUnidad: e.target.value.toUpperCase() })} /></div>
              <div><Label htmlFor={`c-q-${i}`}>Cantidad</Label><Input id={`c-q-${i}`} inputMode="decimal" value={c.cantidad} onChange={(e) => setC(i, { cantidad: Number(e.target.value) })} /></div>
              <div><Label htmlFor={`c-v-${i}`}>Precio unitario</Label><Input id={`c-v-${i}`} inputMode="decimal" value={c.valorUnitario} onChange={(e) => setC(i, { valorUnitario: Number(e.target.value) })} /></div>
              <div className="md:col-span-2"><Label htmlFor={`c-i-${i}`}>IVA</Label>
                <select id={`c-i-${i}`} className="h-10 w-full rounded-md border px-2" value={c.objetoImp === "01" ? "no" : String(c.ivaTasa)} onChange={(e) => setC(i, e.target.value === "no" ? { objetoImp: "01", ivaTasa: undefined } : { objetoImp: "02", ivaTasa: Number(e.target.value) as 0.16 | 0.08 | 0 })}>
                  <option value="0.16">16 %</option><option value="0.08">8 % (frontera)</option><option value="0">0 %</option><option value="no">No objeto de impuesto</option>
                </select></div>
              <p className="text-xs text-destructive md:col-span-4">{v?.validacion.errores.filter((e) => e.campo.startsWith(`conceptos[${i}]`)).map((e) => e.mensaje).join(" ")}</p>
              {b.conceptos.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setB({ ...b, conceptos: b.conceptos.filter((_, j) => j !== i) })}>Quitar concepto</Button>}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setB({ ...b, conceptos: [...b.conceptos, concepto()] })}>Agregar concepto</Button>
        </fieldset>
        {v && (
          <div className="rounded-xl border p-4 text-sm">
            <p>Subtotal <span className="kw-mono">{fmtMoney(v.validacion.totales.subtotal)}</span> · IVA <span className="kw-mono">{fmtMoney(v.validacion.totales.iva)}</span> · <strong>Total <span className="kw-mono">{fmtMoney(v.validacion.totales.total)}</span></strong></p>
            {v.validacion.errores.filter((e) => ["csd", "moneda", "total", "emisor", "emisor.rfc", "emisor.regimen", "emisor.cp", "emisor.nombre", "metodoPago", "conceptos"].includes(e.campo)).map((e) => <p key={e.campo + e.mensaje} className="text-destructive">{e.mensaje}</p>)}
          </div>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline">Revisar datos</Button>
          <button
            type="button"
            className="kw-critical inline-flex h-10 items-center rounded-md px-4 disabled:opacity-50"
            disabled={busy || !v?.validacion.ok || !v?.emision_habilitada || !v?.expediente.complete || basicLimitReached}
            onClick={emit}
          >
            {busy ? "Emitiendo…" : "Emitir factura"}
          </button>
        </div>
      </form>
    </>
  );
}
