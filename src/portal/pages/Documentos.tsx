import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { usePortal } from "../lib/session";
import { callApi } from "../lib/api";
import { fmtDate, MONTHS } from "../lib/format";
import { Empty, Notice, PageTitle, StatusPill } from "../components/ui";

interface Doc {
  id: string; title: string; doc_type: string; period_year: number; period_month: number | null;
  published_at: string; obtained_at: string | null; opinion_result: string | null; file_name: string;
}
const TYPES: Record<string, string> = {
  declaracion: "Declaraciones", pago: "Pagos", opinion_cumplimiento: "Opinión de cumplimiento", constancia: "Constancia de situación fiscal",
  estado_financiero: "Estados financieros", contrato: "Contratos", otro: "Otros",
};

export default function Documentos() {
  const { active, me } = usePortal();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [year, setYear] = useState<number | "todos">("todos");
  useEffect(() => {
    if (!active) return;
    callApi<{ documentos: Doc[] }>("documentos.listar", { client_id: active.client_id })
      .then((data) => setDocs(data.documentos)).catch(() => setDocs([]));
  }, [active]);
  const years = useMemo(() => [...new Set(docs.map((d) => d.period_year))], [docs]);
  const shown = docs.filter((d) => year === "todos" || d.period_year === year);
  const groups = Object.keys(TYPES).map((t) => ({ t, list: shown.filter((d) => d.doc_type === t) })).filter((g) => g.list.length);

  if (me?.tier !== "premier") return <Notice tone="info">Los documentos que Kawiil prepara están disponibles para clientes de Kawiil.</Notice>;
  return (
    <>
      <PageTitle title="Documentos SAT y declaraciones" subtitle="Constancia, opinión, declaraciones y otros documentos del servicio publicados por Kawiil."
        actions={<label className="text-sm">Año <select className="ml-1 rounded-md border px-2 py-1" value={String(year)} onChange={(e) => setYear(e.target.value === "todos" ? "todos" : Number(e.target.value))}><option value="todos">Todos</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>} />
      <div className="mb-3"><Notice tone="info">Constancia, opinión y declaraciones de tu cuenta, listas para consultar, con fecha de obtención. Solo lectura.</Notice></div>
      {groups.length === 0 ? <Empty>Aún no hay documentos publicados.</Empty> : groups.map((g) => (
        <section key={g.t} className="mb-5" aria-labelledby={`g-${g.t}`}>
          <h2 id={`g-${g.t}`} className="mb-2 text-lg">{TYPES[g.t]}</h2>
          <ul className="space-y-2">{g.list.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3">
              <div>
                <p className="font-medium">{d.title}</p>
                <p className="text-xs text-muted-foreground">
                  Periodo {d.period_month ? `${MONTHS[d.period_month - 1]} ` : ""}{d.period_year}
                  {" · "}publicado {fmtDate(d.published_at)}
                  {d.obtained_at && <> · obtenido {fmtDate(d.obtained_at)}</>}
                </p>
                {d.opinion_result && <p className="mt-1"><StatusPill tone={/positiva|sin.?oblig/i.test(d.opinion_result) ? "ok" : "warn"}>{d.opinion_result}</StatusPill></p>}
              </div>
              <Button size="sm" variant="outline" onClick={async () => { const { url } = await callApi<{ url: string }>("documentos.descargar", { document_id: d.id }); window.open(url, "_blank", "noopener"); }}>Descargar</Button>
            </li>))}
          </ul>
        </section>
      ))}
    </>
  );
}
