import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { callApi, PortalApiError } from "../lib/api";
import { fmtMoney } from "../lib/format";
import { isDesignPreview } from "../lib/designPreview";
import { Notice, PageTitle, StatusPill } from "../components/ui";
import LegalText, { useLegal } from "../components/LegalText";
import CatalogSuggest from "../components/CatalogSuggest";
import { C_FORMA_PAGO, C_REGIMEN_FISCAL, C_USO_CFDI } from "../../../supabase/functions/_shared/portal/validate.ts";
import type { BorradorFactura, ConceptoBorrador, ErrorValidacion, Totales } from "../../../supabase/functions/_shared/portal/emission/types.ts";

interface Dossier { complete: boolean; origin: string; checks: { key: string; ok: boolean; label: string; detail: string }[] }
interface Validation { validacion: { ok: boolean; errores: ErrorValidacion[]; totales: Totales }; expediente: Dossier; emision_habilitada: boolean; uso_basico: { usadas: number; limite: number; origin: string } | null; emisor: string }

type InvoiceTpl = {
  internal_id: string; label: string; receptor_rfc?: string; receptor_nombre?: string;
  receptor_regimen?: string; receptor_cp?: string; uso_cfdi?: string; forma_pago?: string;
  metodo_pago?: string; conceptos?: ConceptoBorrador[];
};
type ConceptTpl = {
  internal_id: string; label: string; descripcion: string; clave_prod_serv: string;
  clave_unidad: string; cantidad: number; valor_unitario: number; objeto_imp: string; iva_tasa?: number;
};

const concepto = (): ConceptoBorrador => ({
  claveProdServ: "", claveUnidad: "E48", descripcion: "", cantidad: 1, valorUnitario: 0, objetoImp: "02", ivaTasa: 0.16,
});

