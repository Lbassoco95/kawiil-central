import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { uploadMoffinPdfFromBytes, uploadMoffinPdfFromUrl } from "./moffinPdfDownload.ts";
import {
  extractPdfBase64FromSatReport,
  pickSatRfcPdfUrlForConsult,
  type MoffinSatRfcConsultType,
} from "./moffinSatRfc.ts";
import { fetchMoffinPdfUrlViaServiceQueries } from "./moffinServiceQueries.ts";

type Admin = ReturnType<typeof createClient>;

export type SatRfcUploadContext = {
  admin: Admin;
  orgId: string;
  projectId: string;
  clientId: string | null;
  uploadedBy: string | null;
  moffinBase: string;
  moffinApiKey: string;
  rfc: string;
  externalId?: string | null;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeBase64ToBytes(b64: string): Uint8Array | null {
  const t = b64.replace(/\s/g, "");
  try {
    const bin = atob(t);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * Intenta obtener PDF de constancia/opinión: URL en reporte, base64 en JSON,
 * o GET /service_queries?withFileURL=true (OpenAPI Moffin para sat_rfc).
 */
export async function tryUploadSatRfcPdf(
  opts: SatRfcUploadContext & {
    consultType: MoffinSatRfcConsultType;
    report: Record<string, unknown>;
    fileBase: string;
    documentDisplayName: string;
    documentType: string;
  },
): Promise<{ documentId: string | null; pdfFailure: string | null; sawPdfUrl: boolean }> {
  const { consultType, report } = opts;
  let sawPdfUrl = false;
  let lastFail: string | null = null;

  const pdfUrl0 = pickSatRfcPdfUrlForConsult(consultType, report, opts.moffinBase);
  if (pdfUrl0) sawPdfUrl = true;

  if (pdfUrl0) {
    const up = await uploadMoffinPdfFromUrl({
      admin: opts.admin,
      orgId: opts.orgId,
      projectId: opts.projectId,
      clientId: opts.clientId,
      uploadedBy: opts.uploadedBy,
      url: pdfUrl0,
      fileBase: opts.fileBase,
      documentDisplayName: opts.documentDisplayName,
      documentType: opts.documentType,
      moffinApiKey: opts.moffinApiKey,
    });
    if (up.documentId) {
      return { documentId: up.documentId, pdfFailure: null, sawPdfUrl };
    }
    lastFail = up.failureReason ?? "descarga PDF falló";
  }

  const b64 = extractPdfBase64FromSatReport(report);
  if (b64) {
    const buf = decodeBase64ToBytes(b64);
    if (buf) {
      const up = await uploadMoffinPdfFromBytes({
        admin: opts.admin,
        orgId: opts.orgId,
        projectId: opts.projectId,
        clientId: opts.clientId,
        uploadedBy: opts.uploadedBy,
        buf,
        fileBase: opts.fileBase,
        documentDisplayName: opts.documentDisplayName,
        documentType: opts.documentType,
      });
      if (up.documentId) {
        return { documentId: up.documentId, pdfFailure: null, sawPdfUrl };
      }
      lastFail = up.failureReason ?? "subida PDF base64 falló";
    }
  }

  const reportId = report.id != null ? String(report.id) : "";
  if (reportId) {
    const sqOpts = {
      reportId,
      rfc: opts.rfc,
      externalId: opts.externalId,
    };
    let sqUrl: string | null = null;
    const retryDelaysMs = [0, 2000, 5000];
    for (let i = 0; i < retryDelaysMs.length; i++) {
      if (retryDelaysMs[i] > 0) await delay(retryDelaysMs[i]);
      sqUrl = await fetchMoffinPdfUrlViaServiceQueries(
        opts.moffinBase,
        opts.moffinApiKey,
        sqOpts,
      );
      if (sqUrl) break;
    }
    if (sqUrl) {
      sawPdfUrl = true;
      const up = await uploadMoffinPdfFromUrl({
        admin: opts.admin,
        orgId: opts.orgId,
        projectId: opts.projectId,
        clientId: opts.clientId,
        uploadedBy: opts.uploadedBy,
        url: sqUrl,
        fileBase: opts.fileBase,
        documentDisplayName: opts.documentDisplayName,
        documentType: opts.documentType,
        moffinApiKey: opts.moffinApiKey,
      });
      if (up.documentId) {
        return { documentId: up.documentId, pdfFailure: null, sawPdfUrl };
      }
      lastFail = up.failureReason ?? "descarga PDF (service_queries) falló";
    }
  }

  if (!sawPdfUrl && !b64) {
    const resp = report.response as Record<string, unknown> | undefined;
    const data = resp?.data as Record<string, unknown> | undefined;
    console.log(
      JSON.stringify({
        moffin_sat_pdf: "sin_fuente_tras_service_queries",
        consultType,
        reportId: reportId || null,
        topKeys: Object.keys(report),
        hasCertificates: Array.isArray(data?.certificates),
        hasTopPdfURL: typeof report.pdfURL === "string",
      }),
    );
  }

  return {
    documentId: null,
    pdfFailure:
      lastFail ?? (sawPdfUrl ? "no se pudo guardar el PDF" : "sin URL de PDF en respuesta Moffin"),
    sawPdfUrl,
  };
}
