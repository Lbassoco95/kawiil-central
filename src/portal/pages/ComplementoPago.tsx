import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { callApi, PortalApiError } from "../lib/api";
import { fmtMoney } from "../lib/format";
import { isDesignPreview } from "../lib/designPreview";
import { Notice, PageTitle } from "../components/ui";
import { C_FORMA_PAGO } from "../../../supabase/functions/_shared/portal/validate.ts";

type PpdRow = {
  id: string;
  uuid: string;
  nombre_receptor?: string;
  rfc_receptor?: string;
  total: number;
  paid_amount?: number;
  cobranza_estado?: string;
  facturapi_id?: string | null;
};

export default function ComplementoPago() {
  const { active } = usePortal();
  const design = isDesignPreview();
  const [ppd, setPpd] = useState<PpdRow[]>(design ? [{
    id: "design-1",
    uuid: "39C85A3F-275B-4341-B259-E8971D9F8A94",
    nombre_receptor: "CLIENTE EJEMPLO SA DE CV",
    rfc_receptor: "BBB010101BBB",
    total: 11600,
    paid_amount: 0,
    cobranza_estado: "pendiente",
  }] : []);
  const [selected, setSelected] = useState<string>(design ? "design-1" : "");
  const [amount, setAmount] = useState(design ? "11600.00" : "");
  const [formaPago, setFormaPago] = useState("03");
  const [receptorCp, setReceptorCp] = useState(design ? "64000" : "");
  const [receptorRegimen, setReceptorRegimen] = useState("601");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active || design) return;
    void (async () => {
      try {
        const r = await callApi<{ facturas: PpdRow[] }>("facturas.listar", {
          client_id: active.client_id,
          direction: "emitida",
          filters: { metodo: "PPD" },
        });
        const pending = (r.facturas ?? []).filter((f) =>
          f.cobranza_estado === "pendiente" || f.cobranza_estado === "parcial" || !f.cobranza_estado
        );
        setPpd(pending);
      } catch {
        setPpd([]);
      }
    })();
  }, [active, design]);

  if (!design && active?.role !== "administrador") {
    return <Notice tone="warn">Solo un administrador puede generar complementos de pago.</Notice>;
  }

  const row = ppd.find((p) => p.id === selected);
  const saldo = row ? Math.max(0, Number(row.total) - Number(row.paid_amount ?? 0)) : 0;

  const emit = async () => {
    if (design) {
      setMsg({ tone: "warn", text: "Vista diseño: el complemento no se envía a Facturapi." });
      return;
    }
    if (!active || !row) return;
    const monto = Number(amount);
    if (!(monto > 0) || monto > saldo + 0.009) {
      setMsg({ tone: "bad", text: "El monto debe ser mayor a cero y no exceder el saldo pendiente." });
      return;
    }
    if (!/^\d{5}$/.test(receptorCp)) {
      setMsg({ tone: "bad", text: "Indica el código postal fiscal del cliente (5 dígitos)." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await callApi<{ uuid: string; prueba: boolean; paid_amount: number }>("facturas.complemento_pago", {
        client_id: active.client_id,
        forma_pago: formaPago,
        customer: {
          rfc: row.rfc_receptor,
          nombre: row.nombre_receptor,
          regimen: receptorRegimen,
          cp: receptorCp,
        },
        related: [{
          uuid: row.uuid,
          facturapi_id: row.facturapi_id,
          amount: monto,
          last_balance: saldo,
          installment: (Number(row.paid_amount ?? 0) > 0 ? 2 : 1),
        }],
      });
      setMsg({
        tone: r.prueba ? "warn" : "ok",
        text: r.prueba
          ? `Complemento de PRUEBA ${r.uuid} por ${fmtMoney(r.paid_amount)}. Sin validez fiscal hasta llave live.`
          : `Complemento emitido: ${r.uuid} por ${fmtMoney(r.paid_amount)}.`,
      });
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof PortalApiError ? e.message : "No se pudo emitir el complemento." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle
        title="Complemento de pago"
        subtitle="Registra un cobro sobre una factura PPD (CFDI tipo P · Facturapi)."
        actions={<Link className="text-sm underline" to={design ? "/diseno/facturacion" : "/facturas"}>Volver a Facturación</Link>}
      />

      <GlassHint design={design} />

      <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); void emit(); }}>
        <fieldset className="grid gap-3 rounded-xl border p-4">
          <legend className="px-1 font-semibold">Factura PPD pendiente</legend>
          {ppd.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay facturas PPD pendientes en tu cuenta. Emite una con método PPD primero.</p>
          ) : (
            <div>
              <Label htmlFor="ppd">Factura</Label>
              <select
                id="ppd"
                className="h-10 w-full rounded-md border px-2"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  const f = ppd.find((p) => p.id === e.target.value);
                  if (f) setAmount(String(Math.max(0, Number(f.total) - Number(f.paid_amount ?? 0)).toFixed(2)));
                }}
              >
                <option value="">Elige una factura…</option>
                {ppd.map((f) => (
                  <option key={f.id} value={f.id}>
                    {(f.nombre_receptor || f.rfc_receptor || "Cliente")} · {fmtMoney(f.total)} · {f.uuid.slice(0, 8)}…
                  </option>
                ))}
              </select>
            </div>
          )}
          {row && (
            <p className="text-sm">
              Saldo pendiente: <span className="kw-mono">{fmtMoney(saldo)}</span>
            </p>
          )}
        </fieldset>

        <fieldset className="grid gap-3 rounded-xl border p-4 md:grid-cols-2">
          <legend className="px-1 font-semibold">Pago recibido</legend>
          <div>
            <Label htmlFor="monto">Monto cobrado</Label>
            <Input id="monto" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="forma">Forma de pago</Label>
            <select id="forma" className="h-10 w-full rounded-md border px-2" value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
              {C_FORMA_PAGO.filter((f) => f.clave !== "99").map((f) => (
                <option key={f.clave} value={f.clave}>{f.clave} · {f.descripcion}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="r-cp">CP fiscal del cliente</Label>
            <Input id="r-cp" className="kw-mono" inputMode="numeric" maxLength={5} value={receptorCp} onChange={(e) => setReceptorCp(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div>
            <Label htmlFor="r-reg">Régimen del cliente</Label>
            <Input id="r-reg" className="kw-mono" value={receptorRegimen} onChange={(e) => setReceptorRegimen(e.target.value)} />
          </div>
        </fieldset>

        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        <Button type="submit" className="kw-critical" disabled={busy || !row}>
          {busy ? "Emitiendo…" : "Generar complemento de pago"}
        </Button>
      </form>
    </>
  );
}

function GlassHint({ design }: { design?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
      El archivo SatGo de complementos ya publicados se consulta en{" "}
      <Link className="underline" to={design ? "/diseno/ingresos" : "/ingresos"}>Ingresos</Link>
      . Aquí solo <strong className="text-foreground font-medium">generas</strong> un complemento nuevo con Facturapi.
    </div>
  );
}
