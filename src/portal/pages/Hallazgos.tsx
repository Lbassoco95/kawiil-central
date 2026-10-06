import { GlassPanel, InsightList, KawiilitoGuide, PageHead } from "../design/primitives";
import { INSIGHTS } from "../lib/sampleData";

export default function Hallazgos() {
  return (
    <>
      <PageHead
        title="Seguimientos de Kawiil"
        subtitle="Tu información y los seguimientos que el equipo anota en kawiil-central"
      />
      <div className="kw-grid kw-main-cols">
        <InsightList
          items={INSIGHTS}
          title="Seguimientos de Kawiil"
          subtitle="No es un feed genérico: cada hallazgo está ligado a una acción del equipo."
          footer="Solo lectura en el portal. Se actualiza cuando el equipo publica o avanza un seguimiento en central. No hay chat con inteligencia artificial."
        />
        <div className="kw-grid">
          <KawiilitoGuide pose="datos" title="Esto viene del seguimiento en central">
            En kawiil-central el equipo anota hallazgos y próximos pasos. Aquí ves el resultado para tu empresa.
          </KawiilitoGuide>
          <GlassPanel tone="strong">
            <h3 className="kw-title">Qué falta cablear</h3>
            <p className="kw-small" style={{ margin: "6px 0 0" }}>
              Publicación automática central → OS (API/RPC). Mientras tanto: datos de ejemplo en el portal y pestaña
              «Seguimientos» en Portal de clientes (central) para anotar demos locales.
            </p>
          </GlassPanel>
          <GlassPanel>
            <h3 className="kw-title">Estados financieros</h3>
            <p className="kw-small" style={{ margin: "6px 0 0" }}>
              Disponible desde enero 2027. Hasta entonces, los seguimientos se apoyan en CFDI del SAT, buzón y notas del equipo.
            </p>
          </GlassPanel>
        </div>
      </div>
    </>
  );
}
