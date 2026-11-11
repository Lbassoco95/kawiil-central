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

import { dentroDeCarpeta, entradaDrive, idDriveValido, tipoLegibleDrive, MIME_CARPETA } from "../../supabase/functions/_shared/cuentasAgentes";
describe("Google Drive de una cuenta vinculada", () => {
  it("tipos: lo nativo de Google se exporta a texto; pdf/docx/xlsx/texto se descargan; lo demás no se lee", () => {
    expect(tipoLegibleDrive("application/vnd.google-apps.document")).toEqual({ exportar: "text/plain", mime: "text/plain" });
    expect(tipoLegibleDrive("application/vnd.google-apps.spreadsheet")).toEqual({ exportar: "text/csv", mime: "text/csv" });
    expect(tipoLegibleDrive("application/pdf")).toEqual({ exportar: null, mime: "application/pdf" });
    for (const x of ["application/zip", "video/mp4", "application/x-msdownload", "", null, 5]) expect(tipoLegibleDrive(x)).toBeNull();
  });
  it("entrada pública: solo lo necesario; descarta ids raros", () => {
    expect(entradaDrive({ id: "1AbCdEfGh", name: "Acta.pdf", mimeType: "application/pdf", size: "2048", modifiedTime: "2026-10-01T00:00:00Z", parents: ["x"], owners: [{}] }))
      .toEqual({ id: "1AbCdEfGh", nombre: "Acta.pdf", tipo: "archivo", tamano: 2048, modificado: "2026-10-01T00:00:00Z" });
    expect(entradaDrive({ id: "1AbCdEfGh", name: "KYC", mimeType: MIME_CARPETA })?.tipo).toBe("carpeta");
    expect(entradaDrive({ id: "../x", name: "a" })).toBeNull(); expect(entradaDrive(null)).toBeNull();
    expect(idDriveValido("1AbCdEfGh")).toBe(true); for (const x of ["a/b", "ab", "", null]) expect(idDriveValido(x)).toBe(false);
  });
  describe("confinamiento a la carpeta de la fuente", () => {
    // árbol: raiz → VIZUM → KYC → lista.pdf ; raiz → OTRO → acta.pdf ; un archivo con dos padres (uno de ellos dentro de VIZUM)
    const padres: Record<string, string[]> = { VIZUM_1: ["RAIZ_1"], KYC_1: ["VIZUM_1"], LISTA_1: ["KYC_1"], OTRO_1: ["RAIZ_1"], ACTA_1: ["OTRO_1"], DOBLE_1: ["OTRO_1", "KYC_1"], CICLO_A: ["CICLO_B"], CICLO_B: ["CICLO_A"] };
    const de = async (id: string) => padres[id] ?? [];
    it("la carpeta límite y todo lo que cuelga de ella (a cualquier profundidad)", async () => {
      expect(await dentroDeCarpeta("VIZUM_1", "VIZUM_1", de)).toBe(true);
      expect(await dentroDeCarpeta("LISTA_1", "VIZUM_1", de)).toBe(true);
      expect(await dentroDeCarpeta("DOBLE_1", "VIZUM_1", de)).toBe(true);
    });
    it("lo de otro cliente, la raíz y lo desconocido quedan fuera", async () => {
      expect(await dentroDeCarpeta("ACTA_1", "VIZUM_1", de)).toBe(false);
      expect(await dentroDeCarpeta("RAIZ_1", "VIZUM_1", de)).toBe(false);
      expect(await dentroDeCarpeta("DESCONOCIDO_1", "VIZUM_1", de)).toBe(false);
    });
    it("ids inválidos, ciclos y árboles enormes no cuelgan ni dejan pasar", async () => {
      expect(await dentroDeCarpeta("../x", "VIZUM_1", de)).toBe(false);
      expect(await dentroDeCarpeta("CICLO_A", "VIZUM_1", de)).toBe(false);
      let n = 0;
      const infinito = async (id: string) => { n++; return [`${id}x`.slice(-60) + n]; };
      expect(await dentroDeCarpeta("ABCDEF_1", "VIZUM_1", infinito, 10)).toBe(false); expect(n).toBeLessThanOrEqual(10);
    });
  });
});
