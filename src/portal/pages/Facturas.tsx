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
import type { DemoRequest } from "../lib/demoStore";
import { usePortal } from "../lib/session";
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

function makeRequest(
  partial: Omit<DemoRequest, "id" | "createdAt" | "statusLabel">,
): DemoRequest {
  const statusLabel: DemoRequest["statusLabel"] =
    partial.kind === "recibo" ? "Subido" : "Solicitada";
  return {
    ...partial,
    id: `auth-${Date.now()}`,
    createdAt: new Date().toISOString(),
    statusLabel,
  };
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
    // Sesión auth: sin seeds inventados (Aldea/Horizonte). Solo lo que el usuario registre aquí.
    try {
      const raw = localStorage.getItem(AUTH_REQ_KEY);
      if (!raw) {
        setItems([]);
        return;
      }
      const parsed = JSON.parse(raw) as DemoRequest[];
      setItems(Array.isArray(parsed) ? parsed : []);
    } catch {
      setItems([]);
    }
  }, []);

  const refresh = (next: DemoRequest) => {
    setItems((prev) => {
      const merged = [next, ...prev.filter((p) => p.id !== next.id)];
      try {
        localStorage.setItem(AUTH_REQ_KEY, JSON.stringify(merged));
      } catch { /* ignore */ }
      return merged;
    });
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
