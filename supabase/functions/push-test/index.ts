/**
 * push-test: envía una notificación Web Push de prueba al usuario autenticado.
 * Sirve para diagnosticar si el pipeline (VAPID + push_subscriptions + SW) funciona,
 * cuando el usuario reporta "no me llega el banner". Requiere JWT (gateway).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWebPushToUsers } from "../_shared/webPush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { count: subsCount } = await serviceClient
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidConfigured = !!(vapidPublic && vapidPrivate);

    if (!vapidConfigured) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: "vapid_not_configured",
          subsCount: subsCount ?? 0,
          message: "Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en Edge Function Secrets.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!subsCount || subsCount === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: "no_subscriptions",
          subsCount: 0,
          message:
            "No hay push_subscriptions para tu usuario. Usa «Registrar push (app cerrada)» en este navegador.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const customTitle = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "Kawiil · Push de prueba";
    const customBody = typeof body.body === "string" && body.body.trim()
      ? body.body.trim()
      : "Si ves este aviso fuera de la pestaña, el pipeline funciona.";

    await sendWebPushToUsers(serviceClient, {
      userIds: [user.id],
      title: customTitle,
      body: customBody,
      url: "/notificaciones",
      tag: `push-test-${Date.now()}`,
      force: true,
      requireInteraction: true,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        subsCount,
        message: `Push enviado a ${subsCount} suscripción(es). Revisa el banner del sistema.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("push-test:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
