import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  INSTRUCCION_REVISION, MAX_VECES, contextoRevision, mensajesDelHilo, raizDelHilo, resumirTarea, revisionesPendientes, validarRevision,
} from "../../supabase/functions/_shared/seguimiento";
import { ATAJOS, HiloAgente, aLocal } from "@/components/agentes/HiloAgente";
import { TrabajosAgente } from "@/components/agentes/TrabajosAgente";
import { Oficina } from "@/components/agentes/Oficina";
import { figurasOficina } from "@/lib/agentes/oficina";
import type { AgenteRegistro } from "@/lib/agentes/registro";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const T = "0b47849a-312c-4ad0-81ce-d173d61f9348";
const T2 = "5f1c1c1c-1111-4111-8111-111111111111";
const R1 = "9a9a9a9a-2222-4222-8222-222222222222";
const REG = { nombre: "informe-actas.docx", formato: "docx", ruta: `${T}/01-informe-actas.docx`, bytes: 20480, titulo: "Informe", creado: "2026-11-09T05:00:00Z" };
const AHORA_MS = Date.parse("2026-11-09T12:00:00Z");

describe("reglas del hilo", () => {
  it("la raíz es el hilo_id (uuid) o la propia tarea", () => {
    expect(raizDelHilo({ id: T2, input_context: { hilo_id: T.toUpperCase() } })).toBe(T);
    for (const malo of ["x", "../../etc", 5, null, "id'; drop"]) expect(raizDelHilo({ id: T2, input_context: { hilo_id: malo } })).toBe(T2);
    expect(raizDelHilo({ id: T, input_context: null })).toBe(T);
  });
  it("mensajes en orden; revisiones futuras no son mensajes; en curso sin texto; fallas dichas con claridad", () => {
    const m = mensajesDelHilo([
      { id: T2, task_type: "manual", status: "completed", created_at: "2026-11-02T10:00:00Z", completed_at: "2026-11-02T10:01:00Z", instructions: "Agrega fechas", result: { analysis: "Listo" } },
      { id: T, task_type: "manual", status: "completed", created_at: "2026-11-01T10:00:00Z", completed_at: "2026-11-01T10:02:00Z", instructions: "Haz el informe", result: { analysis: "Aquí está", entregables: [REG] } },
      { id: R1, task_type: "revision_programada", status: "pending", created_at: "2026-11-03T10:00:00Z", instructions: "Revisa", input_context: { ejecutar_en: "2027-01-04T15:00:00Z" } },
      { id: "r2", task_type: "revision_programada", status: "completed", created_at: "2026-11-04T10:00:00Z", instructions: "Revisa el avance", result: { analysis: "Sin cambios" } },
      { id: "e1", task_type: "manual", status: "error", created_at: "2026-11-05T10:00:00Z", instructions: "Consulta el SAT", error_message: "401 sin acceso" },
      { id: "p1", task_type: "manual", status: "in_progress", created_at: "2026-11-06T10:00:00Z", instructions: "Sigue" },
    ]);
    expect(m.map((x) => `${x.rol}:${x.estado}`)).toEqual(["persona:completed", "agente:completed", "persona:completed", "agente:completed", "revision:completed", "agente:completed",
      "persona:error", "agente:error", "persona:in_progress", "agente:in_progress"]);
    expect(m[0].texto).toBe("Haz el informe");                                       // cronológico, no por orden de llegada
    expect(m[1].entregables).toEqual([{ nombre: "informe-actas.docx", formato: "docx", bytes: 20480, titulo: "Informe", creado: "2026-11-09T05:00:00Z" }]);
    expect(JSON.stringify(m)).not.toContain(T + "/");                                // nunca la ruta del archivo
    expect(m.find((x) => x.rol === "agente" && x.estado === "error")?.texto).toContain("401 sin acceso");
    expect(m[9].texto).toBe("");                                                      // en curso: la pantalla dice «Trabajando…»
  });
  it("revisiones pendientes ordenadas; ignora las ejecutadas y las mal formadas", () => {
    const r = revisionesPendientes([
      { id: "b", task_type: "revision_programada", status: "pending", instructions: "x", input_context: { ejecutar_en: "2027-02-01T10:00:00Z", repetir: "semanal", veces_restantes: 3 } },
      { id: "a", task_type: "revision_programada", status: "pending", instructions: "y", input_context: { ejecutar_en: "2027-01-01T10:00:00Z" } },
      { id: "c", task_type: "revision_programada", status: "completed", input_context: { ejecutar_en: "2026-01-01T10:00:00Z" } },
      { id: "d", task_type: "revision_programada", status: "pending", input_context: {} }, { id: "e", task_type: "manual", status: "pending" },
    ]);
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r[1]).toMatchObject({ repetir: "semanal", veces_restantes: 3 });
  });
  it("el resumen trae el hilo si es un seguimiento", () => {
    expect(resumirTarea({ id: T2, status: "completed", hilo: T }, "A").hilo).toBe(T);
    expect(resumirTarea({ id: T, status: "completed", hilo: null }, "A").hilo).toBeNull();
    expect(resumirTarea({ id: T, status: "completed", hilo: "basura" }, "A").hilo).toBeNull();
  });
});

