import { useState } from "react";
import { GlassPanel, KawiilitoGuide, LineagePanel, PageHead, SourceChip } from "../design/primitives";
import { INCOME_LINEAGE } from "../lib/sampleData";
import DemoModal from "../components/DemoModal";
import type { Source } from "../design/types";

const COPY: Record<Source, { title: string; body: string }> = {
  sat: {
    title: "CFDI · SAT",
    body: "Son las facturas (CFDI) de tu cuenta. El equipo de Kawiil las obtiene del SAT y las deja listas aquí para que las consultes. Desde esta pantalla no se descarga ni se consulta el SAT.",
  },
  buzon: {
    title: "Buzón tributario",
    body: "Avisos del SAT relacionados con tu cuenta, ya listos en el portal con un resumen claro.",
  },
  estados: {
    title: "Estados financieros",
    body: "Disponible desde enero 2027. Hasta entonces el chip aparece como pendiente, nunca como cero inventado.",
  },
  manual: {
    title: "Captura manual",
    body: "Datos que tu equipo de Kawiil registró a mano y dejó disponibles en tu cuenta.",
  },
  pendiente: {
    title: "Pendiente",
    body: "Aún no hay cifra lista para mostrar. Preferimos dejar el bloque vacío a inventar números.",
  },
  savio: {
    title: "Savio",
    body: "Cobranza interna de Kawiil. No se muestra en el portal del cliente.",
  },
};

export default function Origen() {
  const [open, setOpen] = useState<Source | null>(null);

  return (
    <>
      <PageHead title="Origen de datos" subtitle="De dónde sale cada cifra que ves" />
      <div className="kw-grid kw-main-cols">
        <div className="kw-grid">
          <GlassPanel>
            <h3 className="kw-title">De dónde salen tus cifras</h3>
            <p className="kw-small" style={{ marginTop: 8 }}>
              Aquí ves la información de tu cuenta que el equipo de Kawiil ya tiene lista. En esta fase solo consultas; no hay cargas ni consultas al SAT desde el portal.
            </p>
            <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gap: 12 }}>
              {(["sat", "buzon", "estados", "manual", "pendiente"] as Source[]).map((source) => (
                <li key={source} className="flex flex-wrap items-center gap-3">
                  <SourceChip source={source} onClick={() => setOpen(source)} />
                  <span className="kw-small">{COPY[source].body}</span>
                </li>
              ))}
            </ul>
            <p className="kw-small" style={{ marginTop: 16 }}>
              La cobranza de Savio no aparece en Kawiil OS: es uso interno de Kawiil.
            </p>
          </GlassPanel>
          <LineagePanel title="Ejemplo: ingresos de septiembre" subtitle="Datos de ejemplo (fixture demo)" steps={INCOME_LINEAGE} />
        </div>
        <KawiilitoGuide
          pose="duda"
          title="Cada número tiene un chip"
          actions={[{ label: "Ver ejemplo de rastro", primary: true, onClick: () => setOpen("sat") }]}
        >
          Toca «¿De dónde sale?» en cualquier cifra. Te muestro el rastro de esa factura o dato en tu cuenta.
        </KawiilitoGuide>
      </div>

      <DemoModal
        open={!!open}
        title={open ? COPY[open].title : "Origen"}
        onClose={() => setOpen(null)}
      >
        <p className="kw-small">{open ? COPY[open].body : null}</p>
      </DemoModal>
    </>
  );
}
