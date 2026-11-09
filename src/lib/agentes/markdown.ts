// Parte un texto en Markdown en bloques de «texto» y «tabla». Las tablas (estilo GitHub: | a | b | con una fila |---|---|) las pinta un
// componente propio y seguro; el resto lo pinta el renderizador de Markdown del proyecto. Sin dependencias nuevas.
export type Alineacion = "left" | "center" | "right";
export type Bloque = { tipo: "texto"; texto: string } | { tipo: "tabla"; encabezados: string[]; alineacion: Alineacion[]; filas: string[][] };

const FILA = /^\s*\|.*\|\s*$/;
// Fila separadora de GitHub: celdas de guiones (con «:» opcional para alinear); un solo guion basta y puede haber una sola columna.
const SEPARADOR_CELDAS = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const SEPARADOR = { test: (l: string) => l.includes("|") && SEPARADOR_CELDAS.test(l) };

export function celdas(linea: string): string[] {
  let s = linea.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

const alinear = (c: string): Alineacion => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left");

export function partirMarkdown(texto: string): Bloque[] {
  const lineas = (texto ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: Bloque[] = [];
  let buffer: string[] = [];
  const volcar = () => { const t = buffer.join("\n"); if (t.trim()) out.push({ tipo: "texto", texto: t }); buffer = []; };
  for (let i = 0; i < lineas.length; i++) {
    if (FILA.test(lineas[i]) && i + 1 < lineas.length && SEPARADOR.test(lineas[i + 1])) {
      const encabezados = celdas(lineas[i]);
      const alineacion = celdas(lineas[i + 1]).map(alinear);
      const filas: string[][] = [];
      let j = i + 2;
      while (j < lineas.length && FILA.test(lineas[j])) {
        const f = celdas(lineas[j]);
        filas.push(encabezados.map((_, k) => f[k] ?? ""));      // siempre del ancho del encabezado
        j++;
      }
      volcar();
      out.push({ tipo: "tabla", encabezados, alineacion: encabezados.map((_, k) => alineacion[k] ?? "left"), filas });
      i = j - 1;
    } else {
      buffer.push(lineas[i]);
    }
  }
  volcar();
  return out;
}
