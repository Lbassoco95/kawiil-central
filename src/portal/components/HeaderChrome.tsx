/**
 * Contenido del header (sin logo — el logo vive solo en la barra lateral).
 * Empresa activa · fecha México · tipo de cambio · saludo por hora del día.
 */
import { useEffect, useState, type ReactNode } from "react";
import { usePortal } from "../lib/session";
import { isDesignPreview } from "../lib/designPreview";
import { SAMPLE_CLIENT, SAMPLE_USER_NAME } from "../lib/sampleData";
import { dayPart, displayFirstName, mexicoDateLabel } from "../lib/greeting";
import { fetchTipoCambio, tcChipLabel, tcChipTitle, type TipoCambioPayload } from "../lib/tipoCambio";

type Props = {
  companySwitcher?: ReactNode;
};

export default function HeaderChrome({ companySwitcher }: Props) {
  const { me, active } = usePortal();
  const design = isDesignPreview();
  const [now, setNow] = useState(() => new Date());
  const [tc, setTc] = useState<TipoCambioPayload | null>(null);
  const [tcLoading, setTcLoading] = useState(true);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTcLoading(true);
    void fetchTipoCambio().then((data) => {
      if (!cancelled) {
        setTc(data);
        setTcLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const company =
    active?.client_name ||
    (design ? SAMPLE_CLIENT : null) ||
    me?.clients?.[0]?.client_name ||
    "Empresa";
  const userName = displayFirstName(
    design ? SAMPLE_USER_NAME : me?.full_name,
    design ? "demo.cliente@kawiil-demo.invalid" : me?.email,
  );
  const part = dayPart(now);
  const dateLabel = mexicoDateLabel(now);

  return (
    <div className="kw-header__chrome">
      <div className="kw-header__meta">
        <div className="kw-header__company" title={company}>
          {companySwitcher ?? <span className="kw-header__company-name">{company}</span>}
        </div>
        <time className="kw-header__date" dateTime={now.toISOString()}>
          {dateLabel}
        </time>
        <span
          className="kw-header__tc"
          title={tcChipTitle(tc)}
          aria-label={tcChipTitle(tc)}
        >
          <span className="kw-header__tc-label">Tipo de cambio</span>
          <span className="kw-header__tc-value kw-mono">{tcChipLabel(tc, tcLoading)}</span>
          {tc?.status === "ok" && tc.fecha ? (
            <span className="kw-header__tc-meta">{tc.fecha}</span>
          ) : (
            <span className="kw-header__tc-meta">Banxico · pendiente</span>
          )}
        </span>
      </div>
      <div className="kw-header__greet" aria-live="polite">
        <span className="kw-header__greet-part">
          {part.greeting} <span aria-hidden="true">{part.emoji}</span>
        </span>
        <span className="kw-header__greet-hola">Hola! {userName}</span>
      </div>
    </div>
  );
}