describe("validarRevision", () => {
  const OK = { cuando: new Date(AHORA_MS + 86_400_000).toISOString() };
  it("acepta una fecha futura; la deja en UTC; instrucción por defecto; sin repetición no hay veces", () => {
    const r = validarRevision(OK, AHORA_MS);
    expect(r.ok && r.revision).toEqual({ cuando: "2026-11-10T12:00:00Z", instruccion: INSTRUCCION_REVISION, repetir: null, veces: null });
    const s = validarRevision({ ...OK, repetir: "semanal", instruccion: "  Revisa vencimientos  " }, AHORA_MS);
    expect(s.ok && s.revision).toMatchObject({ repetir: "semanal", veces: 12, instruccion: "Revisa vencimientos" });
    const v = validarRevision({ ...OK, repetir: "mensual", veces: 6 }, AHORA_MS);
    expect(v.ok && v.revision.veces).toBe(6);
  });
  it.each([
    [{}, /fecha y hora/], [{ cuando: "mañana" }, /fecha y hora/], [{ cuando: new Date(AHORA_MS + 60_000).toISOString() }, /5 minutos/], [{ cuando: new Date(AHORA_MS - 1e9).toISOString() }, /5 minutos/],
    [{ cuando: new Date(AHORA_MS + 500 * 86_400_000).toISOString() }, /más de un año/], [{ ...OK, repetir: "cada_minuto" }, /diaria, semanal o mensual/],
    [{ ...OK, repetir: "diaria", veces: 0 }, /entero de 1 a/], [{ ...OK, repetir: "diaria", veces: MAX_VECES + 1 }, /entero de 1 a/], [{ ...OK, repetir: "diaria", veces: 2.5 }, /entero de 1 a/],
    [{ ...OK, instruccion: "x".repeat(2001) }, /demasiado larga/], [{ ...OK, instruccion: "mi contraseña es sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" }, /contraseña o llave/],
  ])("rechaza %j", (entrada, patron) => {
    const r = validarRevision(entrada, AHORA_MS);
    if (!("errores" in r)) throw new Error("debía rechazarse");
    expect(r.errores.join(" ")).toMatch(patron);
  });
  it("el contexto lleva el hilo, la hora y la serie, y NUNCA accesos de 1Password", () => {
    const r = validarRevision({ ...OK, repetir: "semanal", veces: 4 }, AHORA_MS);
    const c = contextoRevision(T, (r as { ok: true; revision: never }).revision, "u1");
    expect(c).toEqual({ hilo_id: T, ejecutar_en: "2026-11-10T12:00:00Z", repetir: "semanal", veces_restantes: 4, fallas: 0, programada_por: "u1" });
    expect("accesos_aprobados" in c).toBe(false);
    expect("veces_restantes" in contextoRevision(T, { cuando: "2026-11-10T12:00:00Z", instruccion: "x", repetir: null, veces: null }, "u1")).toBe(false);
  });
});

