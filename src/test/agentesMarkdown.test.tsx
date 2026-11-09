import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { celdas, partirMarkdown } from "@/lib/agentes/markdown";
import { MarkdownAgente } from "@/components/agentes/MarkdownAgente";

// El informe real que Tlahtolli devolvió y se veía con símbolos crudos (##, **, ---, |).
const INFORME = `## 📄 Informe — Organización de Actas de Asamblea

---

### 1. Contenido esencial de un acta de asamblea

Para que un acta sea válida debe contener, como mínimo:

1. **Denominación o razón social completa** de la sociedad.
2. **Tipo de asamblea** (ordinaria, extraordinaria).

### 2. Pendientes comunes

| **Acta** | **Qué revisar** | **Responsable** |
|---|---|---|
| Constitutiva | Protocolización ante notario e inscripción en el RPC. | Gestoría corporativa |
| Asamblea ordinaria anual | Aprobación de estados financieros. | Contabilidad + Secretario |

> **Nota:** Borrador generado por Tlahtolli (IA).`;

describe("partirMarkdown", () => {
  it("separa el texto de la tabla, con encabezados, alineación y filas del ancho del encabezado", () => {
    const b = partirMarkdown(INFORME);
    expect(b.map((x) => x.tipo)).toEqual(["texto", "tabla", "texto"]);
    const t = b[1];
    if (t.tipo !== "tabla") throw new Error("debía ser tabla");
    expect(t.encabezados).toEqual(["**Acta**", "**Qué revisar**", "**Responsable**"]);
    expect(t.filas.length).toBe(2); expect(t.filas[0]).toEqual(["Constitutiva", "Protocolización ante notario e inscripción en el RPC.", "Gestoría corporativa"]);
    const a = partirMarkdown("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 |");
    if (a[0].tipo !== "tabla") throw new Error("debía ser tabla");
    expect(a[0].alineacion).toEqual(["left", "center", "right"]); expect(a[0].filas[0]).toEqual(["1", "2", ""]);       // fila corta: se completa
  });
  it("una barra escapada es parte de la celda y sin fila separadora no es tabla", () => {
    expect(celdas("| a \\| b | c |")).toEqual(["a | b", "c"]);
    expect(partirMarkdown("| solo | una línea |").map((x) => x.tipo)).toEqual(["texto"]);
    expect(partirMarkdown("texto\n\n| a | b |\n| 1 | 2 |").map((x) => x.tipo)).toEqual(["texto"]);        // sin |---|: es texto
    expect(partirMarkdown("")).toEqual([]); expect(partirMarkdown("  \n ")).toEqual([]);
  });
  it("dos tablas y texto intercalado conservan el orden", () => {
    const b = partirMarkdown("A\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\nB\n\n| z |\n|---|\n| 3 |\n\nC");
    expect(b.map((x) => x.tipo)).toEqual(["texto", "tabla", "texto", "tabla", "texto"]);
  });
});

describe("<MarkdownAgente />", () => {
  it("pinta el informe como documento: títulos, listas numeradas, negritas, cita y una tabla real, sin símbolos crudos", () => {
    const { container } = render(<MarkdownAgente texto={INFORME} />);
    expect(screen.getByRole("heading", { name: /Informe — Organización de Actas de Asamblea/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "2. Pendientes comunes" })).toBeTruthy();
    expect(container.querySelectorAll("ol li").length).toBe(2);
    const tabla = screen.getByTestId("markdown-tabla");
    expect([...tabla.querySelectorAll("th")].map((h) => h.textContent)).toEqual(["Acta", "Qué revisar", "Responsable"]);   // sin los ** de las celdas
    expect(tabla.querySelectorAll("th strong").length).toBe(3);
    expect([...tabla.querySelectorAll("tbody tr")].map((r) => r.children[0].textContent)).toEqual(["Constitutiva", "Asamblea ordinaria anual"]);
    expect(container.querySelector("blockquote")).toBeTruthy();
    for (const crudo of ["##", "**", "|---|", "| Constitutiva"]) expect(container.textContent).not.toContain(crudo);
  });
  it("es seguro: el HTML no se interpreta y los enlaces javascript: se neutralizan, también dentro de las celdas", () => {
    const hostil = `<img src=x onerror="alert(1)"><script>alert(2)</script>\n\n[clic](javascript:alert(3)) y [ok](https://kawiil.mx)\n\n| a | b |\n|---|---|\n| <img src=y onerror="alert(4)"> | [x](javascript:alert(5)) |`;
    const { container } = render(<MarkdownAgente texto={hostil} />);
    expect(container.querySelector("img")).toBeNull(); expect(container.querySelector("script")).toBeNull();
    for (const a of container.querySelectorAll("a")) expect(a.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
    expect(container.querySelector("[onerror]")).toBeNull();                              // ningún elemento con manejadores de eventos
    expect(container.textContent).toContain("<img src=x");                                  // el HTML se muestra como texto, no se ejecuta
  });
  it("texto vacío no pinta nada", () => {
    const { container } = render(<MarkdownAgente texto="   " />);
    expect(container.innerHTML).toBe("");
  });
});
