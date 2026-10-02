import { useEffect, useState } from "react";
import { usePortal } from "../lib/session";
import { callApi } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Empty, Notice, PageTitle, StatusPill } from "../components/ui";

interface Alerta {
  id: string; alert_type: string; severity: string; title: string; detail: string | null;
  related_uuid: string | null; detected_at: string | null; published_at: string;
}

interface Notif {
  id: string; title: string; body: string | null; notification_type: string;
  notified_at: string | null; obtained_at: string | null; file_name: string | null; published_at: string;
}

const TYPE_LABEL: Record<string, string> = {
  efos: "EFOS / 69-B", cancelacion: "Cancelación", lista_69b: "Lista 69-B", otro: "Otra",
};
const SEV: Record<string, "ok" | "warn" | "bad" | "wait"> = {
  info: "wait", warn: "warn", critical: "bad",
};

export default function Alertas() {
  const { active } = usePortal();
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [notifs, setNotifs] = useState<Notif[]>([]);

  useEffect(() => {
    if (!active) return;
    void Promise.all([
      callApi<{ alertas: Alerta[] }>("alertas.listar", { client_id: active.client_id }).then((r) => setAlertas(r.alertas)),
      callApi<{ notificaciones: Notif[] }>("sat.notificaciones", { client_id: active.client_id }).then((r) => setNotifs(r.notificaciones)),
    ]).catch(() => { setAlertas([]); setNotifs([]); });
  }, [active]);

  return (
    <>
      <PageTitle title="Alertas y notificaciones SAT" subtitle="Publicadas por Kawiil como parte del espejo del servicio. Solo lectura." />
      <div className="mb-3"><Notice tone="info">Incluye avisos EFOS/69-B, cancelaciones y notificaciones del SAT que central ya obtuvo. No se consulta el SAT desde esta pantalla.</Notice></div>

      <section className="mb-6" aria-labelledby="a-alertas">
        <h2 id="a-alertas" className="mb-2 text-lg">Alertas</h2>
        {alertas.length === 0 ? <Empty>Sin alertas publicadas.</Empty> : (
          <ul className="space-y-2">{alertas.map((a) => (
            <li key={a.id} className="rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={SEV[a.severity] ?? "wait"}>{TYPE_LABEL[a.alert_type] ?? a.alert_type}</StatusPill>
                <span className="font-medium">{a.title}</span>
              </div>
              {a.detail && <p className="mt-1 text-sm text-muted-foreground">{a.detail}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {a.related_uuid && <span className="kw-mono">{a.related_uuid} · </span>}
                detectada {fmtDate(a.detected_at)} · publicada {fmtDate(a.published_at)}
              </p>
            </li>
          ))}</ul>
        )}
      </section>

      <section aria-labelledby="a-notif">
        <h2 id="a-notif" className="mb-2 text-lg">Notificaciones del SAT</h2>
        {notifs.length === 0 ? <Empty>Sin notificaciones publicadas.</Empty> : (
          <ul className="space-y-2">{notifs.map((n) => (
            <li key={n.id} className="rounded-lg border bg-card p-3">
              <p className="font-medium">{n.title}</p>
              {n.body && <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                notificada {fmtDate(n.notified_at)} · obtenida {fmtDate(n.obtained_at)} · publicada {fmtDate(n.published_at)}
                {n.file_name && <> · {n.file_name}</>}
              </p>
            </li>
          ))}</ul>
        )}
      </section>
    </>
  );
}
