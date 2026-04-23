import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildEmailSheetPreview,
  EMAIL_ATTACHMENT_PREVIEW_MAX_BYTES,
  type EmailSheetPreviewData,
} from "@/lib/emailAttachmentSheetPreview";
import { KAWIIL_AI_SOFT_BG } from "@/lib/kawiilAi";

interface ArtifactSpreadsheetPreviewProps {
  bucket: string;
  storagePath: string;
  fileName: string;
}

export function ArtifactSpreadsheetPreview({ bucket, storagePath, fileName }: ArtifactSpreadsheetPreviewProps) {
  const [data, setData] = useState<EmailSheetPreviewData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      setData(null);
      try {
        const { data: blob, error } = await supabase.storage.from(bucket).download(storagePath);
        if (cancelled) return;
        if (error || !blob) {
          setErr(error?.message || "No se pudo descargar el archivo");
          return;
        }
        if (blob.size > EMAIL_ATTACHMENT_PREVIEW_MAX_BYTES) {
          setErr("El archivo supera el límite para vista previa en el navegador. Usa Descargar para abrirlo en Excel.");
          return;
        }
        const sheet = await buildEmailSheetPreview(blob, fileName || `${storagePath.split("/").pop() || "libro"}.xlsx`);
        if (!cancelled) setData(sheet);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "No se pudo leer la hoja de cálculo");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bucket, storagePath, fileName]);

  if (loading) {
    return (
      <div className="flex flex-1 min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Cargando vista previa de Excel…
      </div>
    );
  }

  if (err) {
    return (
      <div className="m-3 rounded-md border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
        {err}
      </div>
    );
  }

  if (!data || !data.rows.length) {
    return (
      <p className="m-3 text-xs text-muted-foreground">No hay celdas para mostrar en la primera hoja.</p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 min-h-[50vh] min-[900px]:min-h-0 flex-col" style={{ background: KAWIIL_AI_SOFT_BG }}>
      <p className="shrink-0 border-b border-sky-200/50 px-3 py-1.5 text-[10px] text-muted-foreground">
        Hoja: <span className="font-medium text-foreground">{data.sheetName}</span>
        {data.extraSheets > 0
          ? ` · +${data.extraSheets} hoja(s) adicional(es) (vista: primera hoja solamente)`
          : null}
        {data.truncatedRows || data.truncatedCols
          ? " · Tabla truncada para la vista previa"
          : null}
      </p>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <table className="w-max min-w-full border-collapse text-[11px] leading-tight">
          <tbody>
            {data.rows.map((row, ri) => (
              <tr key={ri} className={ri === 0 ? "bg-sky-100/90 font-medium dark:bg-sky-950/40" : ri % 2 === 0 ? "bg-white/60" : "bg-slate-50/50"}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="border border-border/50 px-1.5 py-0.5 align-top text-left whitespace-nowrap max-w-[min(280px,40vw)] overflow-hidden text-ellipsis"
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
