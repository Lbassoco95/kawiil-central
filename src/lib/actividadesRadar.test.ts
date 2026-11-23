import { describe, expect, it } from "vitest";
import {
  construirMensajeRadar, diasHasta, evaluarActividad,
  type RadarActividad, type RadarAsistente,
} from "../../supabase/functions/_shared/actividadesRadar";

const HOY = "2026-12-10";
const act = (o: Partial<RadarActividad> = {}): RadarActividad => ({
  id: "a1", name: "Navidad Kawiil", event_date: "2026-12-18", event_time: null,
  venue_confirmed: false, location: null, ...o,
});
const inv = (o: Partial<RadarAsistente> = {}): RadarAsistente => ({
  confirmed: "pendiente", rsvp_responded_at: null, extra_guests_status: "none", ...o,
});
const claves = (h: { clave: string }[]) => h.map((x) => x.clave);

describe("diasHasta", () => {
  it("cuenta días enteros", () => {
    expect(diasHasta("2026-12-18", HOY)).toBe(8);
    expect(diasHasta(HOY, HOY)).toBe(0);
    expect(diasHasta("2026-12-09", HOY)).toBe(-1);
  });
});

describe("evaluarActividad", () => {
  it("evento pasado: no vigila", () => {
    expect(evaluarActividad(act({ event_date: "2026-12-01" }), [inv()], [], [], HOY)).toEqual([]);
  });
  it("sede sin confirmar y sin hora a 8 días: 'pronto'", () => {
    const h = evaluarActividad(act(), [], [], [], HOY);
    expect(claves(h)).toEqual(expect.arrayContaining(["sede", "hora"]));
    expect(h.every((x) => x.momento === "pronto")).toBe(true);
  });
  it("a 7 días o menos pasa a 'ahora'", () => {
    const h = evaluarActividad(act({ event_date: "2026-12-17" }), [], [], [], HOY);
    expect(h.find((x) => x.clave === "sede")!.momento).toBe("ahora");
  });
  it("lejano (>21 días) no avisa de sede", () => {
    expect(evaluarActividad(act({ event_date: "2027-02-01" }), [], [], [], HOY)).toEqual([]);
  });
  it("sin fecha: avisa una vez", () => {
    expect(claves(evaluarActividad(act({ event_date: null }), [], [], [], HOY))).toEqual(["sin_fecha"]);
  });
  it("Invitados extra por aprobar siempre es 'ahora', aunque falte mucho", () => {
    const h = evaluarActividad(act({ event_date: "2027-03-01" }), [inv({ extra_guests_status: "solicitado" })], [], [], HOY);
    expect(h).toEqual([expect.objectContaining({ clave: "plus_uno", momento: "ahora" })]);
  });
  it("invitados sin responder solo a ≤14 días; quien ya respondió no cuenta", () => {
    const gente = [inv(), inv({ rsvp_responded_at: "2026-12-09T10:00:00Z", confirmed: "si" })];
    expect(claves(evaluarActividad(act({ event_date: "2026-12-30", venue_confirmed: true, event_time: "15:00" }), gente, [], [], HOY))).toEqual([]);
    const h = evaluarActividad(act({ venue_confirmed: true, event_time: "15:00" }), gente, [], [], HOY);
    expect(h).toEqual([expect.objectContaining({ clave: "sin_responder", texto: "1 invitado sin responder" })]);
  });
  it("proveedores: apartado sin anticipo y rubro aún cotizando", () => {
    const h = evaluarActividad(
      act({ venue_confirmed: true, event_time: "15:00" }), [],
      [{ category: "alimentos", status: "apartado", advance: null }, { category: "souvenirs", status: "cotizacion", advance: null }],
      [], HOY,
    );
    expect(claves(h)).toEqual(expect.arrayContaining(["anticipos", "sin_elegir"]));
  });
  it("rubro con otra opción ya elegida no cuenta como sin elegir", () => {
    const h = evaluarActividad(
      act({ venue_confirmed: true, event_time: "15:00" }), [],
      [{ category: "alimentos", status: "cotizacion", advance: null }, { category: "alimentos", status: "pagado", advance: 500 }],
      [], HOY,
    );
    expect(claves(h)).not.toContain("sin_elegir");
  });
  it("tareas vencidas abiertas cuentan; completadas o con fecha futura no", () => {
    const h = evaluarActividad(
      act({ venue_confirmed: true, event_time: "15:00" }), [], [],
      [{ due_date: "2026-12-05", status: "pendiente" }, { due_date: "2026-12-05", status: "completada" }, { due_date: "2026-12-12", status: "pendiente" }],
      HOY,
    );
    expect(h).toEqual([expect.objectContaining({ clave: "tareas", texto: "1 tarea vencida" })]);
  });
});

describe("construirMensajeRadar", () => {
  const r = (hallazgos: { clave: string; momento: "ahora" | "pronto"; texto: string }[], dias = 8) =>
    ({ id: "a1", name: "Navidad Kawiil", dias, hallazgos });
  it("nada que decir → null", () => {
    expect(construirMensajeRadar("Leo", [r([])], true)).toBeNull();
  });
  it("entre semana solo lo 'ahora'; lo 'pronto' espera al lunes", () => {
    const h = [{ clave: "sede", momento: "pronto" as const, texto: "La sede no está confirmada" }];
    expect(construirMensajeRadar("Leo", [r(h)], false)).toBeNull();
    expect(construirMensajeRadar("Leo", [r(h)], true)!.title).toBe("Kawiilito · Actividades de la semana");
  });
  it("incluye nombre, momento y texto", () => {
    const m = construirMensajeRadar("Leo", [r([{ clave: "plus_uno", momento: "ahora", texto: "1 solicitud de invitados extra espera tu aprobación" }], 1)], false)!;
    expect(m.title).toBe("Kawiilito · Actividades por atender");
    expect(m.body).toContain("Leo, esto pide tu atención");
    expect(m.body).toContain("Navidad Kawiil (mañana): 1 solicitud de invitados extra espera tu aprobación.");
  });
});
