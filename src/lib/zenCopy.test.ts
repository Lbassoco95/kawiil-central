import { describe, expect, it, vi } from "vitest";
import { installZenCopy, softenCopy } from "./zenCopy";

describe("softenCopy", () => {
  it("suaviza errores 'Error al ...' conservando el detalle", () => {
    expect(softenCopy("error", "Error al navegar Dropbox: timeout")).toEqual({
      message: "No pudimos navegar Dropbox",
      description: "timeout · Inténtalo de nuevo en un momento.",
    });
  });

  it("suaviza 'No se pudo ...' con y sin detalle", () => {
    expect(softenCopy("error", "No se pudo copiar")).toEqual({
      message: "No pudimos copiar",
      description: "Inténtalo de nuevo en un momento.",
    });
    expect(softenCopy("error", "No se pudo guardar: RLS violation").message).toBe("No pudimos guardar");
  });

  it("suaviza 'Error: detalle' genérico", () => {
    const r = softenCopy("error", "Error: boom");
    expect(r.message).toBe("Algo no salió como esperábamos");
    expect(r.description).toContain("boom");
  });

  it("agrega cortesía a las validaciones", () => {
    expect(softenCopy("error", "Escribe el acuerdo").message).toBe("Cuando puedas, escribe el acuerdo");
  });

  it("usa frases cálidas para éxitos conocidos y no toca el resto", () => {
    expect(softenCopy("success", "Guardado").message).toBe("Guardado con calma");
    expect(softenCopy("success", "Carpeta creada").message).toBe("Carpeta creada");
    expect(softenCopy("info", "Algo informativo").message).toBe("Algo informativo");
  });

  it("respeta la descripción que ya trae la llamada", () => {
    expect(softenCopy("error", "No se pudo guardar", "Detalle propio").description).toBe("Detalle propio");
  });
});

describe("installZenCopy", () => {
  it("envuelve una sola vez y deja pasar contenido no textual", () => {
    const error = vi.fn();
    const toast = { success: vi.fn(), error, warning: vi.fn(), info: vi.fn() };
    installZenCopy(toast);
    installZenCopy(toast);
    toast.error("No se pudo copiar");
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("No pudimos copiar", { description: "Inténtalo de nuevo en un momento." });
    const node = { jsx: true };
    toast.error(node);
    expect(error).toHaveBeenLastCalledWith(node, undefined);
  });
});
