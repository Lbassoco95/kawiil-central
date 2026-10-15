/**
 * Botón compartido: descargar la transcripción de la junta (TXT legible u original).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatDateMX } from "@/lib/dateUtils";
import type { MtgMeetingRow } from "@/lib/mtg/db";
import { MTG_BUCKET } from "@/lib/mtg/storagePaths";
import { parseVttToPlainText } from "@/lib/mtg/transcriptParse";

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseFileName(meeting: MtgMeetingRow, title?: string | null): string {
  const raw = `${title ?? meeting.title ?? "junta"} ${formatDateMX(meeting.scheduled_at)}`;
  const safe = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `transcripcion-${safe || meeting.id}`;
}

export function MtgDownloadTranscriptButton(props: {
  meeting: MtgMeetingRow;
  title?: string | null;
  size?: "sm" | "default";
  variant?: "outline" | "secondary" | "default";
}) {
  const [busy, setBusy] = useState(false);
  const path = props.meeting.transcript_path;
  if (!path) return null;

  const isVtt = path.toLowerCase().endsWith(".vtt");
  const ext = isVtt ? "vtt" : "txt";

  const download = async (format: "txt" | "original") => {
    setBusy(true);
    try {
      const { data, error } = await supabase.storage.from(MTG_BUCKET).download(path);
      if (error || !data) throw new Error(error?.message ?? "No se pudo descargar");
      const name = baseFileName(props.meeting, props.title);
      if (format === "original") {
        saveBlob(data, `${name}.${ext}`);
      } else {
        const raw = await data.text();
        const text = isVtt ? parseVttToPlainText(raw) : raw;
        saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${name}.txt`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo descargar la transcripción");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size={props.size ?? "sm"}
          variant={props.variant ?? "outline"}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5 mr-1" />
          )}
          Transcripción
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void download("txt")}>
          Descargar como texto (.txt)
        </DropdownMenuItem>
        {isVtt && (
          <DropdownMenuItem onSelect={() => void download("original")}>
            Descargar original con tiempos (.vtt)
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
