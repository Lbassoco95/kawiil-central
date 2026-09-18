/**
 * Botón compartido: subir transcripción .vtt / .txt / .docx.
 */

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";
import { canManualUploadTranscript } from "@/lib/mtg/transcriptParse";
import { uploadManualTranscript } from "@/lib/mtg/uploadTranscript";

export function MtgUploadTranscriptButton(props: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
  onDone?: () => void;
  size?: "sm" | "default";
  variant?: "outline" | "secondary" | "default";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (!canManualUploadTranscript(props.meeting.status)) return null;

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadManualTranscript({
        organizationId: props.organizationId,
        actorUserId: props.actorUserId,
        meeting: props.meeting,
        series: props.series,
        file,
      });
      toast.success("Transcripción subida; minuta encolada");
      props.onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al subir");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".vtt,.txt,.docx,text/vtt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      <Button
        type="button"
        size={props.size ?? "sm"}
        variant={props.variant ?? "outline"}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5 mr-1" />
        )}
        Subir transcripción
      </Button>
    </>
  );
}
