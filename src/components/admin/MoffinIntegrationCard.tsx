import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { ACTIVE_SUPABASE_URL } from "@/integrations/supabase/client";
import {
  functionInvokeUserMessageAsync,
  invokeFunctionWithSession,
} from "@/lib/supabaseInvoke";
import { Loader2, Landmark, ExternalLink, ListChecks } from "lucide-react";

type HealthPayload = {
  ok?: boolean;
  apiFlavor?: "solutions" | "legacy";
  missing?: string[];
  warnings?: string[];
  ciecEncryptionOk?: boolean;
  legacyApiKeyConfigured?: boolean;
  solutionsAuthConfigured?: boolean | null;
  satgoConfigured?: boolean;
  satgoCsfActive?: boolean;
  satgoBaseHost?: string | null;
  baseUrlHost?: string | null;
  solutionsBaseHost?: string | null;
  looksLikeSandbox?: boolean;
  /** Desde Edge: misma base que SUPABASE_URL + /functions/v1/moffin-webhook */
  moffinWebhookFullUrl?: string | null;
  svixSigningSecretPresent?: boolean;
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
      if (fnErr) {
        throw new Error(await functionInvokeUserMessageAsync(res, fnErr));
      }
      return res as HealthPayload;
    },
    enabled: !!session?.access_token,
    staleTime: 60_000,
  });

  const webhookUrl = `${ACTIVE_SUPABASE_URL.replace(/\/$/, "")}/functions/v1/moffin-webhook`;
  const supabaseProjectRef = (() => {
    try {
      const h = new URL(ACTIVE_SUPABASE_URL).hostname;
      return h.split(".")[0] || "";
    } catch {
      return "";
    }
  })();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          Integración SAT (SATgo + Moffin)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          CSF y 32D van por{" "}
          <strong className="text-foreground font-medium">SATgo</strong> (
          <code className="text-foreground">SATGO_API_KEY</code>). Lista 69-B / CFDI pueden seguir en Moffin. Las API
          keys viven solo en{" "}
          <strong className="text-foreground font-medium">Supabase → Edge Functions → Secrets</strong>. La app no
          almacena secretos.
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
              {data?.apiFlavor ? (
                <Badge variant="outline" className="text-[10px]">
                  Modo Edge: {data.apiFlavor}
                </Badge>
              ) : null}
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
            {data?.satgoBaseHost || data?.satgoConfigured != null ? (
              <p className="text-[11px] text-muted-foreground">
                SATgo CSF/32D:{" "}
                <code className="text-foreground">{data.satgoBaseHost ?? "api.sat-go.com"}</code>
                {data.satgoCsfActive ? " · activo" : data.satgoConfigured ? " · key presente" : " · no configurado"}
              </p>
            ) : null}
            {data?.solutionsBaseHost ? (
              <p className="text-[11px] text-muted-foreground">
                Host Solutions API (legacy CSF): <code className="text-foreground">{data.solutionsBaseHost}</code>
              </p>
            ) : null}
            {data?.baseUrlHost ? (
              <p className="text-[11px] text-muted-foreground">
                Host API legacy: <code className="text-foreground">{data.baseUrlHost}</code>
              </p>
            ) : null}
            {data?.warnings && data.warnings.length > 0 ? (
              <ul className="text-[11px] text-amber-700 dark:text-amber-400 list-disc pl-4 space-y-0.5">
                {data.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            {data?.missing && data.missing.length > 0 ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                Faltan: {data.missing.join(", ")}. {data.hint}
              </p>
            ) : data?.hint ? (
              <p className="text-[11px] text-muted-foreground">{data.hint}</p>
            ) : null}
            {typeof data?.svixSigningSecretPresent === "boolean" ? (
              <p className="text-[11px] text-muted-foreground">
                Webhook: <code className="text-foreground">MOFFIN_SVIX_SIGNING_SECRET</code> en Edge{" "}
                <strong className="text-foreground font-medium">
                  {data.svixSigningSecretPresent ? "configurado" : "no configurado (ok para Solutions si sólo hay POST directo)"}
                </strong>
                . La URL del endpoint debe coincidir con la que configuró Moffin (misma instancia Supabase).
              </p>
            ) : null}
            {data?.moffinWebhookFullUrl ? (
              <p className="text-[10px] text-muted-foreground break-all">
                Endpoint Kawiil: <code className="text-foreground">{data.moffinWebhookFullUrl}</code>
              </p>
            ) : null}
          </div>
        )}

        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">SATgo (CSF y 32D) + Moffin (69-B)</p>
          <p>
            CSF/32D: <code className="text-foreground">SATGO_API_KEY</code> (Createkey en web.sat-go.com) → JWT vía{" "}
            <code className="text-foreground">/api/Auth/token-json</code> →{" "}
            <code className="text-foreground">GET /api/v2/Consultar/csf</code> u{" "}
            <code className="text-foreground">/oc</code> con headers RFC + Secret (CIEC). PDF síncrono. Opt-out:{" "}
            <code className="text-foreground">SAT_CSF_PROVIDER=moffin</code>. Cifrado CIEC:{" "}
            <code className="text-foreground">MOFFIN_SAT_CIEC_SECRET</code> o{" "}
            <code className="text-foreground">MOFFIN_FIEL_SECRET</code>. Lista 69-B:{" "}
            <code className="text-foreground">MOFFIN_API_KEY</code>.
          </p>
          <p>
            Docs SATgo:{" "}
            <a
              href="https://api.sat-go.com/scalar/v2"
              className="text-primary underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Scalar V2
            </a>
            . Moffin Solutions (solo si vuelves CSF a Moffin):{" "}
            <a
              href="https://solutions-docs.moffin.mx/apis/consultas-al-sat"
              className="text-primary underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Consultas al SAT
            </a>
            .
          </p>
          <div className="pt-1 border-t border-border/50 space-y-1.5">
            <p className="font-medium text-foreground flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5 shrink-0" />
              Flujo SATgo CSF/32D
            </p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>
                Guardar CIEC del cliente (<code className="text-foreground">moffin-sat-ciec</code>).
              </li>
              <li>
                Constancia — <code className="text-foreground">GET /api/v2/Consultar/csf</code> (RFC + Secret).
              </li>
              <li>
                Opinión 32D — <code className="text-foreground">GET /api/v2/Consultar/oc</code> (RFC + Secret).
              </li>
            </ol>
          </div>
          <div className="pt-1 border-t border-border/50 space-y-1">
            <p className="font-medium text-foreground">Checklist secretos (SATgo CSF/32D)</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                <code className="text-foreground">SATGO_API_KEY</code> (recomendado; Createkey) o{" "}
                <code className="text-foreground">SATGO_ACCESS_TOKEN</code>
              </li>
              <li>
                Opcional: <code className="text-foreground">SATGO_BASE_URL</code> (default{" "}
                <code className="text-foreground">https://api.sat-go.com</code>)
              </li>
              <li>
                Opt-out Moffin: <code className="text-foreground">SAT_CSF_PROVIDER=moffin</code>
              </li>
              <li>
                <code className="text-foreground">MOFFIN_SAT_CIEC_SECRET</code> o{" "}
                <code className="text-foreground">MOFFIN_FIEL_SECRET</code> (≥32) para CIEC cifrada
              </li>
              <li>
                <code className="text-foreground">MOFFIN_API_KEY</code> para lista 69-B (si la usáis)
              </li>
            </ul>
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">FIEL (modo legacy Moffin)</p>
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
          <p className="font-medium text-foreground">Si al sincronizar sigue “en cola” (pendiente / sin PDF)</p>
          <p>
            Kawiil deja el estado en <strong className="text-foreground">pendiente</strong> mientras la respuesta de
            Moffin indique cola o mensajes meta (p. ej. “Service query fetched successfully”). No es fallo de
            sincronización: la API aún no entrega el cuerpo final. Cuando llegue resultado completo, pasa a éxito (y el
            PDF si tu plan lo incluye).
          </p>
          <ol className="list-decimal pl-4 space-y-1.5">
            <li>
              <strong className="text-foreground">Admin</strong> (esta tarjeta): la URL del webhook debe coincidir con la
              de Moffin/Solutions (<code className="text-foreground">…/functions/v1/moffin-webhook</code>).{" "}
              <code className="text-foreground">MOFFIN_SVIX_SIGNING_SECRET</code> sólo hace falta si el proveedor envía
              Svix (<code className="text-foreground">svix-id</code>, etc.)
              {supabaseProjectRef ? (
                <>
                  {" "}
                  (ref Supabase del front: <code className="text-foreground">{supabaseProjectRef}</code>)
                </>
              ) : null}
              .
            </li>
            <li>
              En <strong className="text-foreground">Supabase → Edge Functions → Logs</strong>, busca{" "}
              <code className="text-foreground">delivery=solutions_direct</code> en CSF/32D; si ves{" "}
              <code className="text-foreground">sin fila moffin_consults coincidente</code>, el POST llegó pero el{" "}
              <code className="text-foreground">moffin_query_id</code> o el <code className="text-foreground">externalId</code>{" "}
              no coincide con la fila (revisa con Moffin el payload).
            </li>
            <li>
              Si ves <code className="text-foreground">verificación Svix falló</code>, llegó un POST con cabeceras{" "}
              <code className="text-foreground">svix-*</code> y el <code className="text-foreground">whsec_…</code> en
              Secrets no coincide con ese flujo firmado.
            </li>
            <li>
              En <strong className="text-foreground">SQL Editor</strong>, revisa filas atascadas (quizá consultas viejas
              duplicadas):
            </li>
          </ol>
          <pre className="text-[10px] leading-snug bg-background/80 border border-border/60 rounded p-2 overflow-x-auto text-foreground/90 whitespace-pre-wrap">
            {`select id, consult_type, status, moffin_query_id, moffin_service,
       created_at, left(coalesce(summary,''), 80) as summary_preview
from public.moffin_consults
where status = 'pending'
   or (status = 'success' and document_id is null)
order by created_at desc
limit 25;`}
          </pre>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">Prueba funcional (constancia / opinión)</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              Desplegar en el mismo proyecto Supabase: <code className="text-foreground">moffin-query</code>,{" "}
              <code className="text-foreground">moffin-sat-ciec</code> y <code className="text-foreground">moffin-webhook</code>{" "}
              (esta última siempre con <code className="text-foreground">--no-verify-jwt</code>).
            </li>
            <li>
              Aplicar migraciones de <code className="text-foreground">moffin_client_sat_ciec</code> (SQL Editor o{" "}
              <code className="text-foreground">supabase db push</code>).
            </li>
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
              La URL del webhook debe estar registrada en Moffin (<code className="break-all text-foreground">{webhookUrl || "…/moffin-webhook"}</code>
              ): POST JSON corporativo Solutions, sin Svix obligatorio para CSF/32D.
            </li>
            <li>
              Si el estado queda pendiente: botón «Sincronizar con Moffin» en Contabilidad y revisar logs de{" "}
              <code className="text-foreground">moffin-webhook</code> en Supabase.
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
