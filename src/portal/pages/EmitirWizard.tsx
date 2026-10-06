import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { callApi, PortalApiError } from "../lib/api";
import { fmtMoney } from "../lib/format";
import { isDesignPreview } from "../lib/designPreview";
import {
  autoInternalId,
  loadLocalConcepts,
  loadLocalCustomers,
  saveLocalConcept,
  saveLocalCustomer,
  type SavedConcept,
  type SavedCustomer,
} from "../lib/factTemplates";
import { Notice, PageTitle, StatusPill } from "../components/ui";
import CatalogSuggest from "../components/CatalogSuggest";
import { C_FORMA_PAGO, C_REGIMEN_FISCAL, C_USO_CFDI } from "../../../supabase/functions/_shared/portal/validate.ts";
import type { ConceptoBorrador } from "../../../supabase/functions/_shared/portal/emission/types.ts";

export type DocTipo = "I" | "P" | "E";

const TIPO_META: Record<DocTipo, { title: string; blurb: string }> = {
  I: { title: "Factura de ingreso", blurb: "Venta o servicio que cobras (o cobrarás)." },
  P: { title: "Complemento de pago", blurb: "Registras un cobro sobre una factura PPD pendiente." },
  E: { title: "Nota de crédito", blurb: "Descuento o devolución ligado a una factura previa." },
};

type Receptor = { rfc: string; nombre: string; regimen: string; cp: string; uso: string; email?: string };

const emptyConcept = (): ConceptoBorrador => ({
  claveProdServ: "", claveUnidad: "E48", descripcion: "", cantidad: 1, valorUnitario: 0, objetoImp: "02", ivaTasa: 0.16,
});

function StepDots({ step, total, labels }: { step: number; total: number; labels: string[] }) {
  return (
    <ol className="mb-4 flex flex-wrap gap-2" aria-label="Pasos">
      {Array.from({ length: total }, (_, i) => (
        <li key={i}>
          <StatusPill tone={i < step ? "ok" : i === step ? "wait" : "info"}>
            {i + 1}. {labels[i] ?? `Paso ${i + 1}`}
          </StatusPill>
        </li>
      ))}
    </ol>
  );
}

