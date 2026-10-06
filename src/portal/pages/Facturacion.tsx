import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  GlassPanel,
  InvoiceRequestForm,
  KawiilitoGuide,
  PageHead,
  RequestTracker,
  UploadBox,
} from "../design/primitives";
import type { RequestFilter } from "../design/types";
import { addDemoRequest, loadDemoRequests, type DemoRequest } from "../lib/demoStore";

function todayLabel() {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Mexico_City",
  }).format(new Date());
}

/** Vista /diseno: Facturación = emisión / solicitud desde recibos (no archivo SatGo). */
export default function Facturacion() {
  const [items, setItems] = useState<DemoRequest[]>([]);
  const [filter, setFilter] = useState<RequestFilter>("todas");

  useEffect(() => {
    setItems(loadDemoRequests());
  }, []);

  const refresh = (next: DemoRequest) => {
    setItems((prev) => [next, ...prev.filter((p) => p.id !== next.id)]);
  };

  return (
    <>
      <PageHead
        title="Facturación"
        subtitle="Emite facturas, complemento de pago y solicita desde recibos · no es el archivo SatGo"
      />
      <GlassPanel style={{ marginBottom: 16 }}>
        <p className="kw-small" style={{ margin: 0 }}>
          Los CFDI del SAT (emitidas/recibidas y cobranza) se ven en{" "}
          <Link className="underline" to="/diseno/ingresos">Ingresos</Link>
          {" "}y{" "}
          <Link className="underline" to="/diseno/egresos">Egresos</Link>
          . Aquí: emisión Facturapi, complemento de pago PPD y solicitudes desde recibos.
        </p>
      </GlassPanel>
      <div className="kw-grid kw-main-cols">
        <div className="kw-grid">
          <InvoiceRequestForm
            onSubmitted={({ cliente, monto, concepto }) => {
              const item = addDemoRequest({
                kind: "factura",
                title: `Factura a ${cliente} por $${monto}`,
                date: todayLabel(),
                detail: concepto,
                step: 0,
              });
              refresh(item);
            }}
          />
          <UploadBox
            onUploaded={(files) => {
              const item = addDemoRequest({
                kind: "recibo",
                title: `Recibo · ${files.length} archivo${files.length === 1 ? "" : "s"} (${files[0]?.source})`,
                date: todayLabel(),
                detail: files.map((f) => f.name).join(", "),
                step: 0,
              });
              refresh(item);
            }}
          />
          <GlassPanel>
            <h3 className="kw-title" style={{ fontSize: 16 }}>Cómo se lee el reporte</h3>
            <p className="kw-small" style={{ margin: "6px 0 0" }}>
              En esta vista de diseño, solicitudes y recibos viven en el navegador (demo).
              Facturación no es el navegador de CFDI SatGo.
            </p>
          </GlassPanel>
        </div>
        <div className="kw-grid">
          <KawiilitoGuide pose="listo" title="Aquí sabes cuándo está lista">
            Solicitada → En proceso → Emitida (facturas). Subido → En revisión → Registrado (recibos). Filtra pendientes vs hechas.
          </KawiilitoGuide>
          <RequestTracker
            items={items}
            filter={filter}
            onFilterChange={setFilter}
            title="Cuáles ya se hicieron"
            subtitle="Pendiente / en proceso / hecha · datos demo locales"
          />
        </div>
      </div>
    </>
  );
}
