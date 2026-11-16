import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { Comunicado } from "@/lib/comunicados";

const estado = vi.hoisted(() => ({ q: { data: [] as unknown, isError: false, isLoading: false } }));
vi.mock("@/hooks/useInternalDespacho", () => ({ useComunicadosAviso: () => estado.q }));
import { AvisoAlEntrar } from "@/components/shared/AvisoAlEntrar";

const c = (o: Partial<Comunicado> = {}): Comunicado => ({
  id: "c1", title: "Lunes 16 no se trabaja", body: "El lunes 16 de noviembre es día de descanso.\nNos vemos el martes.", is_pinned: false, created_at: "2026-11-12T12:00:00Z",
  estado: "publicado", vigente_desde: "2026-11-13", vigente_hasta: "2026-11-16", avisar_al_entrar: true, ...o,
});

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T15:00:00Z")); localStorage.clear(); estado.q = { data: [], isError: false, isLoading: false }; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("aviso al entrar", () => {
  it("muestra el aviso vigente de hoy con su título, la fecha en español y el mensaje respetando los saltos de línea", () => {
    estado.q = { ...estado.q, data: [c()] };
    render(<AvisoAlEntrar />);
    const aviso = screen.getByTestId("aviso-al-entrar");
    expect(within(aviso).getByText("Aviso para el equipo")).toBeTruthy();
    expect(within(aviso).getByText("Lunes 16 no se trabaja")).toBeTruthy();
    expect(within(aviso).getByText("del viernes 13 al lunes 16 de noviembre de 2026")).toBeTruthy();
    expect(aviso.querySelector("p.whitespace-pre-wrap")?.textContent).toBe("El lunes 16 de noviembre es día de descanso.\nNos vemos el martes.");
  });

  it("no muestra nada si no hay avisos, si hubo un error (por ejemplo, la base aún sin actualizar) o si no corresponden a hoy", () => {
    const { rerender } = render(<AvisoAlEntrar />); expect(screen.queryByTestId("aviso-al-entrar")).toBeNull();
    estado.q = { data: undefined, isError: true, isLoading: false }; rerender(<AvisoAlEntrar />); expect(screen.queryByTestId("aviso-al-entrar")).toBeNull();
    estado.q = { data: [c({ id: "b", estado: "borrador" }), c({ id: "v", vigente_hasta: "2026-11-15" }), c({ id: "f", vigente_desde: "2026-11-17", vigente_hasta: "2026-11-18" }), c({ id: "s", avisar_al_entrar: false })], isError: false, isLoading: false };
    rerender(<AvisoAlEntrar />); expect(screen.queryByTestId("aviso-al-entrar")).toBeNull();
  });

  it("«Entendido» lo cierra y no vuelve a salir hoy aunque se recargue la pantalla; al día siguiente vuelve a salir si la vigencia sigue", () => {
    estado.q = { ...estado.q, data: [c({ vigente_hasta: "2026-11-18" })] };
    const { unmount } = render(<AvisoAlEntrar />);
    fireEvent.click(screen.getByTestId("aviso-entendido"));
    expect(screen.queryByTestId("aviso-al-entrar")).toBeNull();
    unmount();
    render(<AvisoAlEntrar />); expect(screen.queryByTestId("aviso-al-entrar")).toBeNull();   // «recarga» el mismo día
    cleanup(); vi.setSystemTime(new Date("2026-11-17T15:00:00Z"));                            // al día siguiente
    render(<AvisoAlEntrar />); expect(screen.getByTestId("aviso-al-entrar")).toBeTruthy();
    cleanup(); vi.setSystemTime(new Date("2026-11-19T15:00:00Z"));                            // ya venció
    render(<AvisoAlEntrar />); expect(screen.queryByTestId("aviso-al-entrar")).toBeNull();
  });

  it("cerrarlo con Escape también cuenta como visto", () => {
    estado.q = { ...estado.q, data: [c()] };
    const { unmount } = render(<AvisoAlEntrar />);
    fireEvent.keyDown(screen.getByTestId("aviso-al-entrar"), { key: "Escape", code: "Escape" });
    expect(screen.queryByTestId("aviso-al-entrar")).toBeNull(); unmount();
    render(<AvisoAlEntrar />); expect(screen.queryByTestId("aviso-al-entrar")).toBeNull();
  });

  it("un aviso nuevo aparece aunque ya se haya visto otro; varios avisos salen juntos, el fijado primero", () => {
    estado.q = { ...estado.q, data: [c({ id: "uno", title: "Primero" })] };
    const { unmount } = render(<AvisoAlEntrar />); fireEvent.click(screen.getByTestId("aviso-entendido")); unmount();
    estado.q = { ...estado.q, data: [c({ id: "uno", title: "Primero" }), c({ id: "dos", title: "Segundo" }), c({ id: "tres", title: "Tercero", is_pinned: true })] };
    render(<AvisoAlEntrar />);
    expect(screen.getByText("Avisos para el equipo")).toBeTruthy();
    expect(screen.getAllByTestId("aviso-item").map((x) => x.querySelector("h3")?.textContent)).toEqual(["Tercero", "Segundo"]);
  });

  it("el texto de un comunicado se pinta como texto: el HTML no se interpreta", () => {
    estado.q = { ...estado.q, data: [c({ title: "<img src=x onerror=alert(1)>", body: "<script>alert(1)</script> <b>hola</b>" })] };
    render(<AvisoAlEntrar />);
    const aviso = screen.getByTestId("aviso-al-entrar");
    expect(aviso.querySelector("img")).toBeNull(); expect(aviso.querySelector("script")).toBeNull(); expect(aviso.querySelector("b")).toBeNull();
    expect(within(aviso).getByText("<img src=x onerror=alert(1)>")).toBeTruthy(); expect(within(aviso).getByText("<script>alert(1)</script> <b>hola</b>")).toBeTruthy();
  });

  it("si el navegador no deja guardar lo visto, el aviso sigue funcionando y se cierra sin errores", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("bloqueado"); });
    estado.q = { ...estado.q, data: [c()] };
    render(<AvisoAlEntrar />);
    expect(() => fireEvent.click(screen.getByTestId("aviso-entendido"))).not.toThrow();
    expect(screen.queryByTestId("aviso-al-entrar")).toBeNull();
  });
});
