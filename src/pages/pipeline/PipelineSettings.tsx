import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ACTIVE_SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePipelineStages } from "@/hooks/usePipeline";
import { Input } from "@/components/ui/input";

const fnUrl = (name: string) =>
  `${ACTIVE_SUPABASE_URL}/functions/v1/${name}`;

export default function PipelineSettings() {
  const { data: stages = [] } = usePipelineStages();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const uploadCsv = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      toast.error("Elige un archivo CSV");
      return;
    }
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sesión requerida");
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(fnUrl("import-leads-csv"), {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      toast.success(
        `Importación: ${j.inserted ?? 0} nuevos, ${j.duplicates ?? 0} duplicados, ${j.errors?.length ?? 0} errores`,
      );
      fileRef.current!.value = "";
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al importar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook Meta (Lead Ads)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Configura esta URL en Meta for Developers → Webhooks → Page → leadgen. Despliega la función{" "}
            <code className="text-xs bg-muted px-1 rounded">meta-webhook-leads</code> con{" "}
            <code className="text-xs bg-muted px-1 rounded">--no-verify-jwt</code>.
          </p>
          <Input readOnly value={fnUrl("meta-webhook-leads")} className="font-mono text-xs" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar leads (CSV)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Columnas sugeridas: full_name, email, phone, company_name, campaign_name, meta_lead_id. Se deduplica por
            email o meta_lead_id.
          </p>
          <Input ref={fileRef} type="file" accept=".csv,text/csv" />
          <Button type="button" onClick={() => void uploadCsv()} disabled={busy}>
            {busy ? "Importando…" : "Subir CSV"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Etapas del pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-1">
            {stages.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                {s.name} <span className="text-muted-foreground">({s.slug})</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
