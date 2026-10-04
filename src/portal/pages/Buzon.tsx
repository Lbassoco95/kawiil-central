import { useState } from "react";
import { GlassPanel, KawiilitoGuide, MailboxCard, PageHead } from "../design/primitives";
import DemoModal from "../components/DemoModal";
import { pushDemoToast } from "../lib/demoStore";

export default function Buzon() {
  const [original, setOriginal] = useState<null | { title: string; folio?: string; body: string }>(null);

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
            onOpenOriginal={() => {
              setOriginal({
                title: "Requerimiento de información sobre ingresos de 2025",
                folio: "REQ-2026-0045671",
                body: "Texto de ejemplo del mensaje original del SAT (demo). En producción se abre el PDF/HTML publicado desde central.",
              });
              pushDemoToast({ tone: "info", text: "Mensaje original abierto (demo)." });
            }}
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
            onOpenOriginal={() => {
              setOriginal({
                title: "Aviso de actualización de datos del contribuyente",
                body: "Comunicado informativo de ejemplo. Sin acción requerida.",
              });
            }}
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

      <DemoModal
        open={!!original}
        title={original?.title || "Mensaje original"}
        onClose={() => setOriginal(null)}
      >
        {original?.folio ? <p className="kw-mono kw-small">Folio: {original.folio}</p> : null}
        <p className="kw-small" style={{ marginTop: 8 }}>
          {original?.body}
        </p>
      </DemoModal>
    </>
  );
}
