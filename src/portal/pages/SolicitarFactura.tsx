import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  GlassPanel,
  InvoiceRequestForm,
  KawiilitoGuide,
  RequestTracker,
  UploadBox,
} from "../design/primitives";
import type { RequestFilter } from "../design/types";
import type { DemoRequest } from "../lib/demoStore";
import { isDesignPreview } from "../lib/designPreview";
import { PageTitle } from "../components/ui";

const AUTH_REQ_KEY = "kawiil-os-auth-requests-v1";

function todayLabel() {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Mexico_City",
  }).format(new Date());
}

function makeRequest(partial: Omit<DemoRequest, "id" | "createdAt" | "statusLabel">): DemoRequest {
  return {
    ...partial,
    id: `auth-${Date.now()}`,
    createdAt: new Date().toISOString(),
    statusLabel: partial.kind === "recibo" ? "Subido" : "Solicitada",
  };
}

/** Solicitar factura subiendo ticket/recibo (no emite CFDI). */
export default function SolicitarFactura() {
  const design = isDesignPreview();
  const [items, setItems] = useState<DemoRequest[]>([]);
  const [filter, setFilter] = useState<RequestFilter>("todas");
  const back = design ? "/diseno/facturacion" : "/facturas";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTH_REQ_KEY);
      if (!raw) { setItems([]); return; }
      const parsed = JSON.parse(raw) as DemoRequest[];
      setItems(Array.isArray(parsed) ? parsed : []);
    } catch {
      setItems([]);
    }
  }, []);

  const refresh = (next: DemoRequest) => {
    setItems((prev) => {
      const merged = [next, ...prev.filter((p) => p.id !== next.id)];
      try { localStorage.setItem(AUTH_REQ_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
      return merged;
    });
  };

  return (
    <>
      <PageTitle
        title="Solicitar factura"
        subtitle="Sube un ticket o recibo, o pide factura a un cliente · seguimiento aquí"
        actions={<Link className="text-sm underline" to={back}>Volver a Facturación</Link>}
      />

      <div className="kw-grid kw-main-cols">
        <div className="kw-grid">
          <InvoiceRequestForm
            onSubmitted={({ cliente, monto, concepto }) => {
              refresh(makeRequest({
                kind: "factura",
                title: `Factura a ${cliente} por $${monto}`,
                date: todayLabel(),
                detail: concepto,
                step: 0,
              }));
            }}
          />
          <UploadBox
            onUploaded={(files) => {
              refresh(makeRequest({
                kind: "recibo",
                title: `Recibo · ${files.length} archivo${files.length === 1 ? "" : "s"} (${files[0]?.source})`,
                date: todayLabel(),
                detail: files.map((f) => f.name).join(", "),
                step: 0,
              }));
            }}
          />
          <GlassPanel>
            <h3 className="kw-title" style={{ fontSize: 16 }}>Cómo se lee el reporte</h3>
            <p className="kw-small" style={{ margin: "6px 0 0" }}>
              Solicitudes y recibos quedan en seguimiento aquí. Emitir CFDI con Facturapi es otra acción en Facturación.
            </p>
          </GlassPanel>
        </div>
        <div className="kw-grid">
          <KawiilitoGuide pose="listo" title="Aquí sabes cuándo está lista">
            Solicitada → En proceso → Emitida (facturas). Subido → En revisión → Registrado (recibos).
          </KawiilitoGuide>
          <RequestTracker
            items={items}
            filter={filter}
            onFilterChange={setFilter}
            title="Cuáles ya se hicieron"
            subtitle="Pendiente / en proceso / hecha"
          />
        </div>
      </div>
    </>
  );
}