export default function NuevaFactura() {
  const { active } = usePortal();
  const design = isDesignPreview();
  const clientId = active?.client_id ?? (design ? "design-preview" : "");
  const [b, setB] = useState<Omit<BorradorFactura, "emisor">>({
    receptor: { rfc: design ? "BBB010101BBB" : "", nombre: design ? "CLIENTE EJEMPLO SA DE CV" : "", regimen: "601", cp: design ? "64000" : "", uso: "G03" },
    formaPago: "03", metodoPago: "PUE", moneda: "MXN",
    conceptos: [design
      ? { claveProdServ: "80131500", claveUnidad: "E48", descripcion: "Servicios de contabilidad", cantidad: 1, valorUnitario: 5000, objetoImp: "02", ivaTasa: 0.16 }
      : concepto()],
  });
  const [v, setV] = useState<Validation | null>(design ? {
    validacion: { ok: true, errores: [], totales: { subtotal: 5000, iva: 800, total: 5800 } },
    expediente: { complete: true, origin: "facturapi", checks: [
      { key: "perfil_fiscal", ok: true, label: "Datos fiscales", detail: "Listo" },
      { key: "facturapi", ok: true, label: "Facturapi", detail: "Vista diseño" },
      { key: "emision", ok: true, label: "Emisión", detail: "Activa (diseño)" },
    ] },
    emision_habilitada: true,
    uso_basico: null,
    emisor: "facturapi",
  } : null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [internalId, setInternalId] = useState(design ? "mensual-contable" : "");
  const [tplLabel, setTplLabel] = useState(design ? "Mensualidad contable" : "");
  const [invoiceTpls, setInvoiceTpls] = useState<InvoiceTpl[]>(design ? [
    { internal_id: "mensual-contable", label: "Mensualidad contable", receptor_rfc: "BBB010101BBB", receptor_nombre: "CLIENTE EJEMPLO SA DE CV", receptor_regimen: "601", receptor_cp: "64000", uso_cfdi: "G03", forma_pago: "03", metodo_pago: "PUE" },
  ] : []);
  const [conceptTpls, setConceptTpls] = useState<ConceptTpl[]>(design ? [
    { internal_id: "contabilidad", label: "Contabilidad", descripcion: "Servicios de contabilidad", clave_prod_serv: "80131500", clave_unidad: "E48", cantidad: 1, valor_unitario: 5000, objeto_imp: "02", iva_tasa: 0.16 },
  ] : []);
  const contrato = useLegal("contrato_uso");

  const validate = async () => {
    if (!active || design) return;
    try {
      setV(await callApi<Validation>("facturas.validar", { client_id: active.client_id, borrador: b }));
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof PortalApiError ? e.message : "No se pudo validar." });
    }
  };

  const loadTemplates = async () => {
    if (!active || design) return;
    try {
      const [inv, con] = await Promise.all([
        callApi<{ plantillas: InvoiceTpl[] }>("plantillas.listar", { client_id: active.client_id, kind: "factura" }),
        callApi<{ plantillas: ConceptTpl[] }>("plantillas.listar", { client_id: active.client_id, kind: "concepto" }),
      ]);
      setInvoiceTpls(inv.plantillas ?? []);
      setConceptTpls(con.plantillas ?? []);
    } catch { /* catálogo aún no migrado */ }
  };

  useEffect(() => { void validate(); void loadTemplates(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!design && active?.role !== "administrador") return <Notice tone="warn">Solo un administrador del cliente puede emitir facturas.</Notice>;

  const errFor = (campo: string) => v?.validacion.errores.filter((e) => e.campo === campo).map((e) => e.mensaje).join(" ");
  const setR = (k: keyof BorradorFactura["receptor"], val: string) => setB({ ...b, receptor: { ...b.receptor, [k]: val } });
  const setC = (i: number, patch: Partial<ConceptoBorrador>) => setB({ ...b, conceptos: b.conceptos.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const basicLimitReached = v?.uso_basico?.origin === "basico" && v.uso_basico.usadas >= v.uso_basico.limite;
  const contratoPendiente = v?.expediente?.checks?.find((c) => c.key === "contrato_uso" && !c.ok);

  const applyInvoiceTpl = (t: InvoiceTpl) => {
    setInternalId(t.internal_id);
    setTplLabel(t.label);
    setB({
      receptor: {
        rfc: t.receptor_rfc ?? "",
        nombre: t.receptor_nombre ?? "",
        regimen: t.receptor_regimen ?? "601",
        cp: t.receptor_cp ?? "",
        uso: t.uso_cfdi ?? "G03",
      },
      formaPago: t.forma_pago ?? "03",
      metodoPago: (t.metodo_pago === "PPD" ? "PPD" : "PUE"),
      moneda: "MXN",
      conceptos: Array.isArray(t.conceptos) && t.conceptos.length
        ? t.conceptos.map((c) => ({
          claveProdServ: c.claveProdServ ?? (c as unknown as { clave_prod_serv?: string }).clave_prod_serv ?? "",
          claveUnidad: c.claveUnidad ?? (c as unknown as { clave_unidad?: string }).clave_unidad ?? "E48",
          descripcion: c.descripcion ?? "",
          cantidad: Number(c.cantidad) || 1,
          valorUnitario: Number(c.valorUnitario ?? (c as unknown as { valor_unitario?: number }).valor_unitario) || 0,
          objetoImp: (c.objetoImp ?? (c as unknown as { objeto_imp?: string }).objeto_imp ?? "02") as "01" | "02",
          ivaTasa: (c.ivaTasa ?? (c as unknown as { iva_tasa?: number }).iva_tasa ?? 0.16) as 0.16 | 0.08 | 0,
        }))
        : [concepto()],
    });
  };

  const saveTemplate = async () => {
    if (!active || design) {
      if (design) setMsg({ tone: "warn", text: "Vista diseño: la plantilla no se guarda en servidor." });
      return;
    }
    try {
      const r = await callApi<{ plantilla: InvoiceTpl }>("plantillas.guardar", {
        client_id: active.client_id,
        kind: "factura",
        internal_id: internalId || undefined,
        label: tplLabel || `Factura ${b.receptor.nombre || "frecuente"}`,
        receptor_rfc: b.receptor.rfc,
        receptor_nombre: b.receptor.nombre,
        receptor_regimen: b.receptor.regimen,
        receptor_cp: b.receptor.cp,
        uso_cfdi: b.receptor.uso,
        forma_pago: b.formaPago,
        metodo_pago: b.metodoPago,
        conceptos: b.conceptos,
      });
      setInternalId(r.plantilla.internal_id);
      setTplLabel(r.plantilla.label);
      setMsg({ tone: "ok", text: `Plantilla guardada · id ${r.plantilla.internal_id}` });
      await loadTemplates();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof PortalApiError ? e.message : "No se pudo guardar la plantilla." });
    }
  };

  const emit = async () => {
    if (!active) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await callApi<{ uuid: string; prueba: boolean; totales: Totales; emisor?: string }>("facturas.crear", {
        client_id: active.client_id, borrador: b,
      });
      setMsg({
        tone: r.prueba ? "warn" : "ok",
        text: r.prueba
          ? `Factura de PRUEBA generada (${r.uuid}) por ${fmtMoney(r.totales.total)} · emisor ${r.emisor ?? "prueba"}.`
          : `Factura emitida: ${r.uuid}.`,
      });
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof PortalApiError ? e.message : "No se pudo emitir." });
      await validate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle
        title="Crear factura de ingreso"
        subtitle="Campos Facturapi con etiquetas simples · catálogo SAT sugerido · plantillas frecuentes."
        actions={<Link className="text-sm underline" to="/facturas">Volver a Facturación</Link>}
      />

      <section className="mb-4 rounded-xl border bg-card p-4" aria-labelledby="tpl-t">
        <h2 id="tpl-t" className="text-lg">Factura frecuente</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Guarda o carga un id interno para re-facturar casi sin llenar campos.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <Label htmlFor="tpl-id">Id interno</Label>
            <Input id="tpl-id" className="kw-mono" value={internalId} onChange={(e) => setInternalId(e.target.value)} placeholder="auto o tu clave" />
          </div>
          <div>
            <Label htmlFor="tpl-label">Nombre de la plantilla</Label>
            <Input id="tpl-label" value={tplLabel} onChange={(e) => setTplLabel(e.target.value)} placeholder="Ej. Mensualidad cliente X" />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button type="button" variant="outline" onClick={() => void saveTemplate()}>Guardar frecuente</Button>
          </div>
        </div>
        {invoiceTpls.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {invoiceTpls.map((t) => (
              <Button key={t.internal_id} type="button" size="sm" variant="secondary" onClick={() => applyInvoiceTpl(t)}>
                {t.label} <span className="kw-mono ml-1 opacity-70">{t.internal_id}</span>
              </Button>
            ))}
          </div>
        )}
        {conceptTpls.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground">Conceptos frecuentes</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {conceptTpls.map((t) => (
                <Button
                  key={t.internal_id}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setB({
                    ...b,
                    conceptos: [...b.conceptos, {
                      claveProdServ: t.clave_prod_serv,
                      claveUnidad: t.clave_unidad,
                      descripcion: t.descripcion,
                      cantidad: Number(t.cantidad) || 1,
                      valorUnitario: Number(t.valor_unitario) || 0,
                      objetoImp: t.objeto_imp === "01" ? "01" : "02",
                      ivaTasa: (t.iva_tasa ?? 0.16) as 0.16 | 0.08 | 0,
                    }],
                  })}
                >
                  + {t.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </section>

      {v && (
        <section className="mb-4 rounded-xl border bg-card p-4" aria-labelledby="exp-t">
          <h2 id="exp-t" className="text-lg">Cómo facturas · expediente</h2>
          <p className="mt-1 text-sm text-muted-foreground">Emisor: <span className="kw-mono">{v.emisor}</span></p>
          <ul className="mt-2 space-y-1 text-sm">
            {(v.expediente?.checks ?? []).map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-2">
                <StatusPill tone={c.ok ? "ok" : "bad"}>{c.ok ? "Completo" : "Falta"}</StatusPill>
                <span className="font-medium">{c.label}:</span>
                <span className="text-muted-foreground">{c.detail}</span>
              </li>
            ))}
          </ul>
          {!v.emision_habilitada && (
            <div className="mt-3"><Notice tone="wait">La emisión está apagada para este cliente. Kawiil la activa cuando el expediente esté completo.</Notice></div>
          )}
          {v.uso_basico?.origin === "basico" && (
            <p className="mt-2 text-sm">Facturas incluidas: <span className="kw-mono">{v.uso_basico.usadas} de {v.uso_basico.limite}</span></p>
          )}
          {basicLimitReached && (
            <div className="mt-2"><Notice tone="warn" title="Llegó al límite del nivel básico">Contrate un plan con Kawiil. <Link to="/mensajes" className="underline">Escríbanos aquí</Link>.</Notice></div>
          )}
        </section>
      )}

      {contratoPendiente && (
        <section className="mb-4 rounded-xl border bg-card p-4">
          <h2 className="text-lg">Contrato de uso</h2>
          <LegalText doc={contrato} />
          <Button className="mt-3" onClick={async () => {
            await callApi("legal.aceptar", { kind: "contrato_uso", client_id: active!.client_id, user_agent: navigator.userAgent });
            await validate();
          }}>Acepto el contrato de uso</Button>
        </section>
      )}

      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void validate(); }}>
        <fieldset className="grid gap-3 rounded-xl border p-4 md:grid-cols-2">
          <legend className="px-1 font-semibold">Cliente (receptor)</legend>
          <div>
            <Label htmlFor="r-rfc">RFC del cliente</Label>
            <Input id="r-rfc" className="kw-mono uppercase" value={b.receptor.rfc} onChange={(e) => setR("rfc", e.target.value.toUpperCase())} aria-invalid={!!errFor("receptor.rfc")} />
            <p className="text-xs text-destructive">{errFor("receptor.rfc")}</p>
          </div>
          <div>
            <Label htmlFor="r-nombre">Nombre o razón social (como en su constancia)</Label>
            <Input id="r-nombre" value={b.receptor.nombre} onChange={(e) => setR("nombre", e.target.value.toUpperCase())} />
            <p className="text-xs text-destructive">{errFor("receptor.nombre")}</p>
          </div>
          <div>
            <Label htmlFor="r-cp">Código postal fiscal</Label>
            <Input id="r-cp" inputMode="numeric" maxLength={5} className="kw-mono" value={b.receptor.cp} onChange={(e) => setR("cp", e.target.value.replace(/\D/g, ""))} />
            <p className="text-xs text-destructive">{errFor("receptor.cp")}</p>
          </div>
          <div>
            <Label htmlFor="r-reg">Régimen fiscal del cliente</Label>
            <select id="r-reg" className="h-10 w-full rounded-md border px-2" value={b.receptor.regimen} onChange={(e) => setR("regimen", e.target.value)}>
              {C_REGIMEN_FISCAL.map((r) => <option key={r.clave} value={r.clave}>{r.clave} · {r.descripcion}</option>)}
            </select>
            <p className="text-xs text-destructive">{errFor("receptor.regimen")}</p>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="r-uso">¿Para qué usa la factura? (Uso CFDI)</Label>
            <select id="r-uso" className="h-10 w-full rounded-md border px-2" value={b.receptor.uso} onChange={(e) => setR("uso", e.target.value)}>
              {C_USO_CFDI.map((u) => <option key={u.clave} value={u.clave}>{u.clave} · {u.descripcion}</option>)}
            </select>
            <p className="text-xs text-destructive">{errFor("receptor.uso")}</p>
          </div>
        </fieldset>

        <fieldset className="grid gap-3 rounded-xl border p-4 md:grid-cols-2">
          <legend className="px-1 font-semibold">Cobro</legend>
          <div>
            <Label htmlFor="p-met">¿Ya te pagaron?</Label>
            <select
              id="p-met"
              className="h-10 w-full rounded-md border px-2"
              value={b.metodoPago}
              onChange={(e) => setB({
                ...b,
                metodoPago: e.target.value as "PUE" | "PPD",
                formaPago: e.target.value === "PPD" ? "99" : (b.formaPago === "99" ? "03" : b.formaPago),
              })}
            >
              <option value="PUE">Sí · pago en una sola exhibición (PUE)</option>
              <option value="PPD">No aún · parcialidades o diferido (PPD)</option>
            </select>
          </div>
          <div>
            <Label htmlFor="p-forma">Cómo te pagaron (o pagarán)</Label>
            <select id="p-forma" className="h-10 w-full rounded-md border px-2" value={b.formaPago} onChange={(e) => setB({ ...b, formaPago: e.target.value })}>
              {C_FORMA_PAGO.map((f) => <option key={f.clave} value={f.clave}>{f.clave} · {f.descripcion}</option>)}
            </select>
            <p className="text-xs text-destructive">{errFor("formaPago")}</p>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border p-4">
          <legend className="px-1 font-semibold">Conceptos</legend>
          {b.conceptos.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-3 md:grid-cols-6">
              <div className="md:col-span-2">
                <Label htmlFor={`c-d-${i}`}>Qué vendes (descripción)</Label>
                <Input id={`c-d-${i}`} value={c.descripcion} onChange={(e) => setC(i, { descripcion: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                {design ? (
                  <div>
                    <Label htmlFor={`c-k-${i}`}>Clave SAT del producto/servicio</Label>
                    <Input id={`c-k-${i}`} className="kw-mono" value={c.claveProdServ} onChange={(e) => setC(i, { claveProdServ: e.target.value.replace(/\D/g, "") })} />
                    <ul className="mt-1 max-h-32 overflow-auto rounded-md border text-sm" role="listbox">
                      <li><button type="button" className="flex w-full gap-2 px-2 py-1.5 text-left hover:bg-muted" onClick={() => setC(i, { claveProdServ: "80131500", descripcion: c.descripcion || "Servicios de contabilidad" })}><span className="kw-mono">80131500</span><span className="text-muted-foreground">Servicios de contabilidad</span></button></li>
                      <li><button type="button" className="flex w-full gap-2 px-2 py-1.5 text-left hover:bg-muted" onClick={() => setC(i, { claveProdServ: "80101500", descripcion: c.descripcion || "Servicios de consultoría de negocios" })}><span className="kw-mono">80101500</span><span className="text-muted-foreground">Servicios de consultoría de negocios</span></button></li>
                      <li><button type="button" className="flex w-full gap-2 px-2 py-1.5 text-left hover:bg-muted" onClick={() => setC(i, { claveProdServ: "84111506", descripcion: c.descripcion || "Servicios de facturación" })}><span className="kw-mono">84111506</span><span className="text-muted-foreground">Servicios de facturación</span></button></li>
                    </ul>
                  </div>
                ) : (
                  <CatalogSuggest
                    clientId={clientId}
                    catalog="c_ClaveProdServ"
                    label="Clave SAT del producto/servicio"
                    id={`c-k-${i}`}
                    value={c.claveProdServ}
                    descripcionHint={c.descripcion}
                    mono
                    maxLength={8}
                    onChange={(clave) => setC(i, { claveProdServ: clave })}
                    onPick={(hit) => setC(i, { claveProdServ: hit.clave, descripcion: c.descripcion || hit.descripcion })}
                  />
                )}
              </div>
              <div>
                {design ? (
                  <div>
                    <Label htmlFor={`c-u-${i}`}>Unidad</Label>
                    <Input id={`c-u-${i}`} className="kw-mono uppercase" value={c.claveUnidad} onChange={(e) => setC(i, { claveUnidad: e.target.value.toUpperCase() })} />
                  </div>
                ) : (
                  <CatalogSuggest
                    clientId={clientId}
                    catalog="c_ClaveUnidad"
                    label="Unidad"
                    id={`c-u-${i}`}
                    value={c.claveUnidad}
                    mono
                    onChange={(clave) => setC(i, { claveUnidad: clave.toUpperCase() })}
                    onPick={(hit) => setC(i, { claveUnidad: hit.clave })}
                  />
                )}
              </div>
              <div>
                <Label htmlFor={`c-q-${i}`}>Cantidad</Label>
                <Input id={`c-q-${i}`} inputMode="decimal" value={c.cantidad} onChange={(e) => setC(i, { cantidad: Number(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor={`c-v-${i}`}>Precio unitario (sin IVA)</Label>
                <Input id={`c-v-${i}`} inputMode="decimal" value={c.valorUnitario} onChange={(e) => setC(i, { valorUnitario: Number(e.target.value) })} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor={`c-i-${i}`}>IVA</Label>
                <select
                  id={`c-i-${i}`}
                  className="h-10 w-full rounded-md border px-2"
                  value={c.objetoImp === "01" ? "no" : String(c.ivaTasa)}
                  onChange={(e) => setC(i, e.target.value === "no"
                    ? { objetoImp: "01", ivaTasa: undefined }
                    : { objetoImp: "02", ivaTasa: Number(e.target.value) as 0.16 | 0.08 | 0 })}
                >
                  <option value="0.16">16 %</option>
                  <option value="0.08">8 % (frontera)</option>
                  <option value="0">0 %</option>
                  <option value="no">No objeto de impuesto</option>
                </select>
              </div>
              <p className="text-xs text-destructive md:col-span-4">
                {v?.validacion.errores.filter((e) => e.campo.startsWith(`conceptos[${i}]`)).map((e) => e.mensaje).join(" ")}
              </p>
              {b.conceptos.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setB({ ...b, conceptos: b.conceptos.filter((_, j) => j !== i) })}>
                  Quitar concepto
                </Button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setB({ ...b, conceptos: [...b.conceptos, concepto()] })}>
            Agregar concepto
          </Button>
        </fieldset>

        {v && (
          <div className="rounded-xl border p-4 text-sm">
            <p>
              Subtotal <span className="kw-mono">{fmtMoney(v.validacion.totales.subtotal)}</span>
              {" · "}IVA <span className="kw-mono">{fmtMoney(v.validacion.totales.iva)}</span>
              {" · "}<strong>Total <span className="kw-mono">{fmtMoney(v.validacion.totales.total)}</span></strong>
            </p>
            {v.validacion.errores
              .filter((e) => ["csd", "moneda", "total", "emisor", "emisor.rfc", "emisor.regimen", "emisor.cp", "emisor.nombre", "metodoPago", "conceptos"].includes(e.campo))
              .map((e) => <p key={e.campo + e.mensaje} className="text-destructive">{e.mensaje}</p>)}
          </div>
        )}

        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline">Revisar datos</Button>
          <button
            type="button"
            className="kw-critical inline-flex h-10 items-center rounded-md px-4 disabled:opacity-50"
            disabled={busy || !v?.validacion.ok || !v?.emision_habilitada || (v?.expediente && !v.expediente.complete) || basicLimitReached}
            onClick={emit}
          >
            {busy ? "Emitiendo…" : "Emitir factura"}
          </button>
        </div>
      </form>
    </>
  );
}