export default function EmitirWizard() {
  const { active } = usePortal();
  const design = isDesignPreview();
  const [params] = useSearchParams();
  const initialTipo = (params.get("tipo") as DocTipo | null);
  const [tipo, setTipo] = useState<DocTipo | null>(
    initialTipo === "I" || initialTipo === "P" || initialTipo === "E" ? initialTipo : null,
  );
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [customers, setCustomers] = useState<SavedCustomer[]>([]);
  const [concepts, setConcepts] = useState<SavedConcept[]>([]);
  const [receptor, setReceptor] = useState<Receptor>({
    rfc: design ? "BBB010101BBB" : "",
    nombre: design ? "CLIENTE EJEMPLO SA DE CV" : "",
    regimen: "601",
    cp: design ? "64000" : "",
    uso: "G03",
  });
  const [saveCustomer, setSaveCustomer] = useState(true);
  const [customerLabel, setCustomerLabel] = useState("");

  const [conceptos, setConceptos] = useState<ConceptoBorrador[]>([
    design
      ? { claveProdServ: "80131500", claveUnidad: "E48", descripcion: "Servicios de contabilidad", cantidad: 1, valorUnitario: 5000, objetoImp: "02", ivaTasa: 0.16 }
      : emptyConcept(),
  ]);
  const [saveConcepts, setSaveConcepts] = useState(true);

  const [metodoPago, setMetodoPago] = useState<"PUE" | "PPD">("PUE");
  const [formaPago, setFormaPago] = useState("03");

  // Complemento / NC
  const [ppd, setPpd] = useState<{ id: string; uuid: string; nombre_receptor?: string; rfc_receptor?: string; total: number; paid_amount?: number }[]>([]);
  const [selectedPpd, setSelectedPpd] = useState(design ? "design-1" : "");
  const [payAmount, setPayAmount] = useState(design ? "11600.00" : "");
  const [relatedUuid, setRelatedUuid] = useState("");

  const back = design ? "/diseno/facturacion" : "/facturas";
  const clientId = active?.client_id ?? "";
  const canAdmin = design || active?.role === "administrador";

  const stepsIngreso = ["Cliente", "Conceptos", "Cobro", "Revisar"];
  const stepsPago = ["Factura PPD", "Pago", "Revisar"];
  const stepsNc = ["Cliente", "Conceptos", "Relacionar", "Revisar"];
  const stepLabels = tipo === "P" ? stepsPago : tipo === "E" ? stepsNc : stepsIngreso;
  const totalSteps = stepLabels.length;

  useEffect(() => {
    if (design) {
      setCustomers([
        { internal_id: "ejemplo", label: "Cliente ejemplo", rfc: "BBB010101BBB", nombre: "CLIENTE EJEMPLO SA DE CV", regimen: "601", cp: "64000", uso_cfdi: "G03" },
        ...loadLocalCustomers(),
      ]);
      setConcepts([
        { internal_id: "contabilidad", label: "Contabilidad", descripcion: "Servicios de contabilidad", clave_prod_serv: "80131500", clave_unidad: "E48", cantidad: 1, valor_unitario: 5000, objeto_imp: "02", iva_tasa: 0.16 },
        ...loadLocalConcepts(),
      ]);
      setPpd([{ id: "design-1", uuid: "39C85A3F-275B-4341-B259-E8971D9F8A94", nombre_receptor: "CLIENTE EJEMPLO SA DE CV", rfc_receptor: "BBB010101BBB", total: 11600, paid_amount: 0 }]);
      return;
    }
    if (!active) return;
    void (async () => {
      try {
        const [c, k] = await Promise.all([
          callApi<{ clientes: SavedCustomer[] }>("clientes.listar", { client_id: active.client_id }),
          callApi<{ plantillas: Record<string, unknown>[] }>("plantillas.listar", { client_id: active.client_id, kind: "concepto" }),
        ]);
        setCustomers((c.clientes ?? []).map((x) => ({
          internal_id: x.internal_id,
          label: x.label,
          rfc: x.rfc,
          nombre: x.nombre,
          regimen: x.regimen,
          cp: x.cp,
          uso_cfdi: x.uso_cfdi,
          email: x.email,
        })));
        setConcepts((k.plantillas ?? []).map((p) => ({
          internal_id: String(p.internal_id),
          label: String(p.label),
          descripcion: String(p.descripcion),
          clave_prod_serv: String(p.clave_prod_serv),
          clave_unidad: String(p.clave_unidad ?? "E48"),
          cantidad: Number(p.cantidad) || 1,
          valor_unitario: Number(p.valor_unitario) || 0,
          objeto_imp: p.objeto_imp === "01" ? "01" : "02",
          iva_tasa: (Number(p.iva_tasa) || 0.16) as 0.16 | 0.08 | 0,
        })));
      } catch { /* tablas aún no migradas */ }
      try {
        const r = await callApi<{ facturas: typeof ppd }>("facturas.listar", {
          client_id: active.client_id, direction: "emitida", filters: { metodo: "PPD" },
        });
        setPpd((r.facturas ?? []).filter((f) => (Number(f.total) - Number(f.paid_amount ?? 0)) > 0.009));
      } catch { setPpd([]); }
    })();
  }, [active, design]);

  const totales = useMemo(() => {
    let sub = 0;
    let iva = 0;
    for (const c of conceptos) {
      const imp = Math.round(c.cantidad * c.valorUnitario * 100) / 100;
      sub += imp;
      if (c.objetoImp === "02" && typeof c.ivaTasa === "number") iva += Math.round(imp * c.ivaTasa * 100) / 100;
    }
    return { subtotal: Math.round(sub * 100) / 100, iva: Math.round(iva * 100) / 100, total: Math.round((sub + iva) * 100) / 100 };
  }, [conceptos]);

  if (!canAdmin) {
    return <Notice tone="warn">Solo un administrador del cliente puede emitir.</Notice>;
  }

  const pickTipo = (t: DocTipo) => {
    setTipo(t);
    setStep(0);
    setMsg(null);
  };

  const applyCustomer = (c: SavedCustomer) => {
    setReceptor({
      rfc: c.rfc,
      nombre: c.nombre,
      regimen: c.regimen,
      cp: c.cp,
      uso: c.uso_cfdi || "G03",
      email: c.email,
    });
    setCustomerLabel(c.label);
  };

  const applyConcept = (c: SavedConcept) => {
    setConceptos((prev) => [...prev.filter((x) => x.descripcion || x.claveProdServ), {
      claveProdServ: c.clave_prod_serv,
      claveUnidad: c.clave_unidad,
      descripcion: c.descripcion,
      cantidad: c.cantidad,
      valorUnitario: c.valor_unitario,
      objetoImp: c.objeto_imp,
      ivaTasa: c.iva_tasa,
    }]);
  };

  const persistReuse = async () => {
    if (design) {
      if (saveCustomer && receptor.rfc) {
        saveLocalCustomer({
          internal_id: autoInternalId("cli"),
          label: customerLabel || receptor.nombre,
          rfc: receptor.rfc,
          nombre: receptor.nombre,
          regimen: receptor.regimen,
          cp: receptor.cp,
          uso_cfdi: receptor.uso,
        });
      }
      if (saveConcepts) {
        for (const c of conceptos) {
          if (!c.descripcion || !c.claveProdServ) continue;
          saveLocalConcept({
            internal_id: autoInternalId("con"),
            label: c.descripcion.slice(0, 40),
            descripcion: c.descripcion,
            clave_prod_serv: c.claveProdServ,
            clave_unidad: c.claveUnidad,
            cantidad: c.cantidad,
            valor_unitario: c.valorUnitario,
            objeto_imp: c.objetoImp,
            iva_tasa: c.ivaTasa,
          });
        }
      }
      return;
    }
    if (!active) return;
    if (saveCustomer && receptor.rfc) {
      await callApi("clientes.guardar", {
        client_id: active.client_id,
        label: customerLabel || receptor.nombre,
        rfc: receptor.rfc,
        nombre: receptor.nombre,
        regimen: receptor.regimen,
        cp: receptor.cp,
        uso_cfdi: receptor.uso,
        email: receptor.email,
      });
    }
    if (saveConcepts) {
      for (const c of conceptos) {
        if (!c.descripcion || !c.claveProdServ) continue;
        await callApi("plantillas.guardar", {
          client_id: active.client_id,
          kind: "concepto",
          label: c.descripcion.slice(0, 40),
          descripcion: c.descripcion,
          clave_prod_serv: c.claveProdServ,
          clave_unidad: c.claveUnidad,
          cantidad: c.cantidad,
          valor_unitario: c.valorUnitario,
          objeto_imp: c.objetoImp,
          iva_tasa: c.ivaTasa,
        });
      }
    }
  };

  const emit = async () => {
    if (design) {
      setMsg({ tone: "warn", text: "Vista diseño: no se envía a Facturapi." });
      return;
    }
    if (!active) return;
    setBusy(true);
    setMsg(null);
    try {
      await persistReuse();
      if (tipo === "I") {
        const r = await callApi<{ uuid: string; prueba: boolean; totales: { total: number } }>("facturas.crear", {
          client_id: active.client_id,
          borrador: { receptor, formaPago, metodoPago, moneda: "MXN", conceptos },
        });
        setMsg({ tone: r.prueba ? "warn" : "ok", text: `Factura ${r.uuid} · ${fmtMoney(r.totales.total)}` });
      } else if (tipo === "P") {
        const row = ppd.find((p) => p.id === selectedPpd);
        if (!row) throw new PortalApiError("dato", "Elige la factura PPD.");
        const r = await callApi<{ uuid: string; prueba: boolean; paid_amount: number }>("facturas.complemento_pago", {
          client_id: active.client_id,
          forma_pago: formaPago,
          customer: { rfc: row.rfc_receptor ?? receptor.rfc, nombre: row.nombre_receptor ?? receptor.nombre, regimen: receptor.regimen, cp: receptor.cp },
          related: [{ uuid: row.uuid, amount: Number(payAmount), last_balance: Number(row.total) - Number(row.paid_amount ?? 0) }],
        });
        setMsg({ tone: r.prueba ? "warn" : "ok", text: `Complemento ${r.uuid} · ${fmtMoney(r.paid_amount)}` });
      } else {
        const r = await callApi<{ uuid: string; prueba: boolean; total: number }>("facturas.nota_credito", {
          client_id: active.client_id,
          related_uuid: relatedUuid,
          borrador: { receptor, formaPago: formaPago || "03", metodoPago: "PUE", moneda: "MXN", conceptos },
        });
        setMsg({ tone: r.prueba ? "warn" : "ok", text: `Nota de crédito ${r.uuid} · ${fmtMoney(r.total)}` });
      }
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof PortalApiError ? e.message : "No se pudo emitir." });
    } finally {
      setBusy(false);
    }
  };

  // ── Pantalla: elegir tipo ──
  if (!tipo) {
    return (
      <>
        <PageTitle
          title="Emitir"
          subtitle="Elige el tipo de comprobante. Luego te guiamos campo por campo."
          actions={<Link className="text-sm underline" to={back}>Volver</Link>}
        />
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(TIPO_META) as DocTipo[]).map((t) => (
            <button
              key={t}
              type="button"
              className="rounded-2xl border bg-card p-5 text-left transition hover:border-[var(--kawiil-blue)]"
              onClick={() => pickTipo(t)}
            >
              <p className="kw-mono text-xs text-muted-foreground">{t}</p>
              <h2 className="mt-1 text-lg font-semibold">{TIPO_META[t].title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{TIPO_META[t].blurb}</p>
            </button>
          ))}
        </div>
      </>
    );
  }

  const setC = (i: number, patch: Partial<ConceptoBorrador>) =>
    setConceptos((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const nav = (
    <div className="mt-4 flex flex-wrap gap-2">
      {step > 0 && <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>Atrás</Button>}
      {step < totalSteps - 1 && (
        <Button type="button" onClick={() => setStep((s) => s + 1)}>Continuar</Button>
      )}
      {step === totalSteps - 1 && (
        <button type="button" className="kw-critical inline-flex h-10 items-center rounded-md px-4 disabled:opacity-50" disabled={busy} onClick={() => void emit()}>
          {busy ? "Emitiendo…" : "Emitir"}
        </button>
      )}
      <Button type="button" variant="ghost" onClick={() => { setTipo(null); setStep(0); }}>Cambiar tipo</Button>
    </div>
  );

  return (
    <>
      <PageTitle
        title={TIPO_META[tipo].title}
        subtitle="Wizard Facturapi · puedes reutilizar datos y cambiarlos al emitir"
        actions={<Link className="text-sm underline" to={back}>Volver a Facturación</Link>}
      />
      <StepDots step={step} total={totalSteps} labels={stepLabels} />

      {/* ── Ingreso / NC: cliente ── */}
      {(tipo === "I" || tipo === "E") && step === 0 && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">1. Cliente</h2>
          {customers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {customers.map((c) => (
                <Button key={c.internal_id} type="button" size="sm" variant="secondary" onClick={() => applyCustomer(c)}>
                  {c.label}
                </Button>
              ))}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>RFC</Label><Input className="kw-mono uppercase" value={receptor.rfc} onChange={(e) => setReceptor({ ...receptor, rfc: e.target.value.toUpperCase() })} /></div>
            <div><Label>Nombre o razón social</Label><Input value={receptor.nombre} onChange={(e) => setReceptor({ ...receptor, nombre: e.target.value.toUpperCase() })} /></div>
            <div><Label>CP fiscal</Label><Input className="kw-mono" maxLength={5} value={receptor.cp} onChange={(e) => setReceptor({ ...receptor, cp: e.target.value.replace(/\D/g, "") })} /></div>
            <div>
              <Label>Régimen</Label>
              <select className="h-10 w-full rounded-md border px-2" value={receptor.regimen} onChange={(e) => setReceptor({ ...receptor, regimen: e.target.value })}>
                {C_REGIMEN_FISCAL.map((r) => <option key={r.clave} value={r.clave}>{r.clave} · {r.descripcion}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <Label>Uso CFDI</Label>
              <select className="h-10 w-full rounded-md border px-2" value={receptor.uso} onChange={(e) => setReceptor({ ...receptor, uso: e.target.value })}>
                {C_USO_CFDI.map((u) => <option key={u.clave} value={u.clave}>{u.clave} · {u.descripcion}</option>)}
              </select>
            </div>
            <div>
              <Label>Nombre para guardar</Label>
              <Input value={customerLabel} onChange={(e) => setCustomerLabel(e.target.value)} placeholder="Ej. Cliente mensual" />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={saveCustomer} onChange={(e) => setSaveCustomer(e.target.checked)} />
              Guardar cliente para reutilizar
            </label>
          </div>
          {nav}
        </section>
      )}

      {/* ── Ingreso / NC: conceptos ── */}
      {(tipo === "I" || tipo === "E") && step === 1 && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">2. Conceptos y montos</h2>
          {concepts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {concepts.map((c) => (
                <Button key={c.internal_id} type="button" size="sm" variant="outline" onClick={() => applyConcept(c)}>
                  + {c.label} · {fmtMoney(c.valor_unitario)}
                </Button>
              ))}
            </div>
          )}
          {conceptos.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-3 md:grid-cols-6">
              <div className="md:col-span-2">
                <Label>Descripción</Label>
                <Input value={c.descripcion} onChange={(e) => setC(i, { descripcion: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                {design ? (
                  <>
                    <Label>Clave SAT</Label>
                    <Input className="kw-mono" value={c.claveProdServ} onChange={(e) => setC(i, { claveProdServ: e.target.value.replace(/\D/g, "") })} />
                    <ul className="mt-1 text-sm">
                      <li><button type="button" className="text-left underline" onClick={() => setC(i, { claveProdServ: "80131500" })}>80131500 · Contabilidad</button></li>
                      <li><button type="button" className="text-left underline" onClick={() => setC(i, { claveProdServ: "80101500" })}>80101500 · Consultoría</button></li>
                    </ul>
                  </>
                ) : (
                  <CatalogSuggest
                    clientId={clientId}
                    catalog="c_ClaveProdServ"
                    label="Clave SAT"
                    value={c.claveProdServ}
                    descripcionHint={c.descripcion}
                    mono
                    maxLength={8}
                    onChange={(clave) => setC(i, { claveProdServ: clave })}
                    onPick={(hit) => setC(i, { claveProdServ: hit.clave, descripcion: c.descripcion || hit.descripcion })}
                  />
                )}
              </div>
              <div><Label>Cantidad</Label><Input inputMode="decimal" value={c.cantidad} onChange={(e) => setC(i, { cantidad: Number(e.target.value) })} /></div>
              <div><Label>Precio (sin IVA)</Label><Input inputMode="decimal" value={c.valorUnitario} onChange={(e) => setC(i, { valorUnitario: Number(e.target.value) })} /></div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setConceptos([...conceptos, emptyConcept()])}>Agregar concepto</Button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={saveConcepts} onChange={(e) => setSaveConcepts(e.target.checked)} />
              Guardar conceptos y montos
            </label>
          </div>
          <p className="text-sm">Subtotal {fmtMoney(totales.subtotal)} · IVA {fmtMoney(totales.iva)} · <strong>Total {fmtMoney(totales.total)}</strong></p>
          {nav}
        </section>
      )}

      {/* ── Ingreso: cobro ── */}
      {tipo === "I" && step === 2 && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">3. Cobro</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>¿Ya te pagaron?</Label>
              <select className="h-10 w-full rounded-md border px-2" value={metodoPago} onChange={(e) => {
                const m = e.target.value as "PUE" | "PPD";
                setMetodoPago(m);
                setFormaPago(m === "PPD" ? "99" : (formaPago === "99" ? "03" : formaPago));
              }}>
                <option value="PUE">Sí · PUE</option>
                <option value="PPD">Aún no · PPD</option>
              </select>
            </div>
            <div>
              <Label>Forma de pago</Label>
              <select className="h-10 w-full rounded-md border px-2" value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
                {C_FORMA_PAGO.map((f) => <option key={f.clave} value={f.clave}>{f.clave} · {f.descripcion}</option>)}
              </select>
            </div>
          </div>
          {nav}
        </section>
      )}

      {/* ── NC: relacionar ── */}
      {tipo === "E" && step === 2 && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">3. Factura relacionada</h2>
          <p className="text-sm text-muted-foreground">UUID de la factura de ingreso a la que aplica el descuento (relación 01).</p>
          <Label>UUID</Label>
          <Input className="kw-mono uppercase" value={relatedUuid} onChange={(e) => setRelatedUuid(e.target.value.toUpperCase())} placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" />
          {nav}
        </section>
      )}

      {/* ── Pago: elegir PPD ── */}
      {tipo === "P" && step === 0 && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">1. Factura PPD pendiente</h2>
          {ppd.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay PPD pendientes. Emite primero una factura de ingreso con método PPD.</p>
          ) : (
            <select className="h-10 w-full rounded-md border px-2" value={selectedPpd} onChange={(e) => {
              setSelectedPpd(e.target.value);
              const f = ppd.find((p) => p.id === e.target.value);
              if (f) setPayAmount(String(Math.max(0, Number(f.total) - Number(f.paid_amount ?? 0)).toFixed(2)));
            }}>
              <option value="">Elige…</option>
              {ppd.map((f) => (
                <option key={f.id} value={f.id}>{(f.nombre_receptor || f.rfc_receptor)} · {fmtMoney(f.total)}</option>
              ))}
            </select>
          )}
          {nav}
        </section>
      )}

      {/* ── Pago: monto ── */}
      {tipo === "P" && step === 1 && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">2. Pago recibido</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>Monto</Label><Input inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></div>
            <div>
              <Label>Forma de pago</Label>
              <select className="h-10 w-full rounded-md border px-2" value={formaPago === "99" ? "03" : formaPago} onChange={(e) => setFormaPago(e.target.value)}>
                {C_FORMA_PAGO.filter((f) => f.clave !== "99").map((f) => <option key={f.clave} value={f.clave}>{f.clave} · {f.descripcion}</option>)}
              </select>
            </div>
            <div><Label>CP del cliente</Label><Input className="kw-mono" maxLength={5} value={receptor.cp} onChange={(e) => setReceptor({ ...receptor, cp: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label>Régimen</Label><Input className="kw-mono" value={receptor.regimen} onChange={(e) => setReceptor({ ...receptor, regimen: e.target.value })} /></div>
          </div>
          {nav}
        </section>
      )}

      {/* ── Revisar ── */}
      {((tipo === "I" && step === 3) || (tipo === "P" && step === 2) || (tipo === "E" && step === 3)) && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">Revisar y emitir</h2>
          <ul className="space-y-1 text-sm">
            <li>Tipo: <strong>{TIPO_META[tipo].title}</strong></li>
            {tipo !== "P" && (
              <>
                <li>Cliente: {receptor.nombre} · <span className="kw-mono">{receptor.rfc}</span></li>
                <li>Total: <span className="kw-mono">{fmtMoney(totales.total)}</span></li>
              </>
            )}
            {tipo === "I" && <li>Método: {metodoPago} · Forma: {formaPago}</li>}
            {tipo === "P" && <li>Monto complemento: <span className="kw-mono">{fmtMoney(Number(payAmount) || 0)}</span></li>}
            {tipo === "E" && relatedUuid && <li>Relacionada: <span className="kw-mono">{relatedUuid}</span></li>}
          </ul>
          <p className="text-xs text-muted-foreground">Los datos guardados se pueden cambiar en cualquier emisión futura.</p>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {nav}
        </section>
      )}
    </>
  );
}
