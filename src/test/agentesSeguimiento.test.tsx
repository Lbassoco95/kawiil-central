import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  detalleTarea, entregablesDe, estadosDelGrupo, esUuid, limpiarEvento, publicos, resumirTarea, rutaValida, truncar,
} from "../../supabase/functions/_shared/seguimiento";
import { SeguimientoAgentes, tamano } from "@/components/agentes/SeguimientoAgentes";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const T = "0b47849a-312c-4ad0-81ce-d173d61f9348";
const REG = { nombre: "informe-actas.docx", formato: "docx", ruta: `${T}/01-informe-actas.docx`, bytes: 20480, titulo: "Informe de actas", creado: "2026-11-09T05:00:00Z" };

describe("reglas de seguimiento", () => {
  it("la ruta solo vale si cuelga de la carpeta de ESA tarea", () => {
    expect(rutaValida(T, `${T}/01-a.pdf`)).toBe(true);
    for (const mala of [`otra/${T}/01-a.pdf`, `${T}/../x.pdf`, `/${T}/a.pdf`, `${T}//a.pdf`, `${T}\\a.pdf`, `11111111-1111-1111-1111-111111111111/a.pdf`, "", 5, null, `${T}/${"a".repeat(400)}`])
      expect(rutaValida(T, mala as unknown)).toBe(false);
    expect(rutaValida("no-es-uuid", "no-es-uuid/a.pdf")).toBe(false);
  });
  it("entregablesDe descarta lo malformado, los formatos raros y las rutas ajenas", () => {
    const r = { entregables: [REG, { ...REG, formato: "exe" }, { ...REG, ruta: "../../secreto" }, "texto", null, { ...REG, bytes: -3, nombre: "" }] };
    const lista = entregablesDe(T, r);
    expect(lista.map((e) => e.formato)).toEqual(["docx", "docx"]);
    expect(lista[1].bytes).toBe(0) ; expect(lista[1].nombre).toBe("documento");
    expect(entregablesDe(T, null)).toEqual([]); expect(entregablesDe(T, { entregables: "x" })).toEqual([]);
  });
  it("la versión pública nunca lleva la ruta interna", () => {
    expect(JSON.stringify(publicos(entregablesDe(T, { entregables: [REG] })))).not.toContain(T);
    const d = detalleTarea({ id: T, agent_id: "a", title: "Informe", status: "completed", result: { analysis: "Listo", entregables: [REG] }, instructions: "Haz el informe" }, "Amatl");
    expect(JSON.stringify(d)).not.toContain("/01-informe");           // ni ruta ni carpeta
    expect(d.entregables_lista[0]).toEqual({ nombre: "informe-actas.docx", formato: "docx", bytes: 20480, titulo: "Informe de actas", creado: "2026-11-09T05:00:00Z" });
    expect(d.respuesta).toBe("Listo"); expect(d.instrucciones).toBe("Haz el informe");
  });
  it("resumen: marca error y cuenta documentos; recorta textos largos", () => {
    const r = resumirTarea({ id: T, agent_id: "a", title: "x".repeat(500), status: "failed", result_summary: "y".repeat(900), result: { entregables: [REG, REG] } }, "Amatl");
    expect(r.con_error).toBe(true); expect(r.entregables).toBe(2); expect(r.titulo.length).toBe(200); expect(r.resumen.length).toBe(300);
  });
  it("grupos de estado y validación de ids", () => {
    expect(estadosDelGrupo("en_curso")).toContain("in_progress"); expect(estadosDelGrupo("con_error")).toEqual(["error", "failed"]);
    for (const x of ["todas", 5, "__proto__", "constructor", "toString", null]) expect(estadosDelGrupo(x)).toBeNull();
    expect(esUuid(T)).toBe(true); expect(esUuid("x")).toBe(false);
  });
  it("evento limpio: solo el mensaje del payload, recortado", () => {
    expect(limpiarEvento({ event_type: "thinking", sequence: 3, progress: 40, created_at: "t", payload: { message: "m".repeat(400), secreto: "no" } }))
      .toEqual({ tipo: "thinking", secuencia: 3, progreso: 40, cuando: "t", mensaje: truncar("m".repeat(400), 240) });
    expect(limpiarEvento({ event_type: "x", payload: null }).mensaje).toBe("");
  });
  it("tamaños legibles", () => { expect(tamano(900)).toBe("900 B"); expect(tamano(20480)).toBe("20 KB"); expect(tamano(3 * 1024 * 1024)).toBe("3.0 MB"); });
});

const AHORA = new Date("2026-11-09T05:10:00Z");
const TAREAS = [
  { id: T, agent_id: "a1", agente: "Amatl", titulo: "Revisión de actas", estado: "completed", tipo: "manual", prioridad: "normal", creada: "2026-11-09T05:00:00Z", inicio: null, fin: "2026-11-09T05:02:00Z", resumen: "ok", con_error: false, entregables: 1 },
  { id: "5f1c1c1c-1111-4111-8111-111111111111", agent_id: "a2", agente: "Atl", titulo: "Consulta SAT", estado: "error", tipo: "manual", prioridad: "normal", creada: "2026-11-09T04:00:00Z", inicio: null, fin: null, resumen: "", con_error: true, entregables: 0 },
];
const DETALLE = { tarea: { ...TAREAS[0], instrucciones: "Revisa las actas <img src=x onerror=alert(1)>", respuesta: "Resumen **listo**", error: "", entregables_lista: [{ nombre: "informe-actas.docx", formato: "docx", bytes: 20480, titulo: "Informe", creado: "t" }] },
  eventos: [{ tipo: "started", secuencia: 1, progreso: null, cuando: "2026-11-09T05:00:05Z", mensaje: "" }, { tipo: "attachment_processed", secuencia: 2, progreso: null, cuando: "t", mensaje: "" }, { tipo: "completed", secuencia: 3, progreso: 100, cuando: "2026-11-09T05:02:00Z", mensaje: "" }],
  actividad: [{ accion: "web_fetch", mensaje: "web_fetch: https://www.diariooficial.gob.mx/", nivel: "info", cuando: "2026-11-09T05:01:00Z" }] };

