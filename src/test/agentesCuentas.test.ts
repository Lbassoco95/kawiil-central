import { describe, it, expect } from "vitest";
import {
  aTextoPlano, coincideEvento, consultaGmail, consultaGraph, consultaSegura, correoDeGmail, correoDeGraph, cuentaPublica, cuerpoDeGmail, eventoDeGoogle, eventoDeGraph,
  fechaIso, idMensajeValido, limite, rangoEventos, refCuentaValida, adjuntosDeGraph, MAX_RESULTADOS, MAX_DIAS_EVENTOS,
} from "../../supabase/functions/_shared/cuentasAgentes";

const U = "0b47849a-312c-4ad0-81ce-d173d61f9348";
const b64 = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("referencias y búsquedas", () => {
  it("cuenta: uuid o ms-uuid; lo demás no", () => {
    expect(refCuentaValida(U)).toBe(true); expect(refCuentaValida(`ms-${U}`)).toBe(true);
    for (const x of ["", "x", `ms-${U}x`, `../${U}`, `${U}'; drop`, 5, null]) expect(refCuentaValida(x)).toBe(false);
  });
  it("id de mensaje: solo caracteres de id", () => { expect(idMensajeValido("18c3a_B-9=")).toBe(true); for (const x of ["a/b", "a b", "abc", "x".repeat(301), null]) expect(idMensajeValido(x)).toBe(false); });
  it("la consulta no puede salirse de sus comillas", () => {
    expect(consultaSegura('ACME" OR in:anywhere \\')).toBe("ACME OR in:anywhere");
    expect(consultaGmail('Acme "x', "2026-01-05", "2026-02-01T10:00:00Z")).toBe('"Acme x" after:2026/01/05 before:2026/02/01');
    expect(consultaGmail("", "no", null)).toBe("");
    expect(consultaGraph('Acme"')).toBe('"Acme"'); expect(consultaGraph("  ")).toBe("");
    expect(consultaSegura("x".repeat(500)).length).toBe(200);
  });
  it("fechas y límites", () => {
    expect(fechaIso("2026-11-10")).toBe("2026-11-10T00:00:00.000Z"); expect(fechaIso("mañana")).toBeNull(); expect(fechaIso(5)).toBeNull();
    expect(limite(undefined)).toBe(10); expect(limite(500)).toBe(MAX_RESULTADOS); expect(limite(0)).toBe(10); expect(limite(3)).toBe(3);
  });
  it("rango de eventos: por defecto 30 días; rechaza invertido o de más de un año", () => {
    const ahora = Date.parse("2026-11-10T12:00:00Z");
    expect(rangoEventos(undefined, undefined, ahora)).toEqual({ desde: "2026-11-10T12:00:00.000Z", hasta: "2026-12-10T12:00:00.000Z" });
    expect(rangoEventos("2026-12-01", "2026-11-01", ahora)).toBeNull();
    expect(rangoEventos("2026-01-01", "2028-01-01", ahora)).toBeNull();
    expect(rangoEventos("2026-01-01", new Date(Date.parse("2026-01-01") + MAX_DIAS_EVENTOS * 86_400_000).toISOString(), ahora)).not.toBeNull();
  });
});

describe("texto", () => {
  it("HTML a texto: sin scripts ni estilos ni etiquetas", () => {
    const t = aTextoPlano("<html><head><style>p{}</style></head><body><script>alert(1)</script><p>Hola&nbsp;<b>Polo</b></p><p>Acta &amp; libro</p></body></html>");
    expect(t).toBe("Hola Polo\nActa & libro"); expect(t).not.toMatch(/alert|<|style/);
  });
  it("acota el tamaño", () => { expect(aTextoPlano("a".repeat(50_000)).length).toBeLessThanOrEqual(12_000); });
});

