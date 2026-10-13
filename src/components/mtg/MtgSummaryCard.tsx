/**
 * Resumen de la junta (borrador de minuta generado con IA) visible en el tablero,
 * sin depender del estado de la junta (p. ej. «Programada»).
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Copy, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { mtgDb } from "@/lib/mtg/db";
import { copyMinutes } from "@/lib/mtg/minutesEmail";

export function MtgSummaryCard({ meetingId }: { meetingId: string }) {
  const [open, setOpen] = useState(true);
  // Clave bajo "mtg-board": se refresca sola cuando la junta recarga (board.invalidate()).
  const { data } = useQuery({
    queryKey: ["mtg-board", meetingId, "summary"],
    queryFn: async () => {
      const { data: rows } = await mtgDb
        .from("mtg_minutes")
        .select("id, version, status, content_md, generated_by, created_at")
        .eq("meeting_id", meetingId)
        .neq("status", "superseded")
        .order("version", { ascending: false })
        .limit(1);
      return rows?.[0] ?? null;
    },
  });

  if (!data?.content_md?.trim()) return null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <FileText className="h-4 w-4" />
          Resumen de la junta
          <span className="text-[11px] font-normal text-muted-foreground">
            borrador {data.generated_by === "model" ? "con IA" : ""} ·{" "}
            {new Date(data.created_at).toLocaleString("es-MX")}
          </span>
        </p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={async () => {
              try {
                const kind = await copyMinutes(data.content_md ?? "");
                toast.success(kind === "rich" ? "Resumen copiado con formato" : "Resumen copiado (texto)");
              } catch {
                toast.error("No se pudo copiar");
              }
            }}
          >
            <Copy className="h-3.5 w-3.5 mr-1" />
            Copiar
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link to={`/juntas/${meetingId}/minuta`}>Abrir minuta completa</Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Contraer resumen" : "Expandir resumen"}
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {open && <KawiilAiMarkdown>{data.content_md}</KawiilAiMarkdown>}
    </div>
  );
}
