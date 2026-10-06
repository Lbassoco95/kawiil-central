import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  GlassPanel,
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

function makeTicketRequest(partial: Omit<DemoRequest, "id" | "createdAt" | "statusLabel" | "kind">): DemoRequest {
  return {
    ...partial,
    kind: "recibo",
    id: `auth-${Date.now()}`,
    createdAt: new Date().toISOString(),
    statusLabel: "Subido",
  };
}

/**
 * Subir ticket/recibo para que Kawiil emita la factura del cliente.
 * No es «solicitar factura» a un proveedor.
 */
export default function SubirTicket() {
  const design = isDesignPreview();
  const [items, setItems] = useState<DemoRequest[]>([]);
  const [filter, setFilter] = useState<RequestFilter>("todas");
  const back = design ? "/diseno/facturacion" : "/facturas";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTH_REQ_KEY);
      if (!raw) { setItems([]); return; }
      const parsed = JSON.parse(raw) as DemoRequest[];
      // Solo tickets/recibos en este espacio (emisión por Kawiil).
      setItems(Array.isArray(parsed) ? parsed.filter((p) => p.kind === "recibo") : []);
    } catch {
      setItems([]);
    }
  }, []);

  const refresh = (next: DemoRequest) => {
    setItems((prev) => {
      const merged = [next, ...prev.filter((p) => p.id !== next.id)];
      try {
        const raw = localStorage.getItem(AUTH_REQ_KEY);
        const all = raw ? (JSON.parse(raw) as DemoRequest[]) : [];
        const nonRecibo = Array.isArray(all) ? all.filter((p) => p.kind !== "recibo") : [];
        localStorage.setItem(AUTH_REQ_KEY, JSON.stringify([...merged, ...nonRecibo]));
      } catch { /* ignore */ }
      return merged;
    });
  };

  return (
    <>
      <PageTitle
        title="Subir ticket"
        subtitle="Sube un ticket o recibo para que emitamos tu factura · seguimiento aquí"
        actions={<Link className="text-sm underline" to={back}>Volver a Facturación</Link>}
      />

      <div className="kw-grid kw-main-cols">
        <div className="kw-grid">
          <UploadBox
            onUploaded={(files) => {
              refresh(makeTicketRequest({
                title: `Ticket · ${files.length} archivo${files.length === 1 ? "" : "s"} (${files[0]?.source})`,
                date: todayLabel(),
                detail: files.map((f) => f.name).join(", "),
                step: 0,
              }));
            }}
          />
          <GlassPanel>
            <h3 className="kw-title" style={{ fontSize: 16 }}>Qué pasa después</h3>
            <p className="kw-small" style={{ margin: "6px 0 0" }}>
              El equipo de Kawiil revisa el ticket y emite tu factura. Para emitir tú mismo con Facturapi (ingreso, complemento o nota de crédito), vuelve al hub y elige «Emitir factura».
            </p>
          </GlassPanel>
        </div>
        <div className="kw-grid">
          <KawiilitoGuide pose="listo" title="Aquí sabes cuándo está lista">
            Subido → En revisión → Factura emitida. No es pedir factura a un proveedor: nosotros la emitimos por ti.
          </KawiilitoGuide>
          <RequestTracker
            items={items}
            filter={filter}
            onFilterChange={setFilter}
            title="Tickets en seguimiento"
            subtitle="Pendiente / en proceso / emitida"
          />
        </div>
      </div>
    </>
  );
}
