import { GlassPanel, KawiilitoGuide, LineagePanel, PageHead, SourceChip } from "../design/primitives";
import { INCOME_LINEAGE } from "../lib/sampleData";

export default function Origen() {
  return (
    <>
      <PageHead title="Origen de datos" subtitle="De dónde sale cada cifra que ves" />
      <div className="kw-grid kw-main-cols">
        <div className="kw-grid">
          <GlassPanel>
            <h3 className="kw-title">Fuentes que usa Kawiil OS</h3>
            <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gap: 12 }}>
              <li className="flex flex-wrap items-center gap-3">
                <SourceChip source="sat" />
                <span className="kw-small">CFDI del SAT descargados con e.firma o CIEC (vía Moffin).</span>
              </li>
              <li className="flex flex-wrap items-center gap-3">
                <SourceChip source="buzon" />
                <span className="kw-small">Mensajes del buzón tributario del SAT.</span>
              </li>
              <li className="flex flex-wrap items-center gap-3">
                <SourceChip source="estados" />
                <span className="kw-small">Estados financieros — disponible desde enero 2027.</span>
              </li>
              <li className="flex flex-wrap items-center gap-3">
                <SourceChip source="manual" />
                <span className="kw-small">Lo capturado a mano por tu equipo.</span>
              </li>
              <li className="flex flex-wrap items-center gap-3">
                <SourceChip source="pendiente" />
                <span className="kw-small">La fuente existe pero aún no se carga. Nunca inventamos un cero.</span>
              </li>
            </ul>
            <p className="kw-small" style={{ marginTop: 16 }}>
              La cobranza de Savio no aparece en Kawiil OS: es uso interno de Kawiil.
            </p>
          </GlassPanel>
          <LineagePanel title="Ejemplo: ingresos de septiembre" subtitle="Datos de ejemplo" steps={INCOME_LINEAGE} />
        </div>
        <KawiilitoGuide pose="duda" title="Cada número tiene un chip">
          Toca «¿De dónde sale?» en cualquier cifra. Te muestro el rastro hasta el SAT o el archivo pendiente.
        </KawiilitoGuide>
      </div>
    </>
  );
}
