import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Eye, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  filePath: string;
  fileName?: string | null;
  className?: string;
};

export function MoffinPdfActions({ filePath, fileName, className }: Props) {
  const [busy, setBusy] = useState<"preview" | "download" | null>(null);

  const getUrl = async () => {
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(filePath, 3600);
    if (error || !data?.signedUrl) {
      toast.error("No se pudo generar el enlace del PDF");
      return null;
    }
    return data.signedUrl;
  };

  const preview = async () => {
    setBusy("preview");
    try {
      const url = await getUrl();
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("download");
    try {
      const url = await getUrl();
      if (!url) return;
      const base =
        fileName?.replace(/\.[^/.]+$/, "").trim() || "documento-sat";
      const safeName = /\.pdf$/i.test(fileName ?? "") ? (fileName as string) : `${base}.pdf`;
      const a = document.createElement("a");
      a.href = url;
      a.download = safeName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[10px] gap-0.5"
        onClick={preview}
        disabled={!!busy}
        aria-label="Vista previa del PDF"
      >
        {busy === "preview" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Eye className="h-3 w-3" />
        )}
        Ver
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-[10px] gap-0.5"
        onClick={download}
        disabled={!!busy}
        aria-label="Descargar PDF"
      >
        {busy === "download" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        Descargar
      </Button>
    </div>
  );
}