const HILO = {
  hilo: { id: T, titulo: "Informe de actas", agent_id: "a1", agente: "Tlahtolli" },
  mensajes: [
    { task_id: T, rol: "persona", texto: "Haz el informe <img src=x onerror=alert(1)>", cuando: "2026-11-09T05:48:00Z", estado: "completed", entregables: [] },
    { task_id: T, rol: "agente", texto: "Listo, aquí está el informe.", cuando: "2026-11-09T05:49:00Z", estado: "completed", entregables: [{ nombre: "informe-actas.docx", formato: "docx", bytes: 20480, titulo: "Informe", creado: "t" }] },
  ],
  revisiones: [{ id: R1, cuando: "2027-01-04T15:00:00Z", repetir: "semanal", veces_restantes: 3, instruccion: "x" }],
  en_curso: false,
};
const envolver = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>);
const AHORA = new Date("2026-11-09T12:00:00Z");

function simular(extra: Record<string, unknown> = {}) {
  invoke.mockImplementation(async (nombre: string, { body }: { body: Record<string, unknown> }) => {
    if (nombre === "agente-seguimiento") {
      if (body.action === "hilo") return { data: { ...HILO, ...extra }, error: null };
      if (body.action === "descargar") return { data: { url: "https://x.supabase.co/signed/abc", nombre: "informe-actas.docx", expira_en: 300 }, error: null };
      if (body.action === "programar_revision") return { data: { revision: { id: "n1", cuando: body.cuando, repetir: body.repetir ?? null, veces: body.veces ?? null } }, error: null };
      if (body.action === "cancelar_revision") return { data: { ok: true }, error: null };
      if (body.action === "listar") return { data: { tareas: [
        { id: T, agent_id: "a1", agente: "Tlahtolli", titulo: "Informe de actas", estado: "completed", tipo: "manual", prioridad: "normal", creada: "2026-11-09T05:48:00Z", inicio: null, fin: null, resumen: "", con_error: false, entregables: 1, hilo: null },
        { id: T2, agent_id: "a1", agente: "Tlahtolli", titulo: "Seguimiento: agrega fechas", estado: "completed", tipo: "manual", prioridad: "normal", creada: "2026-11-09T06:00:00Z", inicio: null, fin: null, resumen: "", con_error: false, entregables: 0, hilo: T },
        { id: R1, agent_id: "a1", agente: "Tlahtolli", titulo: "Revisión programada · Informe de actas", estado: "pending", tipo: "revision_programada", prioridad: "normal", creada: "2026-11-09T06:10:00Z", inicio: null, fin: null, resumen: "", con_error: false, entregables: 0, hilo: T },
      ] }, error: null };
    }
    if (nombre === "dispatch-to-agent") return { data: { task_id: T2, status: "dispatched" }, error: null };
    return { data: null, error: new Error("inesperado") };
  });
}

