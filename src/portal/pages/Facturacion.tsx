import { Link } from "react-router-dom";
import { FilePlus2, Upload } from "lucide-react";
import { GlassPanel, PageHead } from "../design/primitives";

/** Vista /diseno: hub Facturación = elegir Emitir o Solicitar (no archivo SatGo). */
export default function Facturacion() {
  return (
    <>
      <PageHead
        title="Facturación"
        subtitle="Elige emitir con Facturapi o solicitar factura subiendo un ticket"
      />
      <GlassPanel style={{ marginBottom: 16 }}>
        <p className="kw-small" style={{ margin: 0 }}>
          Los CFDI del SAT viven en{" "}
          <Link className="underline" to="/diseno/ingresos">Ingresos</Link>
          {" "}y{" "}
          <Link className="underline" to="/diseno/egresos">Egresos</Link>
          . Aquí solo emitir o solicitar — nunca crear facturas desde Ingresos.
        </p>
      </GlassPanel>

      <p className="mb-3 text-sm font-medium">¿Qué quieres hacer?</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Link to="/diseno/facturas/emitir" className="block rounded-2xl border bg-card p-6 transition hover:border-[var(--kawiil-blue)]">
          <FilePlus2 className="mb-3" style={{ color: "var(--kawiil-blue)" }} />
          <h2 className="text-lg font-semibold">Emitir factura</h2>
          <p className="mt-2 text-sm text-muted-foreground">Wizard: ingreso, complemento de pago o nota de crédito.</p>
          <span className="kw-btn kw-btn--primary mt-4 inline-flex">Empezar</span>
        </Link>
        <Link to="/diseno/facturas/solicitar" className="block rounded-2xl border bg-card p-6 transition hover:border-[var(--kawiil-blue)]">
          <Upload className="mb-3" style={{ color: "var(--kawiilito-orange)" }} />
          <h2 className="text-lg font-semibold">Solicitar factura</h2>
          <p className="mt-2 text-sm text-muted-foreground">Sube un ticket o recibo (foto, galería o archivo).</p>
          <span className="kw-btn mt-4 inline-flex">Subir ticket</span>
        </Link>
      </div>
    </>
  );
}
