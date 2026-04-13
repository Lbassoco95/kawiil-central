import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { invokeFunctionWithSession } from "@/lib/supabaseInvoke";
import { Loader2, Landmark, ExternalLink, ListChecks } from "lucide-react";

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
            Por defecto Kawiil usa <strong className="text-foreground">Solutions</strong> en Edge (constancia/opinión). La
            API en <code className="text-foreground">solutions-api.moffin.mx</code> usa{" "}
            <strong className="text-foreground">OAuth</strong>{" "}
            <code className="text-foreground">POST /oauth/token</code> con{" "}
            <code className="text-foreground">MOFFIN_SOLUTIONS_CLIENT_ID</code> y{" "}
            <code className="text-foreground">MOFFIN_SOLUTIONS_CLIENT_SECRET</code> (credenciales que entrega Moffin para
            Solutions; no son el token corto de «Configuración → API» de app.moffin). Alternativa:{" "}
            <code className="text-foreground">MOFFIN_SOLUTIONS_BEARER</code> con el JWT devuelto por ese OAuth. Solo con{" "}
            <code className="text-foreground">MOFFIN_API_FLAVOR=legacy</code> vuelve el modo FIEL + <code className="text-foreground">sat_rfc</code>. Perfil SAT con RFC+CIEC (
            <code className="text-foreground">moffin-sat-ciec</code>
            ); opcional <code className="text-foreground">MOFFIN_SAT_CIEC_SECRET</code> o reutiliza{" "}
            <code className="text-foreground">MOFFIN_FIEL_SECRET</code> para cifrar la CIEC. Lista 69-B usa{" "}
            <code className="text-foreground">MOFFIN_LEGACY_BASE_URL</code> + <code className="text-foreground">Token</code> (
            <code className="text-foreground">MOFFIN_LEGACY_API_KEY</code> o <code className="text-foreground">MOFFIN_API_KEY</code>).
          </p>
          <p>
            Documentación:{" "}
            <a
              href="https://solutions-docs.moffin.mx/apis/authentication"
              className="text-primary underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Authentication (OAuth)
            </a>
            ,{" "}
            <a
              href="https://solutions-docs.moffin.mx/apis/consultas-al-sat"
              className="text-primary underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Consultas al SAT
            </a>
            . En el front, Solutions es el predeterminado; FIEL solo con{" "}
            <code className="text-foreground">VITE_MOFFIN_API_FLAVOR=legacy</code> en el build.
          </p>
          <div className="pt-1 border-t border-border/50 space-y-1.5">
            <p className="font-medium text-foreground flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5 shrink-0" />
              Flujo API (orden obligatorio)
            </p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>
                <a
                  href="https://solutions-docs.moffin.mx/apis/consultas-al-sat/createprofilesat"
                  className="text-primary underline-offset-2 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Creación de perfil SAT
                </a>{" "}
                — <code className="text-foreground">POST /query/sat/profile</code> (RFC + CIEC).
              </li>
              <li>
                <a
                  href="https://solutions-docs.moffin.mx/apis/consultas-al-sat/requestprofilecsf"
                  className="text-primary underline-offset-2 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Constancia (CSF)
                </a>{" "}
                — <code className="text-foreground">POST /query/sat/csf</code> (solo RFC).
              </li>
              <li>
                <a
                  href="https://solutions-docs.moffin.mx/apis/consultas-al-sat/requestprofile32d"
                  className="text-primary underline-offset-2 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Opinión 32D
                </a>{" "}
                — <code className="text-foreground">POST /query/sat/compliance-opinion</code>; resultado puede llegar por
                webhook.
              </li>
            </ol>
          </div>
          <div className="pt-1 border-t border-border/50 space-y-1">
            <p className="font-medium text-foreground">Checklist secretos (Solutions)</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                No fijar <code className="text-foreground">MOFFIN_API_FLAVOR=legacy</code> (defecto = Solutions)
              </li>
              <li>
                <code className="text-foreground">MOFFIN_SOLUTIONS_BASE_URL</code> (opcional; hay default)
              </li>
              <li>
                <code className="text-foreground">MOFFIN_SOLUTIONS_CLIENT_ID</code> +{" "}
                <code className="text-foreground">MOFFIN_SOLUTIONS_CLIENT_SECRET</code> (OAuth; recomendado)
              </li>
              <li>
                O <code className="text-foreground">MOFFIN_SOLUTIONS_BEARER</code> = JWT de <code className="text-foreground">/oauth/token</code>
              </li>
              <li>
                <code className="text-foreground">MOFFIN_API_KEY</code> / <code className="text-foreground">MOFFIN_LEGACY_API_KEY</code> para lista 69-B (Token legacy)
              </li>
              <li>
                <code className="text-foreground">MOFFIN_LEGACY_BASE_URL</code> + token legacy para lista 69-B
              </li>
              <li>
                <code className="text-foreground">MOFFIN_SAT_CIEC_SECRET</code> o <code className="text-foreground">MOFFIN_FIEL_SECRET</code> (≥32) para CIEC cifrada
              </li>
              <li>
                <code className="text-foreground">MOFFIN_SVIX_SIGNING_SECRET</code> para <code className="text-foreground">moffin-webhook</code>
              </li>
            </ul>
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">FIEL (modo legacy)</p>
          <p>
            Con <code className="text-foreground">MOFFIN_API_FLAVOR=legacy</code> (y en el front{" "}
            <code className="text-foreground">VITE_MOFFIN_API_FLAVOR=legacy</code>), constancia/opinión usan{" "}
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
