/**
 * Minuta en Markdown → HTML con formato (negritas, listas, encabezados) para
 * copiarla y enviarla por correo desde el Outlook de quien envía (microsoft-api).
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";

const WRAP =
  "font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111;max-width:720px";

/** HTML con estilos en línea (los clientes de correo ignoran las hojas de estilo). */
export function minutesToHtml(md: string): string {
  const body = renderToStaticMarkup(createElement(ReactMarkdown, null, md))
    .replace(/<h1>/g, '<h1 style="font-size:20px;margin:0 0 8px">')
    .replace(/<h2>/g, '<h2 style="font-size:16px;margin:18px 0 6px;border-bottom:1px solid #e5e7eb;padding-bottom:4px">')
    .replace(/<ul>/g, '<ul style="margin:4px 0 8px 18px;padding:0">')
    .replace(/<li>/g, '<li style="margin:3px 0">')
    .replace(/<p>/g, '<p style="margin:6px 0">');
  return `<div style="${WRAP}">${body}</div>`;
}

/** Copia la minuta con formato (y como texto plano de respaldo). */
export async function copyMinutes(md: string): Promise<"rich" | "plain"> {
  const html = minutesToHtml(md);
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([md], { type: "text/plain" }),
        }),
      ]);
      return "rich";
    }
  } catch {
    /* cae a texto plano */
  }
  await navigator.clipboard.writeText(md);
  return "plain";
}

export function parseEmails(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map((e) => e.trim())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
    ),
  ];
}

export async function sendMinutesEmail(opts: { to: string[]; subject: string; md: string }): Promise<void> {
  if (opts.to.length === 0) throw new Error("Agrega al menos un destinatario");
  const { data, error } = await supabase.functions.invoke("microsoft-api", {
    body: {
      action: "send-email",
      params: {
        message: {
          subject: opts.subject,
          body: { contentType: "HTML", content: minutesToHtml(opts.md) },
          toRecipients: opts.to.map((address) => ({ emailAddress: { address } })),
        },
      },
    },
  });
  if (error || data?.error) throw new Error(String(data?.error ?? error?.message ?? "No se pudo enviar"));
}