describe("<HiloAgente />", () => {
  beforeEach(() => { invoke.mockReset(); simular(); });

  it("muestra la conversación, los documentos y todo como texto plano", async () => {
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    expect(await screen.findByTestId("hilo")).toBeTruthy();
    expect(screen.getByText("Listo, aquí está el informe.")).toBeTruthy();
    expect(screen.getAllByTestId("hilo-msg-persona")[0].textContent).toContain("<img src=x onerror=alert(1)>");
    expect(screen.getByTestId("hilo-mensajes").querySelector("img")).toBeNull();
    expect(screen.getByTestId("hilo-entregables").textContent).toContain("informe-actas.docx");
    expect(invoke).toHaveBeenCalledWith("agente-seguimiento", { body: { action: "hilo", task_id: T } });
  });

  it("descargar pide el enlace por tarea e índice y lo abre en otra pestaña", async () => {
    const abrir = vi.spyOn(window, "open").mockImplementation(() => null);
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    fireEvent.click(await screen.findByTestId(`hilo-descargar-${T}-0`));
    await waitFor(() => expect(abrir).toHaveBeenCalledWith("https://x.supabase.co/signed/abc", "_blank", "noopener,noreferrer"));
    expect(invoke).toHaveBeenCalledWith("agente-seguimiento", { body: { action: "descargar", task_id: T, indice: 0 } });
    abrir.mockRestore();
  });

  it("un seguimiento se manda al mismo agente con el hilo_id para que recuerde lo hablado", async () => {
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    fireEvent.change(await screen.findByTestId("hilo-texto"), { target: { value: "Agrega una columna de fechas" } });
    fireEvent.click(screen.getByTestId("hilo-enviar"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("dispatch-to-agent", expect.anything()));
    const body = invoke.mock.calls.find((c) => c[0] === "dispatch-to-agent")![1].body;
    expect(body).toMatchObject({ agent_id: "a1", instructions: "Agrega una columna de fechas", task_type: "manual", input_context: { hilo_id: T } });
    expect(body.title).toBe("Seguimiento: Agrega una columna de fechas");
    expect("accesos_aprobados" in body.input_context).toBe(false);
    await waitFor(() => expect((screen.getByTestId("hilo-texto") as HTMLTextAreaElement).value).toBe(""));
  });

  it("mientras el agente trabaja no se puede escribir encima y se ve «Trabajando…»", async () => {
    simular({ en_curso: true, mensajes: [...HILO.mensajes, { task_id: T2, rol: "persona", texto: "Sigue", cuando: "t", estado: "in_progress", entregables: [] }, { task_id: T2, rol: "agente", texto: "", cuando: "t", estado: "in_progress", entregables: [] }] });
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    expect((await screen.findByTestId("hilo-texto") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByTestId("hilo-enviar") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Trabajando…/)).toBeTruthy();
  });

  it("programa una revisión que se repite: manda la hora en UTC, la serie y el hilo", async () => {
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    await screen.findByTestId("hilo");
    fireEvent.click(screen.getByTestId("atajo-Próximo lunes 9:00"));
    fireEvent.change(screen.getByTestId("revision-repetir"), { target: { value: "semanal" } });
    fireEvent.change(screen.getByTestId("revision-veces"), { target: { value: "4" } });
    fireEvent.change(screen.getByTestId("revision-instruccion"), { target: { value: "  Revisa vencimientos  " } });
    fireEvent.click(screen.getByTestId("revision-programar"));
    await waitFor(() => expect(screen.getByTestId("revision-ok")).toBeTruthy());
    const body = invoke.mock.calls.filter((c) => c[0] === "agente-seguimiento" && c[1].body.action === "programar_revision")[0][1].body;
    expect(body).toMatchObject({ task_id: T, repetir: "semanal", veces: 4, instruccion: "Revisa vencimientos" });
    expect(new Date(body.cuando).toISOString()).toBe(body.cuando);                       // ISO en UTC
    expect(Date.parse(body.cuando)).toBeGreaterThan(AHORA.getTime());
  });

  it("sin fecha no se puede programar; los errores de la función se muestran juntos", async () => {
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    await screen.findByTestId("hilo");
    expect((screen.getByTestId("revision-programar") as HTMLButtonElement).disabled).toBe(true);
    invoke.mockImplementation(async (n: string, { body }: { body: Record<string, unknown> }) => body.action === "programar_revision"
      ? { data: null, error: { context: { json: async () => ({ error: "La revisión no es válida.", errores: ["La revisión debe ser al menos 5 minutos en el futuro.", "Las veces deben ser un número entero de 1 a 52."] }) } } }
      : { data: HILO, error: null });
    fireEvent.change(screen.getByTestId("revision-cuando"), { target: { value: aLocal(new Date(AHORA.getTime() + 86_400_000)) } });
    fireEvent.click(screen.getByTestId("revision-programar"));
    expect((await screen.findByTestId("revision-error")).textContent).toContain("al menos 5 minutos en el futuro. Las veces deben ser");
  });

  it("lista las revisiones pendientes y se pueden cancelar", async () => {
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    const fila = await screen.findByTestId(`revision-${R1}`);
    expect(fila.textContent).toContain("cada semana (3 veces)");
    fireEvent.click(screen.getByTestId(`cancelar-${R1}`));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("agente-seguimiento", { body: { action: "cancelar_revision", task_id: R1 } }));
  });

  it("los atajos caen en el futuro: mañana, próximo lunes y en una semana, a las 9:00", () => {
    const ahora = new Date(2026, 10, 9, 15, 30);                // hora local
    const [man, lun, sem] = ATAJOS(ahora).map((a) => new Date(a.v));
    for (const d of [man, lun, sem]) { expect(d.getTime()).toBeGreaterThan(ahora.getTime()); expect(d.getHours()).toBe(9); expect(d.getMinutes()).toBe(0); }
    expect(man.getDate()).toBe(10); expect(lun.getDay()).toBe(1); expect(Math.round((sem.getTime() - ahora.getTime()) / 86_400_000)).toBeGreaterThanOrEqual(6);
    expect(lun.getTime() - ahora.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
  });

  it("si no se puede leer la solicitud lo dice", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: "No encontramos esa tarea." }) } } });
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    expect((await screen.findByRole("alert")).textContent).toContain("No encontramos esa tarea.");
  });
});

