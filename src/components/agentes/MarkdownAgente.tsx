import { Fragment } from "react";
import ReactMarkdown from "react-markdown";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { partirMarkdown } from "@/lib/agentes/markdown";

// Respuesta de un agente pintada como documento: títulos, negritas, listas, líneas y TABLAS reales, en vez de los símbolos (##, **, |) crudos.
// Es seguro: react-markdown no interpreta HTML (se descarta) y sanea los enlaces; las celdas se pintan con el mismo renderizador, en línea.
// KawiilAiMarkdown no restituye las viñetas, los números ni el tamaño de los títulos que Tailwind borra: aquí sí, para que un informe se lea como documento.
const ESTILO_DOCUMENTO = "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:text-lg [&_h2]:text-base [&_h2]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_hr]:my-3 [&_hr]:border-border/60";
const enLinea = { p: ({ children }: { children?: React.ReactNode }) => <Fragment>{children}</Fragment> };

export function MarkdownAgente({ texto, className }: { texto: string; className?: string }) {
  const bloques = partirMarkdown(texto);
  if (bloques.length === 0) return null;
  return (
    <div className={className} data-testid="markdown-agente">
      {bloques.map((b, i) => b.tipo === "texto" ? <KawiilAiMarkdown key={i} className={ESTILO_DOCUMENTO}>{b.texto}</KawiilAiMarkdown> : (
        <div key={i} className="my-2 overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full border-collapse text-[13px]" data-testid="markdown-tabla">
            <thead className="bg-muted/50">
              <tr>{b.encabezados.map((h, k) => <th key={k} scope="col" style={{ textAlign: b.alineacion[k] }} className="border-b border-border/60 px-3 py-2 font-semibold"><ReactMarkdown components={enLinea}>{h}</ReactMarkdown></th>)}</tr>
            </thead>
            <tbody>
              {b.filas.map((f, r) => <tr key={r} className="border-b border-border/40 last:border-0 align-top">{f.map((c, k) => <td key={k} style={{ textAlign: b.alineacion[k] }} className="px-3 py-2"><ReactMarkdown components={enLinea}>{c}</ReactMarkdown></td>)}</tr>)}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