function envolver(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

describe("<SeguimientoAgentes />", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (_n: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === "listar") return { data: { tareas: body.grupo === "con_error" ? [TAREAS[1]] : TAREAS }, error: null };
      if (body.action === "detalle") return { data: DETALLE, error: null };
      if (body.action === "hilo") return { data: { hilo: { id: T, titulo: "Revisión de actas", agent_id: "a1", agente: "Amatl" }, en_curso: false, revisiones: [],
        mensajes: [
          { task_id: T, rol: "persona", texto: DETALLE.tarea.instrucciones, cuando: "2026-11-09T05:00:00Z", estado: "completed", entregables: [] },
          { task_id: T, rol: "agente", texto: "## Informe\n\nResumen **listo**\n\n| Acta | Estado |\n|---|---|\n| 3 | Sin firma |", cuando: "2026-11-09T05:02:00Z", estado: "completed", entregables: DETALLE.tarea.entregables_lista },
        ] }, error: null };
      if (body.action === "descargar") return { data: { url: "https://x.supabase.co/signed/abc", nombre: "informe-actas.docx", expira_en: 300 }, error: null };
      return { data: null, error: new Error("acción rara") };
    });
  });

  it("lista las tareas con su estado en texto y filtra por grupo", async () => {
    envolver(<SeguimientoAgentes ahora={AHORA} />);
    expect(await screen.findByText("Revisión de actas")).toBeTruthy();
    expect(screen.getAllByTestId("seguimiento-estado").map((e) => e.textContent)).toEqual(["Terminó", "Falló"]);
    expect(screen.getByText(/1 documento/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("seguimiento-filtro-con_error"));
    expect(await screen.findByText("Consulta SAT")).toBeTruthy();
    expect(screen.queryByText("Revisión de actas")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("agente-seguimiento", { body: { action: "listar", grupo: "con_error" } });
  });

  it("al elegir una solicitud abre su conversación: lo pedido, la respuesta con formato, el avance y los documentos", async () => {
    envolver(<SeguimientoAgentes ahora={AHORA} />);
    fireEvent.click(await screen.findByTestId(`seguimiento-tarea-${T}`));
    const hilo = await screen.findByTestId("hilo");
    expect(screen.getByTestId("hilo-texto")).toBeTruthy();                                  // se le puede seguir escribiendo al agente
    expect(screen.getByTestId("hilo-programar-resumen")).toBeTruthy();                      // y programar revisiones
    expect(screen.getByTestId("hilo-msg-persona").textContent).toContain("<img src=x onerror=alert(1)>");   // lo pedido, como texto
    expect(hilo.querySelector("img")).toBeNull();                                           // nunca como HTML
    expect(screen.getByRole("heading", { name: "Informe" })).toBeTruthy();                  // «## Informe» es un título, no símbolos
    expect(screen.getByText("listo").tagName).toBe("STRONG");                               // «**listo**» es negrita
    expect(hilo.textContent).not.toContain("##"); expect(hilo.textContent).not.toContain("**");
    expect(screen.getByTestId("markdown-tabla").querySelectorAll("tbody tr").length).toBe(1);   // la tabla es una tabla
    expect(screen.getByTestId("hilo-entregables").textContent).toContain("informe-actas.docx");
    const avance = await screen.findByTestId("seguimiento-avance");
    expect(avance.textContent).toContain("Empezó la tarea"); expect(avance.textContent).toContain("Terminó");
    expect(avance.textContent).not.toContain("Adjunto revisado");                           // el ruido por adjunto no se lista
    expect(avance.textContent).toContain("web_fetch: https://www.diariooficial.gob.mx/");
  });

  it("descargar pide un enlace firmado por tarea e índice y lo abre en otra pestaña", async () => {
    const abrir = vi.spyOn(window, "open").mockImplementation(() => null);
    envolver(<SeguimientoAgentes ahora={AHORA} />);
    fireEvent.click(await screen.findByTestId(`seguimiento-tarea-${T}`));
    fireEvent.click(await screen.findByTestId(`hilo-descargar-${T}-0`));
    await waitFor(() => expect(abrir).toHaveBeenCalledWith("https://x.supabase.co/signed/abc", "_blank", "noopener,noreferrer"));
    expect(invoke).toHaveBeenCalledWith("agente-seguimiento", { body: { action: "descargar", task_id: T, indice: 0 } });
    abrir.mockRestore();
  });

  it("sin tareas lo dice; si falla la lectura muestra el mensaje de la función", async () => {
    invoke.mockResolvedValueOnce({ data: { tareas: [] }, error: null });
    const { unmount } = envolver(<SeguimientoAgentes ahora={AHORA} />);
    expect(await screen.findByTestId("seguimiento-vacio")).toBeTruthy();
    unmount();
    invoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ error: "Solo Dirección puede ver el seguimiento de los agentes." }) } } });
    envolver(<SeguimientoAgentes ahora={AHORA} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Solo Dirección");
  });
});
