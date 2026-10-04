import { GlassPanel, InsightList, KawiilitoGuide, PageHead } from "../design/primitives";
import { INSIGHTS } from "../lib/sampleData";

export default function Hallazgos() {
  return (
    <>
      <PageHead title="Hallazgos" subtitle="Lo que Kawiil va entendiendo de tu negocio" />
      <div className="kw-grid kw-main-cols">
        <InsightList
          items={INSIGHTS}
          footer="Solo lectura. Cada hallazgo dice en qué datos se basa. No hay chat con inteligencia artificial."
        />
        <div className="kw-grid">
          <KawiilitoGuide pose="datos" title="Esto ayuda a asesorar mejor">
            Tus respuestas y el registro del contador enseñan cómo facturas y cómo gastas. Aquí solo lees el resultado.
          </KawiilitoGuide>
          <GlassPanel tone="strong">
            <h3 className="kw-title">Estados financieros</h3>
            <p className="kw-small" style={{ margin: "6px 0 0" }}>
              Disponible desde enero 2027. Hasta entonces, los hallazgos se apoyan en CFDI del SAT y en tus respuestas cerradas.
            </p>
          </GlassPanel>
        </div>
      </div>
    </>
  );
}
