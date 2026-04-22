import { describe, expect, it } from "vitest";
import { resolveAgentTaskDisplayText } from "./agentTaskResult";

describe("resolveAgentTaskDisplayText", () => {
  it("elige markdown largo frente a message corto", () => {
    const result = {
      message: "Basándome en memorias, procedo con la revisión...",
      markdown: "# Informe\n\n" + "x".repeat(2000),
    };
    const text = resolveAgentTaskDisplayText(result, null);
    expect(text).toContain("x".repeat(200));
    expect(text.startsWith("# Informe")).toBe(true);
  });

  it("une secciones en array a un solo cuerpo largo", () => {
    const result = {
      sections: [{ content: "Parte A con texto." }, { text: "Parte B con más detalle y longitud." }],
    };
    const text = resolveAgentTaskDisplayText(result, null);
    expect(text).toContain("Parte A");
    expect(text).toContain("Parte B");
  });

  it("parsea result como string JSON y extrae el cuerpo", () => {
    const result = JSON.stringify({ body: "Cuerpo\n\n" + "y".repeat(500), note: "n" });
    const text = resolveAgentTaskDisplayText(result, null);
    expect(text.length).toBeGreaterThan(400);
    expect(text).toContain("y".repeat(100));
  });

  it("toma el texto largo de execution_metadata si result solo tiene intro", () => {
    const result = { message: "Intro corta." };
    const meta = { final_report: "INFORME\n\n" + "z".repeat(800) };
    const text = resolveAgentTaskDisplayText(result, null, meta);
    expect(text).toContain("z".repeat(100));
  });
});
