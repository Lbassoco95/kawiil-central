import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMoffinConsultsByClient } from "@/hooks/useMoffinConsultsByClient";
import {
  certConsultLine,
  lista69bHeadline,
  pickLatestMoffinByType,
} from "@/lib/moffinDisplay";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Download, Landmark, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const toneClass: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  muted: "bg-muted text-muted-foreground",
  bad: "bg-destructive/15 text-destructive",
};

interface Props {
  clientId: string;
  /** Título de la tarjeta (mismo contenido en cliente vs contabilidad) */
  title?: string;
  className?: string;
}

export function MoffinSatStatusSummary({
  clientId,
  title = "SAT (Moffin)",
  className,
}: Props) {
  const { data: rows = [], isLoading } = useMoffinConsultsByClient(clientId);
  const byType = pickLatestMoffinByType(rows);
  const r69 = lista69bHeadline(byType.get("lista_69b"));
  const constancia = certConsultLine(
    "Constancia de situación fiscal",
    byType.get("constancia_situacion_fiscal")
  );
  const opinion = certConsultLine(
    "Opinión de cumplimiento",
    byType.get("opinion_cumplimiento")
  );

  const openPdf = async (filePath: string | null | undefined) => {
    if (!filePath) return;
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(filePath, 3600);
    if (error || !data?.signedUrl) {
      toast.error("No se pudo abrir el PDF");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const fmtDate = (iso: string | undefined) =>
    iso
      ? format(new Date(iso), "dd MMM yyyy HH:mm", { locale: es })
      : "—";

  return (
    <section className={cn("rounded-xl border border-border/60 bg-card/40 p-5 shadow-sm", className)}>
      <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
        <Landmark className="h-3.5 w-3.5" />
        {title}
      </h2>
      {isLoading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
        </p>
      ) : (
        <ul className="space-y-3 text-[13px]">
          <li className="rounded-md border border-border/60 p-3 bg-background/40">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-muted-foreground text-xs font-medium">Lista 69-B</span>
              <Badge className={toneClass[r69.tone] ?? toneClass.muted}>{r69.title}</Badge>
            </div>
            {r69.detail ? (
              <p className="text-xs text-muted-foreground leading-snug">{r69.detail}</p>
            ) : null}
            {byType.get("lista_69b")?.created_at ? (
              <p className="text-[10px] text-muted-foreground mt-1">
                Última consulta: {fmtDate(byType.get("lista_69b")!.created_at)}
              </p>
            ) : null}
          </li>
          <li className="rounded-md border border-border/60 p-3 bg-background/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <span className="text-muted-foreground text-xs font-medium">Opinión</span>
                  <Badge
                    variant="outline"
                    className={toneClass[opinion.tone] ?? toneClass.muted}
                  >
                    {opinion.title}
                  </Badge>
                </div>
                {opinion.detail ? (
                  <p className="text-xs text-muted-foreground line-clamp-2">{opinion.detail}</p>
                ) : null}
                {byType.get("opinion_cumplimiento")?.created_at ? (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {fmtDate(byType.get("opinion_cumplimiento")!.created_at)}
                  </p>
                ) : null}
              </div>
              {opinion.hasFile &&
              byType.get("opinion_cumplimiento")?.documents?.file_path ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1 text-xs"
                  onClick={() =>
                    openPdf(byType.get("opinion_cumplimiento")!.documents!.file_path)
                  }
                >
                  <Download className="h-3.5 w-3.5" /> PDF
                </Button>
              ) : null}
            </div>
          </li>
          <li className="rounded-md border border-border/60 p-3 bg-background/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <span className="text-muted-foreground text-xs font-medium">Constancia</span>
                  <Badge
                    variant="outline"
                    className={toneClass[constancia.tone] ?? toneClass.muted}
                  >
                    {constancia.title}
                  </Badge>
                </div>
                {constancia.detail ? (
                  <p className="text-xs text-muted-foreground line-clamp-2">{constancia.detail}</p>
                ) : null}
                {byType.get("constancia_situacion_fiscal")?.created_at ? (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {fmtDate(byType.get("constancia_situacion_fiscal")!.created_at)}
                  </p>
                ) : null}
              </div>
              {constancia.hasFile &&
              byType.get("constancia_situacion_fiscal")?.documents?.file_path ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1 text-xs"
                  onClick={() =>
                    openPdf(byType.get("constancia_situacion_fiscal")!.documents!.file_path)
                  }
                >
                  <Download className="h-3.5 w-3.5" /> PDF
                </Button>
              ) : null}
            </div>
          </li>
        </ul>
      )}
    </section>
  );
}
