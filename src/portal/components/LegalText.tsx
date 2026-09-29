import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { callApi } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Notice } from "./ui";

export interface LegalDoc { id: string; kind: string; version: string; title: string; body_md: string; is_placeholder: boolean; published_at: string }

export function useLegal(kind: string) {
  const [doc, setDoc] = useState<LegalDoc | null>(null);
  useEffect(() => {
    callApi<LegalDoc>("legal.actual", { kind }).then(setDoc).catch(() => setDoc(null));
  }, [kind]);
  return doc;
}

export default function LegalText({ doc }: { doc: LegalDoc | null }) {
  if (!doc) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  return (
    <article className={doc.is_placeholder ? "kw-placeholder rounded-lg p-4" : ""}>
      {doc.is_placeholder && <Notice tone="warn" title="Texto provisional">Kawiil publicará el texto definitivo antes de abrir el portal.</Notice>}
      <h2 className="mt-3 text-xl">{doc.title}</h2>
      <p className="text-xs text-muted-foreground">Versión <span className="kw-mono">{doc.version}</span> · vigente desde {fmtDate(doc.published_at)}</p>
      <div className="prose prose-sm mt-3 max-w-none"><ReactMarkdown>{doc.body_md}</ReactMarkdown></div>
    </article>
  );
}
