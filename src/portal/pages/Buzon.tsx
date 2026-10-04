import { GlassPanel, KawiilitoGuide, MailboxCard, PageHead } from "../design/primitives";

export default function Buzon() {
  return (
    <>
      <PageHead title="Buzón tributario" subtitle="Mensajes del SAT con un resumen claro" />
      <div className="kw-grid kw-main-cols">
        <div className="kw-grid">
          <MailboxCard
            urgency="atencion"
            kind="Requerimiento"
            date="30 sep 2026"
            unread
            title="Requerimiento de información sobre ingresos de 2025"
            folio="REQ-2026-0045671"
            summary="El SAT pide aclarar la diferencia entre los ingresos que declaraste en 2025 y los CFDI que tiene registrados. Hay un plazo para responder y tu contador ya puede preparar la respuesta."
            points={[
              { label: "Qué pide", value: "Aclarar diferencia de ingresos 2025" },
              { label: "Plazo", value: "15 días hábiles desde la notificación" },
              { label: "Quién actúa", value: "Tu contador" },
            ]}
            reviewed={false}
          />
          <MailboxCard
            urgency="info"
            kind="Comunicado"
            date="12 sep 2026"
            title="Aviso de actualización de datos del contribuyente"
            summary="Es un aviso general del SAT. No pide ninguna acción de tu parte por ahora."
            points={[
              { label: "Qué es", value: "Comunicado informativo" },
              { label: "Acción", value: "Ninguna" },
            ]}
            reviewed
          />
        </div>
        <div className="kw-grid">
          <KawiilitoGuide pose="pendientes" title="Tienes 1 mensaje con plazo">
            Abre el requerimiento. Kawiil ya te dice qué pide y tu contador lo está revisando.
          </KawiilitoGuide>
          <GlassPanel>
            <h3 className="kw-title">Cómo leer estos resúmenes</h3>
            <p className="kw-small" style={{ margin: "6px 0 0" }}>
              El resumen lo prepara Kawiil a partir del mensaje del SAT. Es una guía para entenderlo rápido. Lo que vale es el mensaje original.
            </p>
          </GlassPanel>
        </div>
      </div>
    </>
  );
}
