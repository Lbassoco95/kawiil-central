import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ComunicadoItem } from "@/components/hub/ComunicadoItem";
import type { Comunicado } from "@/lib/comunicados";

afterEach(cleanup);
const base: Comunicado = { id: "c1", title: "Lunes 16 no se trabaja", body: "Día de descanso.", is_pinned: false, created_at: "2026-11-12T12:00:00Z" };
const vista = (com: Partial<Comunicado>, o: { puede?: boolean; ocupado?: boolean } = {}) => {
  const onGestionar = vi.fn(), onEliminar = vi.fn();
  render(<ComunicadoItem com={{ ...base, ...com }} indice={0} puedeGestionar={o.puede ?? true} ocupado={o.ocupado ?? false} fecha="12 nov 2026, 06:00" onGestionar={onGestionar} onEliminar={onEliminar} />);
  return { onGestionar, onEliminar };
};

describe("comunicado en el Hub", () => {
  it("un comunicado de siempre (sin estado ni vigencia) se ve como antes: sin etiquetas y con el botón de eliminar", () => {
    const { onEliminar } = vista({});
    expect(screen.queryByTestId("comunicado-estado")).toBeNull();
    fireEvent.click(screen.getByLabelText("Eliminar comunicado")); expect(onEliminar).toHaveBeenCalledOnce();
    expect(screen.queryByText("Publicar")).toBeNull(); expect(screen.queryByText("Retirar")).toBeNull();
  });
  it("un borrador del agente dice que espera aprobación y ofrece Publicar y Descartar (no Eliminar)", () => {
    const { onGestionar } = vista({ estado: "borrador", origen: "agente", avisar_al_entrar: true, vigente_desde: "2026-11-13", vigente_hasta: "2026-11-16" });
    expect(screen.getByText("Borrador: espera tu aprobación")).toBeTruthy();
    expect(screen.getByText(/Aviso al abrir el sistema: del viernes 13 al lunes 16 de noviembre de 2026/)).toBeTruthy();
    expect(screen.queryByLabelText("Eliminar comunicado")).toBeNull();
    fireEvent.click(screen.getByText("Publicar")); fireEvent.click(screen.getByText("Descartar"));
    expect(onGestionar.mock.calls).toEqual([["publicar"], ["descartar"]]);
  });
  it("un aviso publicado se puede retirar; uno publicado sin aviso al entrar no muestra Retirar", () => {
    const { onGestionar } = vista({ estado: "publicado", origen: "agente", avisar_al_entrar: true, vigente_desde: "2026-11-16", vigente_hasta: "2026-11-16", aprobado_at: "2026-11-12T12:00:00Z" });
    expect(screen.getByText("Publicado (redactado con el agente)")).toBeTruthy(); expect(screen.getByText(/lunes 16 de noviembre de 2026/)).toBeTruthy();
    fireEvent.click(screen.getByText("Retirar")); expect(onGestionar).toHaveBeenCalledWith("archivar");
    cleanup(); vista({ estado: "publicado", origen: "persona" }); expect(screen.queryByText("Retirar")).toBeNull();
  });
  it("sin permiso de gestionar no hay botones; mientras trabaja, los botones se bloquean", () => {
    vista({ estado: "borrador", origen: "agente" }, { puede: false });
    expect(screen.queryByText("Publicar")).toBeNull(); expect(screen.getByText("Borrador: espera tu aprobación")).toBeTruthy();
    cleanup(); vista({ estado: "borrador", origen: "agente" }, { ocupado: true });
    expect((screen.getByText("Publicar") as HTMLButtonElement).disabled).toBe(true); expect((screen.getByText("Descartar") as HTMLButtonElement).disabled).toBe(true);
  });
  it("un comunicado retirado se marca como retirado", () => {
    vista({ estado: "archivado", origen: "agente" }); expect(screen.getByText("Retirado")).toBeTruthy();
  });
  it("el texto se pinta como texto: el HTML no se interpreta", () => {
    vista({ title: "<img src=x onerror=alert(1)>", body: "<script>alert(1)</script>" });
    expect(document.querySelector("img")).toBeNull(); expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });
});
