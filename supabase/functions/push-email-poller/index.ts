/**
 * push-email-poller: avisa de correos nuevos sin leer en las cuentas que cada usuario conectó.
 *
 * Fuentes:
 *  - `microsoft_tokens`  → bandeja de Microsoft 365 de cada usuario (Graph).
 *  - `linked_accounts`   → cuentas Google (Gmail) y Microsoft vinculadas con mail_enabled y status connected.
 * Por usuario agrupa todo en UNA notificación `email_new` (tabla notifications). El trigger
 * `trg_push_bridge_notification` la convierte en push vía push-from-notification.
 *
 * Marca de agua por cuenta en `email_push_state`. La primera vez que ve una cuenta solo guarda la marca
 * (no avisa de correos viejos). Solo lee metadatos (remitente/asunto); no modifica ni marca nada en los buzones.
 *
 * Autenticación: x-cron-secret == CRON_SECRET. Cron: `push-email-poller` cada 5 min.
 * Despliegue: `supabase functions deploy push-email-poller --no-verify-jwt`.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  agruparMensajes,
  armarAviso,
  desdeEfectivo,
  separarRepetidos,
  SILENCIO_REPETIDOS_MIN,
  type Mensaje,
} from "../_shared/emailPush.ts";
import { debeResumirConIA, MODELO_POR_DEFECTO, resumirConIA } from "../_shared/emailResumenIA.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MAX_POR_CUENTA = 10;
const CONCURRENCIA = 5;
const TIMEOUT_MS = 12_000;
/** Tope de llamadas a la IA por corrida (cada una espera como máximo unos segundos). El resto usa el resumen de siempre. */
const MAX_LLAMADAS_IA_POR_CORRIDA = 5;

type Svc = ReturnType<typeof createClient>;
type Cuenta =
  | { key: string; userId: string; kind: "ms_token"; row: { access_token: string; refresh_token: string; expires_at: string } }
  | {
    key: string;
    userId: string;
    kind: "linked";
    provider: "microsoft" | "google";
    row: { id: string; access_token: string | null; refresh_token: string | null; token_expires_at: string | null };
  };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function pool<T>(items: T[], limite: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try {
          await fn(item);
        } catch (e) {
          console.error("push-email-poller cuenta:", (e as Error).message);
        }
      }
    }),
  );
}

/* ---------- Tokens ---------- */

async function refrescarMicrosoft(refreshToken: string, tenant: string): Promise<{ access_token: string; refresh_token?: string; expires_in: number } | null> {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")?.trim();
  if (!clientId || !clientSecret) return null;
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return await res.json();
}

async function tokenMicrosoftUsuario(svc: Svc, userId: string, row: { access_token: string; refresh_token: string; expires_at: string }): Promise<string | null> {
  if (new Date(row.expires_at).getTime() - Date.now() > 5 * 60_000) return row.access_token;
  const tenant = Deno.env.get("MICROSOFT_TENANT_ID")?.trim();
  if (!tenant) return null;
  const data = await refrescarMicrosoft(row.refresh_token, tenant);
  if (!data) return null;
  await svc.from("microsoft_tokens").update({
    access_token: data.access_token,
    refresh_token: data.refresh_token || row.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  }).eq("user_id", userId);
  return data.access_token;
}

async function tokenCuentaVinculada(svc: Svc, c: Extract<Cuenta, { kind: "linked" }>): Promise<string | null> {
  const exp = c.row.token_expires_at ? new Date(c.row.token_expires_at).getTime() : 0;
  if (c.row.access_token && exp - 60_000 > Date.now()) return c.row.access_token;
  if (!c.row.refresh_token) return null;

  if (c.provider === "google") {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")?.trim();
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")?.trim();
    if (!clientId || !clientSecret) return null;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: c.row.refresh_token,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    // No tocamos linked_accounts.status: eso lo gestionan google-api/outlook-account-api.
    if (!res.ok || !data.access_token) return null;
    await svc.from("linked_accounts").update({
      access_token: data.access_token,
      token_expires_at: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    }).eq("id", c.row.id);
    return data.access_token;
  }

  const tenant = Deno.env.get("MICROSOFT_LINKED_TENANT_ID")?.trim() || "common";
  const data = await refrescarMicrosoft(c.row.refresh_token, tenant);
  if (!data) return null;
  await svc.from("linked_accounts").update({
    access_token: data.access_token,
    refresh_token: data.refresh_token || c.row.refresh_token,
    token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  }).eq("id", c.row.id);
  return data.access_token;
}