describe("normalización", () => {
  const gm = { id: "m1", internalDate: "1762776000000", snippet: "Adjunto el acta", payload: { headers: [{ name: "from", value: "Ana <ana@x.com>" }, { name: "Subject", value: "Acta" }, { name: "To", value: "polo@kawiil.mx" }],
    parts: [{ mimeType: "text/plain", body: { data: b64("Hola\nadjunto") } }, { filename: "acta.pdf", mimeType: "application/pdf", body: { attachmentId: "att1", size: 900 } }] } };
  it("Gmail: metadatos, adjuntos y cuerpo", () => {
    expect(correoDeGmail(gm)).toMatchObject({ id: "m1", de: "Ana <ana@x.com>", asunto: "Acta", adjuntos: true, fragmento: "Adjunto el acta" });
    const c = cuerpoDeGmail(gm);
    expect(c.texto).toBe("Hola\nadjunto"); expect(c.adjuntos).toEqual([{ id: "att1", nombre: "acta.pdf", tamano: 900, tipo: "application/pdf" }]);
  });
  it("Gmail con solo HTML usa el texto del HTML", () => {
    expect(cuerpoDeGmail({ payload: { mimeType: "text/html", body: { data: b64("<p>Hola <b>mundo</b></p>") } } }).texto).toBe("Hola mundo");
  });
  it("Graph: correo, adjuntos (sin los incrustados) y evento", () => {
    expect(correoDeGraph({ id: "g1", subject: "Libro", from: { emailAddress: { name: "Luis", address: "l@x.com" } }, toRecipients: [{ emailAddress: { address: "p@k.mx" } }], receivedDateTime: "2026-11-01T10:00:00Z", bodyPreview: "hola", hasAttachments: true }))
      .toMatchObject({ de: "Luis <l@x.com>", para: "p@k.mx", asunto: "Libro", adjuntos: true });
    expect(adjuntosDeGraph([{ id: "a", name: "x.pdf", size: 5, contentType: "application/pdf" }, { id: "b", name: "logo.png", isInline: true }])).toHaveLength(1);
    expect(eventoDeGraph({ id: "e", subject: "Asamblea ACME", start: { dateTime: "2026-11-12T10:00:00" }, end: { dateTime: "2026-11-12T11:00:00" }, location: { displayName: "Sala 2" }, attendees: [{ emailAddress: { address: "a@x.com" } }] }))
      .toMatchObject({ titulo: "Asamblea ACME", lugar: "Sala 2", asistentes: ["a@x.com"], todo_el_dia: false });
    expect(eventoDeGoogle({ id: "e", summary: "Junta", start: { date: "2026-11-12" }, end: { date: "2026-11-13" } })).toMatchObject({ titulo: "Junta", todo_el_dia: true });
  });
  it("tolera basura sin romperse", () => { expect(correoDeGmail(null).asunto).toBe("(sin asunto)"); expect(eventoDeGraph(undefined).titulo).toBe("(sin título)"); expect(cuerpoDeGmail({}).texto).toBe(""); });
  it("filtro de eventos por texto", () => {
    const e = eventoDeGraph({ subject: "Asamblea ACME", organizer: { emailAddress: { address: "z@x.com" } } });
    expect(coincideEvento(e, "acme")).toBe(true); expect(coincideEvento(e, "otro")).toBe(false); expect(coincideEvento(e, "")).toBe(true);
  });
});

describe("cuentas", () => {
  it("solo se ofrecen Google y Microsoft conectadas; nunca tokens", () => {
    const f = { id: U, provider: "google", status: "connected", email: "legal@kawiil.mx", display_name: "Legal", mail_enabled: true, calendar_enabled: false, access_token: "SECRETO", refresh_token: "SECRETO2" };
    const p = cuentaPublica(f)!;
    expect(p).toEqual({ cuenta: U, proveedor: "google", correo: "legal@kawiil.mx", nombre: "Legal", correo_activo: true, calendario_activo: false });
    expect(JSON.stringify(p)).not.toContain("SECRETO");
    expect(cuentaPublica({ ...f, provider: "imap" })).toBeNull(); expect(cuentaPublica({ ...f, status: "error" })).toBeNull(); expect(cuentaPublica({ ...f, id: "x" })).toBeNull();
  });
});

import { cuentasActivas } from "@/components/agentes/DocumentosAgente";
import { capacidadesAgente } from "@/components/agentes/FichaAgente";
describe("interruptor por agente", () => {
  it("solo config.cuentas.activa === true cuenta; se ve en la ficha", () => {
    expect(cuentasActivas({ config: { cuentas: { activa: true } } } as never)).toBe(true);
    for (const c of [undefined, {}, { cuentas: { activa: "true" } }, { cuentas: true }, null]) expect(cuentasActivas({ config: c } as never)).toBe(false);
    expect(capacidadesAgente({ config: { cuentas: { activa: true } } } as never)).toContain("Correo y calendario");
    expect(capacidadesAgente({ config: {} } as never)).not.toContain("Correo y calendario");
  });
});
