import { Link } from "react-router-dom";
import { FilePlus2, FileText, Upload } from "lucide-react";
import { GlassPanel } from "../design/primitives";
import { usePortal } from "../lib/session";
import { isDesignPreview } from "../lib/designPreview";
import { PageTitle } from "../components/ui";

/**
 * Hub Facturación: solo elegir Emitir o Solicitar.
 * Ingresos = archivo SatGo; aquí no se listan CFDI.
 */
export default function Facturas() {
  const { active } = usePortal();
  const design = isDesignPreview();
  const isAdmin = design || active?.role === "administrador";
  const base = design ? "/diseno" : "";

  return (
    <>
      <PageTitle
        title="Facturación"
        subtitle={
          active
            ? `${active.client_name} · Emite con Facturapi o pide factura subiendo un ticket. Los CFDI del SAT están solo en Ingresos y Egresos.`
            : "Emite con Facturapi o pide factura subiendo un ticket. Los CFDI del SAT están solo en Ingresos y Egresos."
        }
        breadcrumb={["Kawiil", "Portal", "Facturación"]}
        icon={<FileText />}
      />

      <GlassPanel style={{ marginBottom: 16 }}>
        <p className="kw-small" style={{ margin: 0 }}>
          Aquí no verás el archivo SatGo. Para CFDI ya publicados y cobranza PUE/PPD ve a{" "}
          <Link className="underline" to={design ? "/diseno/ingresos" : "/ingresos"}>Ingresos</Link>
          {" "}o{" "}
          <Link className="underline" to={design ? "/diseno/egresos" : "/egresos"}>Egresos</Link>.
        </p>
      </GlassPanel>

      <p className="mb-3 text-sm font-medium" style={{ color: "var(--ink)" }}>¿Qué quieres hacer?</p>

      <div className="grid gap-4 md:grid-cols-2">
        {isAdmin ? (
          <Link
            to={`${base}/facturas/emitir`}
            className="block rounded-2xl border bg-card p-6 transition hover:border-[var(--kawiil-blue)] hover:shadow-sm"
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "color-mix(in srgb, var(--kawiil-blue) 12%, white)" }}>
              <FilePlus2 style={{ color: "var(--kawiil-blue)" }} size={22} />
            </div>
            <h2 className="text-lg font-semibold">Emitir factura</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Wizard paso a paso: factura de ingreso, complemento de pago o nota de crédito. Reutiliza clientes, conceptos y montos.
            </p>
            <span className="kw-btn kw-btn--primary mt-4 inline-flex">Empezar</span>
          </Link>
        ) : (
          <GlassPanel>
            <h2 className="text-lg font-semibold">Emitir factura</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Solo un administrador del cliente puede emitir. Puedes solicitar factura subiendo un ticket.
            </p>
          </GlassPanel>
        )}

        <Link
          to={`${base}/facturas/solicitar`}
          className="block rounded-2xl border bg-card p-6 transition hover:border-[var(--kawiil-blue)] hover:shadow-sm"
        >
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "color-mix(in srgb, var(--kawiilito-orange) 14%, white)" }}>
            <Upload style={{ color: "var(--kawiilito-orange)" }} size={22} />
          </div>
          <h2 className="text-lg font-semibold">Solicitar factura</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Sube un ticket o recibo (foto, galería o archivo) para que te facturen.
          </p>
          <span className="kw-btn mt-4 inline-flex">Subir ticket</span>
        </Link>
      </div>
    </>
  );
}
