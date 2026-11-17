import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAgentesEnVivo, ESPERA_RAFAGA_MS, SONDEO_CON_TIEMPO_REAL_MS, SONDEO_SIN_TIEMPO_REAL_MS } from "@/hooks/useAgentesEnVivo";
import { IndicadorEnVivo } from "@/components/agentes/IndicadorEnVivo";
import { haceTexto } from "@/lib/agentes/enVivoTexto";

// Canal falso de Supabase Realtime: guarda los manejadores para poder «emitir» cambios de agent_tasks / agent_registry desde la prueba.
const m = vi.hoisted(() => ({ manejadores: [] as Array<{ tabla: string; cb: () => void }>, alSuscribir: null as null | ((s: string) => void), quitados: 0, suscribe: true }));
vi.mock("@/integrations/supabase/client", () => {
  const canal = {
    on(_t: string, f: { table: string }, cb: () => void) { m.manejadores.push({ tabla: f.table, cb }); return canal; },
    subscribe(fn: (s: string) => void) { m.alSuscribir = fn; if (m.suscribe) fn("SUBSCRIBED"); return canal; },
  };
  return { supabase: { channel: () => canal, getChannels: () => [], removeChannel: () => { m.quitados++; return Promise.resolve("ok"); } } };
});

function Probe({ activo = true }: { activo?: boolean }) { const e = useAgentesEnVivo(activo); return <p data-testid="estado">{e}</p>; }
const montar = (ui: React.ReactElement = <Probe />) => {
  const qc = new QueryClient(); const inv = vi.spyOn(qc, "invalidateQueries");
  return { inv, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
};

describe("useAgentesEnVivo", () => {
  beforeEach(() => { vi.useFakeTimers(); m.manejadores = []; m.alSuscribir = null; m.quitados = 0; m.suscribe = true; });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("escucha agent_tasks y agent_registry y pasa a «En vivo» al conectarse", () => {
    montar();
    expect(m.manejadores.map((x) => x.tabla).sort()).toEqual(["agent_registry", "agent_tasks"]);
    expect(screen.getByTestId("estado").textContent).toBe("en_vivo");
  });
  it("un cambio de tarea refresca las consultas de agentes; varios seguidos se juntan en un solo refresco", () => {
    const { inv } = montar();
    act(() => { vi.advanceTimersByTime(ESPERA_RAFAGA_MS + 10); }); inv.mockClear();   // el refresco inicial al conectarse
    act(() => { m.manejadores[0].cb(); m.manejadores[0].cb(); m.manejadores[1].cb(); });
    expect(inv).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(ESPERA_RAFAGA_MS + 10); });
    expect(inv).toHaveBeenCalledTimes(1);
    expect(inv).toHaveBeenCalledWith({ queryKey: ["agentes-registro"] });
  });
  it("con tiempo real, el respaldo refresca cada ~30 s; sin tiempo real, cada ~8 s", () => {
    const a = montar(); act(() => { vi.advanceTimersByTime(ESPERA_RAFAGA_MS + 10); }); a.inv.mockClear();
    act(() => { vi.advanceTimersByTime(SONDEO_CON_TIEMPO_REAL_MS - 5_000); }); expect(a.inv).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(8_000); }); expect(a.inv).toHaveBeenCalled();
    a.unmount();
    m.manejadores = []; m.suscribe = false;
    const b = montar(); b.inv.mockClear();
    act(() => { vi.advanceTimersByTime(SONDEO_SIN_TIEMPO_REAL_MS + 4_100); });
    expect(b.inv).toHaveBeenCalled();
  });
  it("si el canal falla pasa a «sondeo» y lo dice", () => {
    montar();
    act(() => { m.alSuscribir?.("CHANNEL_ERROR"); });
    expect(screen.getByTestId("estado").textContent).toBe("sondeo");
  });
  it("con la pestaña oculta no refresca por reloj; al volver sí", () => {
    const { inv } = montar(); act(() => { vi.advanceTimersByTime(ESPERA_RAFAGA_MS + 10); }); inv.mockClear();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => { vi.advanceTimersByTime(SONDEO_CON_TIEMPO_REAL_MS + 8_000); });
    expect(inv).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(inv).toHaveBeenCalledTimes(1);
  });
  it("al desmontar cierra el canal y deja de refrescar; inactivo no abre nada", () => {
    const { inv, unmount } = montar(); act(() => { vi.advanceTimersByTime(ESPERA_RAFAGA_MS + 10); }); inv.mockClear();
    unmount(); expect(m.quitados).toBeGreaterThan(0);
    act(() => { vi.advanceTimersByTime(SONDEO_CON_TIEMPO_REAL_MS * 2); }); expect(inv).not.toHaveBeenCalled();
    m.manejadores = []; montar(<Probe activo={false} />); expect(m.manejadores).toHaveLength(0);
  });
});

describe("<IndicadorEnVivo />", () => {
  afterEach(cleanup);
  it("dice el estado con texto y cuándo fue la última lectura", () => {
    const { rerender } = render(<IndicadorEnVivo estado="en_vivo" actualizadoEn={Date.now() - 30_000} />);
    expect(screen.getByTestId("en-vivo").textContent).toMatch(/En vivo.*actualizado hace 30 s/);
    rerender(<IndicadorEnVivo estado="sondeo" actualizadoEn={Date.now()} />);
    expect(screen.getByTestId("en-vivo").getAttribute("data-estado")).toBe("sondeo"); expect(screen.getByTestId("en-vivo").textContent).toMatch(/Actualizando cada pocos segundos/);
    rerender(<IndicadorEnVivo estado="conectando" actualizadoEn={0} />);
    expect(screen.getByTestId("en-vivo").textContent).toMatch(/Conectando/); expect(screen.queryByTestId("en-vivo-hace")).toBeNull();
  });
  it("haceTexto: ahora, segundos y minutos", () => { expect(haceTexto(1000)).toBe("ahora"); expect(haceTexto(42_000)).toBe("hace 42 s"); expect(haceTexto(180_000)).toBe("hace 3 min"); });
});
