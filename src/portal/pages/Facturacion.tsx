import {
  InvoiceRequestForm,
  KawiilitoGuide,
  PageHead,
  RequestTracker,
  UploadBox,
} from "../design/primitives";
import { REQUESTS } from "../lib/sampleData";

export default function Facturacion() {
  return (
    <>
      <PageHead title="Facturación" subtitle="Pide una factura o sube tus recibos" />
      <div className="kw-grid kw-main-cols">
        <div className="kw-grid">
          <InvoiceRequestForm />
          <UploadBox />
        </div>
        <div className="kw-grid">
          <KawiilitoGuide pose="listo" title="Aquí sabes cuándo está lista">
            Tu equipo emite la factura y la sube. Verás el folio fiscal y podrás descargarla.
          </KawiilitoGuide>
          <RequestTracker items={REQUESTS} />
        </div>
      </div>
    </>
  );
}
