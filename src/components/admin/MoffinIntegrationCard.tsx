import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { invokeFunctionWithSession } from "@/lib/supabaseInvoke";
import { Loader2, Landmark, ExternalLink } from "lucide-react";

type HealthPayload = {
  ok?: boolean;
  missing?: string[];
  baseUrlHost?: string | null;
  looksLikeSandbox?: boolean;
  hint?: string;
  error?: string;
  message?: string;
};

export function MoffinIntegrationCard() {
  const { session } = useAuth();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["moffin-health"],
    queryFn: async () => {
      const { data: res, error: fnErr } = await invokeFunctionWithSession("moffin-health", {});
      if (fnErr) throw new Error(fnErr.message);
      return res as HealthPayload;
    },
    enabled: !!session?.access_token,
    staleTime: 60_000,
  });

  const webhookUrl = import.meta.env.VITE_SUPABASE_URL
    ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, "")}/functions/v1/moffin-webhook`
    : "";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          Integración Moffin (SAT)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Las API keys y el secreto Svix viven solo en{" "}
          <strong className="text-foreground font-medium">Supabase → Edge Functions → Secrets</strong> (una vez por
          entorno). La app no las almacena ni las vuelve a pedir.
        </p>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            Comprobando secretos en el servidor…
          </div>
        ) : error ? (
          <p className="text-xs text-destructive">{(error as Error).message}</p>
        ) : data?.error === "Forbidden" ? (
          <p className="text-xs text-muted-foreground">{data.message}</p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium">Estado</span>
              {data?.ok ? (
                <Badge className="text-[10px]">Secretos configurados</Badge>
              ) : (
                <Badge variant="destructive" className="text-[10px]">
                  Faltan secretos
                </Badge>
              )}
              {data?.looksLikeSandbox ? (
                <Badge variant="secondary" className="text-[10px]">
                  Base URL parece sandbox
                </Badge>
              ) : null}
              <button
                type="button"
                onClick={() => refetch()}
                className="text-[10px] text-primary underline-offset-2 hover:underline disabled:opacity-50"
                disabled={isFetching}
              >
                {isFetching ? "Actualizando…" : "Volver a comprobar"}
              </button>
            </div>
            {data?.baseUrlHost ? (
              <p className="text-[11px] text-muted-foreground">
                Host API Moffin: <code className="text-foreground">{data.baseUrlHost}</code>
              </p>
            ) : null}
            {data?.missing && data.missing.length > 0 ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                Faltan: {data.missing.join(", ")}. {data.hint}
              </p>
            ) : data?.hint ? (
              <p className="text-[11px] text-muted-foreground">{data.hint}</p>
            ) : null}
          </div>
        )}

        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">Moffin Solutions API (CSF y 32D)</p>
          <p>
            En Edge Functions define <code className="text-foreground">MOFFIN_API_FLAVOR=solutions</code>,{" "}
            <code className="text-foreground">MOFFIN_SOLUTIONS_BASE_URL=https://solutions-api.moffin.mx/api</code> y el token
            en <code className="text-foreground">MOFFIN_API_KEY</code> (o <code className="text-foreground">MOFFIN_SOLUTIONS_BEARER</code>) como{" "}
            <code className="text-foreground">Authorization: Bearer</code>. Las consultas crean perfil SAT con RFC+CIEC (
            <code className="text-foreground">moffin-sat-ciec</code>
            ); opcional <code className="text-foreground">MOFFIN_SAT_CIEC_SECRET</code> o reutiliza{" "}
            <code className="text-foreground">MOFFIN_FIEL_SECRET</code> para cifrar la CIEC. Lista 69-B usa{" "}
            <code className="text-foreground">MOFFIN_LEGACY_BASE_URL</code> + <code className="text-foreground">Token</code>.
          </p>
          <p>
            Documentación:{" "}
            <a
              href="https://solutions-docs.moffin.mx/apis/consultas-al-sat"
              className="text-primary underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Consultas al SAT (Moffin)
            </a>
            . En el front: <code className="text-foreground">VITE_MOFFIN_API_FLAVOR=solutions</code>.
          </p>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">FIEL (modo legacy)</p>
          <p>
            Con <code className="text-foreground">MOFFIN_API_FLAVOR=legacy</code> (o sin definir), constancia/opinión usan{" "}
            <code className="text-foreground">/query/sat_rfc</code> con <code className="text-foreground">MOFFIN_FIEL_SECRET</code>{" "}
            y archivos <code className="text-foreground">.cer</code> / <code className="text-foreground">.key</code>. Campos opcionales:{" "}
            <code className="text-foreground">MOFFIN_FIEL_FIELD_*</code>, <code className="text-foreground">MOFFIN_QUERY_EXTRA_BODY_*</code>,{" "}
            <code className="text-foreground">MOFFIN_SAT_RFC_EXTRA_PDF_FIELD_NAMES</code>.
          </p>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">Prueba en sandbox</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              Cliente con RFC de ejemplo Moffin: <code className="text-foreground">PRPU800101111</code> (persona
              física).
            </li>
            <li>Proyecto con área contabilidad vinculado a ese cliente.</li>
            <li>
              Tab <strong className="text-foreground">Contabilidad</strong>: con Solutions, guarda CIEC y ejecuta CSF/32D;
              en legacy, carga FIEL (.cer/.key) y contraseña por consulta.
            </li>
            <li>
              Webhook Svix debe apuntar a <code className="break-all text-foreground">{webhookUrl || "…/moffin-webhook"}</code>
            </li>
          </ul>
        </div>

        <a
          href="https://moffin.mx/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Documentación Moffin <ExternalLink className="h-3 w-3" />
        </a>
      </CardContent>
    </Card>
  );
}