/* ---------- Lectura de correos nuevos (solo metadatos) ---------- */

async function nuevosMicrosoft(token: string, desdeIso: string): Promise<Mensaje[]> {
  const filtro = `receivedDateTime gt ${desdeIso} and isRead eq false`;
  const url = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages" +
    `?$filter=${encodeURIComponent(filtro)}` +
    `&$orderby=${encodeURIComponent("receivedDateTime desc")}` +
    `&$select=${encodeURIComponent("subject,from,receivedDateTime")}` +
    `&$top=${MAX_POR_CUENTA}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Graph ${res.status}`);
  const j = await res.json() as { value?: Array<{ subject?: string; receivedDateTime: string; from?: { emailAddress?: { name?: string; address?: string } } }> };
  return (j.value ?? []).map((m) => ({
    received: new Date(m.receivedDateTime).toISOString(),
    from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "Alguien",
    subject: (m.subject || "(sin asunto)").trim(),
  }));
}

async function nuevosGmail(token: string, desdeIso: string): Promise<Mensaje[]> {
  const desdeMs = new Date(desdeIso).getTime();
  const q = encodeURIComponent(`after:${Math.floor(desdeMs / 1000)}`);
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&labelIds=UNREAD&q=${q}&maxResults=${MAX_POR_CUENTA}`;
  const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Gmail ${res.status}`);
  const lista = await res.json() as { messages?: Array<{ id: string }> };
  const out: Mensaje[] = [];
  for (const { id } of lista.messages ?? []) {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!r.ok) continue;
    const m = await r.json() as { internalDate?: string; payload?: { headers?: Array<{ name: string; value: string }> } };
    const ms = Number(m.internalDate ?? 0);
    if (!ms || ms <= desdeMs) continue;
    const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    const from = h("from").replace(/<[^>]*>/g, "").replace(/"/g, "").trim() || h("from") || "Alguien";
    out.push({ received: new Date(ms).toISOString(), from, subject: h("subject").trim() || "(sin asunto)" });
  }
  return out;
}

