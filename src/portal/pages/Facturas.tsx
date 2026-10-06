import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
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
import { usePortal } from "../lib/session";
import { PageTitle } from "../components/ui";

function todayLabel() {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Mexico_City",
  }).format(new Date());
}

/**
 * Facturación = emitir / solicitar factura desde recibos.
 * El archivo SatGo (CFDI + cobranza) vive en Ingresos y Egresos.
 */
export default function Facturas() {
  const { active } = usePortal();
  const [items, setItems] = useState<DemoRequest[]>([]);
  const [filter, setFilter] = useState<RequestFilter>("todas");
  const isAdmin = active?.role === "administrador";

  useEffect(() => {
    setItems(loadDemoRequests());
  }, []);

  const refresh = (next: DemoRequest) => {
    setItems((prev) => [next, ...prev.filter((p) => p.id !== next.id)]);
  };

  return (
    <>
      <PageTitle
        title="Facturación"
        subtitle={
          active
            ? `${active.client_name} · Emite facturas nuevas o pide factura desde un recibo. Los CFDI del SAT están en Ingresos y Egresos.`
            : "Emite facturas nuevas o pide factura desde un recibo. Los CFDI del SAT están en Ingresos y Egresos."
        }
        breadcrumb={["Kawiil", "Portal", "Facturación"]}
        icon={<FileText />}
      />

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <GlassPanel>
          <p className="kw-title" style={{ fontSize: 16 }}>CFDI de tu cuenta</p>
          <p className="kw-small" style={{ marginTop: 8 }}>
            Facturas emitidas y recibidas (SatGo), cobranza PUE/PPD y descarga por periodo están en{" "}
            <Link className="underline" to="/ingresos">Ingresos</Link>
            {" "}y{" "}
            <Link className="underline" to="/egresos">Egresos</Link>
            — no en esta pantalla.
          </p>
        </GlassPanel>
        {isAdmin ? (
          <GlassPanel>
            <p className="kw-title" style={{ fontSize: 16 }}>Emitir factura de ingreso</p>
            <p className="kw-small" style={{ marginTop: 8 }}>
              Genera una factura nueva a tu cliente (cuando la emisión esté activa para tu cuenta).
            </p>
            <Link className="kw-btn kw-btn--primary mt-3 inline-flex" to="/facturas/nueva">
              Crear factura
            </Link>
          </GlassPanel>
        ) : (
          <GlassPanel>
            <p className="kw-title" style={{ fontSize: 16 }}>Emisión</p>
            <p className="kw-small" style={{ marginTop: 8 }}>
              Solo un administrador del cliente puede emitir. Puedes subir recibos o pedir factura abajo.
            </p>
          </GlassPanel>
        )}
      </div>

      <PageHead
        title="Solicitudes y recibos"
        subtitle="Pide una factura o sube recibos/tickets · seguimiento en esta misma vista"
      />

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
              Solicitudes y recibos quedan en seguimiento aquí. El archivo de CFDI del SAT (emitidas/recibidas,
              montos y cobranza) se consulta en Ingresos y Egresos.
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
