/** C3: el widget se reinicia solo cuando el token vence (no repetir el defecto de MATI). */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { createRef } from "react";
import Turnstile, { type TurnstileHandle } from "@/portal/components/Turnstile";

type Opts = Record<string, (arg?: string) => void> & { sitekey: string; "refresh-expired": string };
let opts: Opts;
const api = {
  render: vi.fn((_el: HTMLElement, o: Opts) => { opts = o; return "w1"; }),
  reset: vi.fn(),
  remove: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  window.turnstile = api as unknown as Window["turnstile"];
});

describe("Turnstile", () => {
  it("se configura para renovarse solo y, al vencer, borra el token y se reinicia", async () => {
    const onToken = vi.fn();
    render(<Turnstile siteKey="1x00000000000000000000AA" onToken={onToken} />);
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    expect(opts.sitekey).toBe("1x00000000000000000000AA");
    expect(opts["refresh-expired"]).toBe("auto");
    act(() => opts.callback("token-1"));
    expect(onToken).toHaveBeenLastCalledWith("token-1");
    act(() => opts["expired-callback"]());
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(api.reset).toHaveBeenCalledWith("w1");
    act(() => opts.callback("token-2")); // quien dejó la pantalla abierta sigue pudiendo enviar
    expect(onToken).toHaveBeenLastCalledWith("token-2");
  });
  it("reset() tras enviar descarta el token usado", async () => {
    const onToken = vi.fn();
    const ref = createRef<TurnstileHandle>();
    render(<Turnstile ref={ref} siteKey="1x00000000000000000000AA" onToken={onToken} />);
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    act(() => ref.current!.reset());
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(api.reset).toHaveBeenCalledWith("w1");
  });
  it("sin llave de sitio el formulario queda cerrado (falla cerrado)", () => {
    render(<Turnstile siteKey="" onToken={vi.fn()} />);
    expect(screen.getByText(/no están disponibles/)).toBeTruthy();
    expect(api.render).not.toHaveBeenCalled();
  });
});