/* ---------- Principal ---------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
      return json({ error: "No autorizado" }, 401);
    }

    const cuerpoReq = await req.json().catch(() => ({})) as { probar_ia?: boolean };
    if (cuerpoReq?.probar_ia === true) {
      // Prueba de la IA con datos de EJEMPLO (no lee buzones ni crea notificaciones): confirma clave, modelo y respuesta.
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      const modelo = Deno.env.get("KAWIIL_AI_FAST_MODEL")?.trim() || MODELO_POR_DEFECTO;
      const ahora = new Date().toISOString();
      const ejemplo = [
        { key: "a", from: "Railway", subject: "Build failed for ample-spontaneity", count: 3, latest: ahora },
        { key: "b", from: "Ana Pérez", subject: "Propuesta Q4 para revisión", count: 1, latest: ahora },
        { key: "c", from: "Banco", subject: "Estado de cuenta de noviembre", count: 1, latest: ahora },
      ];
      const t0 = Date.now();
      const frase = await resumirConIA(ejemplo, { apiKey, model: modelo });
      const resultado = { ok: true, probar_ia: true, claveConfigurada: !!apiKey, modelo, usoIA: frase !== null, frase, ms: Date.now() - t0 };
      console.log("push-email-poller probar_ia:", JSON.stringify(resultado));
      return json(resultado);
    }

    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const inicio = new Date();

    // Cuentas a revisar
    const cuentas: Cuenta[] = [];
    const { data: msTokens } = await svc.from("microsoft_tokens").select("user_id, access_token, refresh_token, expires_at");
    for (const t of msTokens ?? []) {
      cuentas.push({ key: `ms:${t.user_id}`, userId: t.user_id, kind: "ms_token", row: t });
    }
    const { data: linked } = await svc
      .from("linked_accounts")
      .select("id, user_id, provider, access_token, refresh_token, token_expires_at")
      .eq("mail_enabled", true)
      .eq("status", "connected")
      .in("provider", ["google", "microsoft"]);
    for (const a of linked ?? []) {
      cuentas.push({
        key: `la:${a.id}`,
        userId: a.user_id,
        kind: "linked",
        provider: a.provider as "microsoft" | "google",
        row: a,
      });
    }

    // Marcas de agua
    const { data: estados } = await svc
      .from("email_push_state")
      .select("account_key, last_checked_at")
      .in("account_key", cuentas.map((c) => c.key));
    const marca = new Map<string, string>((estados ?? []).map((e) => [e.account_key as string, e.last_checked_at as string]));

    const porUsuario = new Map<string, Mensaje[]>();
    const nuevasMarcas: Array<{ account_key: string; user_id: string; last_checked_at: string; updated_at: string }> = [];
    const resumen = { cuentas: cuentas.length, inicializadas: 0, sinToken: 0, errores: 0, usuariosAvisados: 0, silenciados: 0, resumidosIA: 0, iaSinResumen: 0 };

    await pool(cuentas, CONCURRENCIA, async (c) => {
      const desde = marca.get(c.key);
      if (!desde) {
        // Primera vez: solo guardamos la marca para no avisar de correos viejos.
        nuevasMarcas.push({ account_key: c.key, user_id: c.userId, last_checked_at: inicio.toISOString(), updated_at: inicio.toISOString() });
        resumen.inicializadas++;
        return;
      }

      const token = c.kind === "ms_token"
        ? await tokenMicrosoftUsuario(svc, c.userId, c.row)
        : await tokenCuentaVinculada(svc, c);
      if (!token) {
        resumen.sinToken++;
        return;
      }

      // Solo la última hora como máximo: tras una caída o un buzón dormido no se avisan correos viejos.
      const desdeIso = desdeEfectivo(desde, inicio.getTime());
      let mensajes: Mensaje[];
      try {
        mensajes = c.kind === "linked" && c.provider === "google"
          ? await nuevosGmail(token, desdeIso)
          : await nuevosMicrosoft(token, desdeIso);
      } catch (e) {
        resumen.errores++;
        console.warn("push-email-poller lectura:", c.key, (e as Error).message);
        return;
      }

      // Marca: el correo más reciente visto; si no hubo ninguno, un minuto antes de iniciar esta corrida.
      const maxRecibido = mensajes.reduce((a, m) => (m.received > a ? m.received : a), "");
      const nuevaMarca = maxRecibido || new Date(inicio.getTime() - 60_000).toISOString();
      // Nunca retroceder la marca.
      const marcaFinal = new Date(nuevaMarca).getTime() > new Date(desdeIso).getTime() ? nuevaMarca : desdeIso;
      nuevasMarcas.push({ account_key: c.key, user_id: c.userId, last_checked_at: marcaFinal, updated_at: inicio.toISOString() });

      if (mensajes.length) {
        porUsuario.set(c.userId, [...(porUsuario.get(c.userId) ?? []), ...mensajes]);
      }
    });

    if (nuevasMarcas.length) {
      const { error } = await svc.from("email_push_state").upsert(nuevasMarcas, { onConflict: "account_key" });
      if (error) console.error("push-email-poller upsert estado:", error.message);
    }

    // Una notificación agrupada por usuario, sin repetir lo que ya se avisó hace poco
    const userIds = [...porUsuario.keys()];
    if (userIds.length) {
      const { data: perfiles } = await svc.from("profiles").select("user_id, organization_id").in("user_id", userIds);
      const org = new Map((perfiles ?? []).map((p) => [p.user_id as string, p.organization_id as string]));

      // Qué remitente+asunto ya se avisó en los últimos SILENCIO_REPETIDOS_MIN minutos (filas `dg:<usuario>:<clave>`).
      const corte = new Date(inicio.getTime() - SILENCIO_REPETIDOS_MIN * 60_000).toISOString();
      const { data: avisadas } = await svc
        .from("email_push_state")
        .select("account_key, user_id")
        .like("account_key", "dg:%")
        .gte("last_checked_at", corte)
        .in("user_id", userIds);
      const yaAvisadasPorUsuario = new Map<string, Set<string>>();
      for (const r of avisadas ?? []) {
        const clave = String(r.account_key).split(":")[2];
        if (!clave) continue;
        const set = yaAvisadasPorUsuario.get(r.user_id as string) ?? new Set<string>();
        set.add(clave);
        yaAvisadasPorUsuario.set(r.user_id as string, set);
      }

      const filas = [];
      const huellas = [];
      let llamadasIA = 0;
      for (const [userId, lista] of porUsuario) {
        const organizationId = org.get(userId);
        if (!organizationId) continue;
        // Misma bandeja conectada por dos vías → no contar dos veces el mismo correo.
        const vistos = new Set<string>();
        const unicos = lista.filter((m) => {
          const k = `${m.received}|${m.from}|${m.subject}`;
          if (vistos.has(k)) return false;
          vistos.add(k);
          return true;
        });
        // Agrupa (p. ej. 6 avisos iguales de Railway = 1 grupo) y deja fuera lo ya avisado hace poco.
        const { nuevos } = separarRepetidos(agruparMensajes(unicos), yaAvisadasPorUsuario.get(userId) ?? new Set());
        if (nuevos.length === 0) {
          resumen.silenciados++;
          continue;
        }
        let aviso = armarAviso(nuevos);
        // Con varios temas distintos, la IA redacta una frase corta. Solo recibe REMITENTE y ASUNTO (nunca el cuerpo).
        // Si no hay clave, falla o se acaba el tiempo, se queda el resumen de siempre: la IA nunca frena un aviso.
        if (debeResumirConIA(nuevos) && llamadasIA < MAX_LLAMADAS_IA_POR_CORRIDA) {
          llamadasIA++;
          const frase = await resumirConIA(nuevos, {
            apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
            model: Deno.env.get("KAWIIL_AI_FAST_MODEL")?.trim() || MODELO_POR_DEFECTO,
          });
          if (frase) {
            aviso = { title: aviso.title, body: frase };
            resumen.resumidosIA++;
          } else {
            resumen.iaSinResumen++;
          }
        }
        filas.push({
          user_id: userId,
          organization_id: organizationId,
          type: "email_new",
          title: aviso.title,
          body: aviso.body,
          entity_type: "email",
          is_read: false,
        });
        for (const g of nuevos) {
          huellas.push({
            account_key: `dg:${userId}:${g.key}`,
            user_id: userId,
            last_checked_at: inicio.toISOString(),
            updated_at: inicio.toISOString(),
          });
        }
      }
      if (filas.length) {
        const { error } = await svc.from("notifications").insert(filas);
        if (error) {
          console.error("push-email-poller insert notifications:", error.message);
        } else {
          resumen.usuariosAvisados = filas.length;
          const { error: e2 } = await svc.from("email_push_state").upsert(huellas, { onConflict: "account_key" });
          if (e2) console.error("push-email-poller upsert huellas:", e2.message);
        }
      }
    }

    // Limpieza: huellas de avisos con más de 3 h ya no sirven.
    const { error: eLimpieza } = await svc
      .from("email_push_state")
      .delete()
      .like("account_key", "dg:%")
      .lt("last_checked_at", new Date(inicio.getTime() - 3 * 3_600_000).toISOString());
    if (eLimpieza) console.warn("push-email-poller limpieza:", eLimpieza.message);

    return json({ ok: true, ...resumen });
  } catch (e) {
    console.error("push-email-poller:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
