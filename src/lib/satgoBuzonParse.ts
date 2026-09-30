/** Parseo de raw_response SATgo buzón (comunicados / notificaciones). */

export type SatgoComunicadoItem = {
  id: string | null;
  titulo: string;
  fechaComunicado: string | null;
  esLeido: boolean | null;
  enlace: string | null;
  fileName: string | null;
  descargaExitosa: boolean | null;
  kawiilFilePath: string | null;
  kawiilFileName: string | null;
};

export type SatgoNotificacionItem = {
  folio: string | null;
  acto: string | null;
  fecha: string | null;
  autoridad: string | null;
  pdfFileName: string | null;
  pdfDescargado: boolean | null;
  grupo: "pendientes" | "notificadas";
  kawiilFilePath: string | null;
  kawiilFileName: string | null;
  acuseFilePath: string | null;
  acuseFileName: string | null;
  actoFilePath: string | null;
  actoFileName: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

export function parseComunicadosFromRaw(raw: unknown): SatgoComunicadoItem[] {
  const top = asRecord(raw);
  if (!top) return [];
  const result = asRecord(top.result) ?? top;
  const list = Array.isArray(result.comunicados) ? result.comunicados : [];
  return list
    .map((item): SatgoComunicadoItem | null => {
      const o = asRecord(item);
      if (!o) return null;
      const titulo = str(o.titulo);
      if (!titulo) return null;
      return {
        id: str(o.id),
        titulo,
        fechaComunicado: str(o.fechaComunicado),
        esLeido: bool(o.esLeido),
        enlace: str(o.enlace),
        fileName: str(o.fileName),
        descargaExitosa: bool(o.descargaExitosa),
        kawiilFilePath: str(o.kawiilFilePath),
        kawiilFileName: str(o.kawiilFileName) ?? str(o.fileName),
      };
    })
    .filter(Boolean) as SatgoComunicadoItem[];
}

function parseNotifList(
  block: unknown,
  grupo: "pendientes" | "notificadas",
): SatgoNotificacionItem[] {
  const o = asRecord(block);
  if (!o) return [];
  const list = Array.isArray(o.notificaciones) ? o.notificaciones : [];
  return list
    .map((item): SatgoNotificacionItem | null => {
      const n = asRecord(item);
      if (!n) return null;
      return {
        folio: str(n.folio),
        acto: str(n.acto),
        fecha: str(n.fecha),
        autoridad: str(n.autoridad),
        pdfFileName: str(n.pdfFileName),
        pdfDescargado: bool(n.pdfDescargado),
        grupo,
        kawiilFilePath: str(n.kawiilFilePath),
        kawiilFileName: str(n.kawiilFileName) ?? str(n.pdfFileName),
        acuseFilePath: str(asRecord(n.acuseRow)?.kawiilFilePath),
        acuseFileName: str(asRecord(n.acuseRow)?.kawiilFileName),
        actoFilePath: str(asRecord(n.actoAdministrativoRow)?.kawiilFilePath),
        actoFileName: str(asRecord(n.actoAdministrativoRow)?.kawiilFileName),
      };
    })
    .filter(Boolean) as SatgoNotificacionItem[];
}

export function parseNotificacionesFromRaw(raw: unknown): {
  pendientes: SatgoNotificacionItem[];
  notificadas: SatgoNotificacionItem[];
  all: SatgoNotificacionItem[];
} {
  const top = asRecord(raw);
  if (!top) return { pendientes: [], notificadas: [], all: [] };
  const pendientes = parseNotifList(top.pendientes, "pendientes");
  const notificadas = parseNotifList(top.notificadas, "notificadas");
  return { pendientes, notificadas, all: [...pendientes, ...notificadas] };
}
