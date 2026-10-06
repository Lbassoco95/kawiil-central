import { useNavigate } from "react-router-dom";
import { GlassPanel, KawiilitoGuide, PageHead, TeamChat, TeamRoster } from "../design/primitives";
import { CHAT, TEAM } from "../lib/sampleData";
import { portalPath } from "../lib/basePath";
import { isDesignPreview } from "../lib/designPreview";

export default function Mensajes() {
  const navigate = useNavigate();
  const facturacionTo = isDesignPreview() ? "/facturacion" : "/facturas";
  return (
    <>
      <PageHead title="Mensajes" subtitle="Tu equipo contable y legal" />
      <div className="kw-grid kw-main-cols">
        <TeamChat members={TEAM} messages={CHAT} status="Equipo en línea" />
        <div className="kw-grid">
          <KawiilitoGuide
            pose="saluda"
            title="Tu equipo te atiende aquí"
            actions={[
              {
                label: "Ir a Facturación",
                primary: true,
                onClick: () => navigate(portalPath(facturacionTo)),
              },
            ]}
          >
            Escribe cuando tengas una duda contable o legal. Para emitir o pedir factura desde un recibo, ve a Facturación. Los CFDI del SAT están en Ingresos y Egresos. No hay asistente de IA.
          </KawiilitoGuide>
          <GlassPanel>
            <h3 className="kw-title">Quién te atiende</h3>
            <div style={{ marginTop: 12 }}>
              <TeamRoster members={TEAM} />
            </div>
            <p className="kw-small" style={{ margin: "12px 0 0" }}>
              Son las personas asignadas a tu proyecto contable y legal.
            </p>
          </GlassPanel>
        </div>
      </div>
    </>
  );
}
