import { useState } from "react";
import { GlassPanel, KawiilitoGuide, LineagePanel, PageHead, SourceChip } from "../design/primitives";
import { INCOME_LINEAGE } from "../lib/sampleData";
import DemoModal from "../components/DemoModal";
import type { Source } from "../design/types";

const COPY: Record<Source, { title: string; body: string }> = {
  sat: {
    title: "CFDI · SAT",
    body: "Comprobantes descargados con e.firma o CIEC (vía Moffin), filtrados y sumados por Kawiil antes de mostrarlos.",
  },
  buzon: {
    title: "Buzón tributario",
    body: "Mensajes del SAT que central publica al portal con un resumen para el cliente.",
  },
  estados: {
    title: "Estados financieros",
    body: "Disponible desde enero 2027. Hasta entonces el chip aparece como pendiente, nunca como cero inventado.",
  },
  manual: {
    title: "Captura manual",
    body: "Datos capturados a mano por tu equipo en kawiil-central y publicados al portal.",
  },
  pendiente: {
    title: "Pendiente de cargar",
    body: "La fuente existe pero aún no hay archivo o descarga. Preferimos dejar el bloque vacío a inventar cifras.",
  },
  savio: {
    title: "Savio",
    body: "Cobranza interna de Kawiil. No se muestra en Kawiil OS.",
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
            <h3 className="kw-title">Fuentes que usa Kawiil OS</h3>
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
          <LineagePanel title="Ejemplo: ingresos de septiembre" subtitle="Datos de ejemplo" steps={INCOME_LINEAGE} />
        </div>
        <KawiilitoGuide
          pose="duda"
          title="Cada número tiene un chip"
          actions={[{ label: "Ver ejemplo de rastro", primary: true, onClick: () => setOpen("sat") }]}
        >
          Toca «¿De dónde sale?» en cualquier cifra. Te muestro el rastro hasta el SAT o el archivo pendiente.
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