describe("<TrabajosAgente /> y la Oficina", () => {
  beforeEach(() => { invoke.mockReset(); simular(); });

  it("lista solo las solicitudes originales (no los seguimientos ni las revisiones) y abre la conversación", async () => {
    envolver(<TrabajosAgente agentId="a1" nombre="Tlahtolli" ahora={AHORA} />);
    expect(await screen.findByTestId(`trabajo-${T}`)).toBeTruthy();
    expect(screen.queryByTestId(`trabajo-${T2}`)).toBeNull();
    expect(screen.queryByTestId(`trabajo-${R1}`)).toBeNull();
    expect(screen.getByText(/1 documento/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("agente-seguimiento", { body: { action: "listar", agent_id: "a1" } });
    fireEvent.click(screen.getByTestId(`trabajo-${T}`));
    expect(await screen.findByTestId("hilo")).toBeTruthy();
  });

  it("una solicitud nueva se despacha sin hilo y se abre su conversación", async () => {
    envolver(<TrabajosAgente agentId="a1" nombre="Tlahtolli" ahora={AHORA} />);
    await screen.findByTestId("trabajos-agente");
    expect((screen.getByTestId("trabajos-enviar") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("trabajos-titulo"), { target: { value: "Revisión de libros" } });
    fireEvent.change(screen.getByTestId("trabajos-texto"), { target: { value: "Revisa los libros corporativos" } });
    fireEvent.click(screen.getByTestId("trabajos-enviar"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("dispatch-to-agent", expect.anything()));
    const body = invoke.mock.calls.find((c) => c[0] === "dispatch-to-agent")![1].body;
    expect(body).toMatchObject({ agent_id: "a1", title: "Revisión de libros", instructions: "Revisa los libros corporativos" });
    expect("input_context" in body).toBe(false);                                           // es la raíz de su propio hilo
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("agente-seguimiento", { body: { action: "hilo", task_id: T2 } }));
  });

  it("la Oficina muestra el panel del agente elegido, y solo del elegido", () => {
    const ag = (id: string, name: string): AgenteRegistro => ({ id, name, display_name: name, description: "x", role: null, status: "idle", kind: "consultable", last_heartbeat: new Date().toISOString(), last_task_at: null, tasks_completed: 0, tasks_failed: 0 });
    const figuras = figurasOficina([ag("a1", "Tlahtolli"), ag("a2", "Atl")], [], new Date());
    envolver(<Oficina figuras={figuras} ahora={new Date()} demo={false} detalleExtra={(f) => <p data-testid="extra">panel de {f.nombre}</p>} />);
    expect(screen.queryByTestId("oficina-extra")).toBeNull();
    fireEvent.click(screen.getByTestId("oficina-a2"));
    expect(screen.getByTestId("extra").textContent).toBe("panel de Atl");
    fireEvent.click(screen.getByTestId("oficina-a2"));                                      // deseleccionar
    expect(screen.queryByTestId("oficina-extra")).toBeNull();
  });
});
