import { Fragment, type ReactNode } from "react";

// Muestra la respuesta del Analista (Markdown sencillo) sin símbolos sueltos. Todo se construye como elementos de React:
// nunca se inyecta HTML, así que un texto con etiquetas se ve como texto.
const RE_INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|(?<![\w*])\*[^*\s][^*\n]*?\*(?![\w*]))/g;

export function enLinea(texto: string): ReactNode[] {
  const partes = texto.split(RE_INLINE).filter((p) => p !== "");
  return partes.map((p, i) => {
    if ((p.startsWith("**") && p.endsWith("**") && p.length > 4) || (p.startsWith("__") && p.endsWith("__") && p.length > 4))
      return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) return <code key={i} className="rounded bg-muted px-1 text-[0.85em]">{p.slice(1, -1)}</code>;
    if (p.length > 2 && p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

type Bloque =
  | { tipo: "p"; texto: string }
  | { tipo: "h"; texto: string }
  | { tipo: "li"; texto: string; nivel: number }
  | { tipo: "hr" };

export function bloques(texto: string): Bloque[] {
  const salida: Bloque[] = [];
  for (const cruda of texto.replace(/\r/g, "").split("\n")) {
    const linea = cruda.replace(/\s+$/, "");
    if (!linea.trim()) continue;
    if (/^\s*([-*_])\1{2,}\s*$/.test(linea)) { salida.push({ tipo: "hr" }); continue; }
    const h = /^\s*#{1,6}\s+(.*)$/.exec(linea);
    if (h) { salida.push({ tipo: "h", texto: h[1] }); continue; }
    const li = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/.exec(linea);
    if (li) { salida.push({ tipo: "li", texto: li[2], nivel: Math.min(2, Math.floor(li[1].replace(/\t/g, "  ").length / 2)) }); continue; }
    salida.push({ tipo: "p", texto: linea.trim() });
  }
  return salida;
}

export function TextoAnalista({ texto, className = "" }: { texto: string; className?: string }) {
  const bs = bloques(texto);
  const out: ReactNode[] = [];
  for (let i = 0; i < bs.length; ) {
    const b = bs[i], k = i;
    if (b.tipo === "li") {
      const items: Extract<Bloque, { tipo: "li" }>[] = [];
      while (i < bs.length && bs[i].tipo === "li") items.push(bs[i++] as Extract<Bloque, { tipo: "li" }>);
      out.push(
        <ul key={k} className="my-1 space-y-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2" style={{ paddingLeft: it.nivel * 14 }}>
              <span aria-hidden className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-[#9b7b4f]" />
              <span>{enLinea(it.texto)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }
    if (b.tipo === "h") out.push(<p key={k} className="mt-2 font-semibold">{enLinea(b.texto)}</p>);
    else if (b.tipo === "hr") out.push(<hr key={k} className="my-2 border-border" />);
    else out.push(<p key={k} className="my-1">{enLinea(b.texto)}</p>);
    i++;
  }
  return <div className={className}>{out}</div>;
}
