type SendWebPushArgs = {
  userIds: string[];
  title: string;
  body: string;
  url: string;
  tag?: string;
  force?: boolean;
  /** Si true, el banner del SO permanece hasta que el usuario lo atienda (DMs, menciones). */
  requireInteraction?: boolean;
};

export type WebPushDeliveryReport = {
  userId: string;
  subId: string;
  endpointPrefix: string;
  userAgent?: string | null;
  /** 200/201 si entregó, 404/410 si stale (se borra), otros códigos si error. */
  statusCode: number | null;
  status: "ok" | "stale_removed" | "error" | "skipped_no_subs" | "skipped_toggle_off";
  errorMessage?: string;
};

let webpushClient: {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ) => Promise<unknown>;
} | null = null;

let vapidMissingLogged = false;

async function getWebPushClient() {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) {
    if (!vapidMissingLogged) {
      console.warn(
        "[webpush] Deshabilitado: faltan VAPID_PUBLIC_KEY y/o VAPID_PRIVATE_KEY en Edge Function Secrets. No se enviará ninguna push.",
      );
      vapidMissingLogged = true;
    }
    return null;
  }
  if (!webpushClient) {
    const imported = await import("npm:web-push@3.6.6");
    webpushClient = imported.default;
    const contact = Deno.env.get("VAPID_CONTACT_EMAIL") || "mailto:hello@kawiil.com";
    webpushClient.setVapidDetails(contact, publicKey, privateKey);
  }
  return webpushClient;
}

export async function sendWebPushToUsers(
  supabase: {
    from: (table: string) => {
      select: (columns: string) => any;
      delete: () => any;
    };
  },
  args: SendWebPushArgs,
): Promise<WebPushDeliveryReport[]> {
  const report: WebPushDeliveryReport[] = [];
  const client = await getWebPushClient();
  if (!client) return report;

  const uniqueUserIds = [...new Set(args.userIds.filter((uid) => typeof uid === "string" && uid.trim()))];
  if (uniqueUserIds.length === 0) return report;

  for (const uid of uniqueUserIds) {
    if (!args.force) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("desktop_push_notifications")
        .eq("user_id", uid)
        .maybeSingle();
      if (prof?.desktop_push_notifications !== true) {
        console.log("[webpush] saltado (toggle desktop_push_notifications off)", { uid });
        report.push({ userId: uid, subId: "", endpointPrefix: "", statusCode: null, status: "skipped_toggle_off" });
        continue;
      }
    }

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, user_agent")
      .eq("user_id", uid);

    if (!subs || subs.length === 0) {
      console.warn("[webpush] sin suscripciones activas para user", { uid, tag: args.tag });
      report.push({ userId: uid, subId: "", endpointPrefix: "", statusCode: null, status: "skipped_no_subs" });
      continue;
    }

    for (const sub of subs) {
      const endpoint = sub.endpoint as string;
      const endpointPrefix = typeof endpoint === "string" ? endpoint.slice(0, 70) : "";
      try {
        const resp = (await client.sendNotification(
          {
            endpoint,
            keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
          },
          JSON.stringify({
            title: args.title,
            body: args.body,
            url: args.url,
            tag: args.tag || `kawiil-${Date.now()}`,
            requireInteraction: args.requireInteraction === true,
          }),
        )) as { statusCode?: number } | undefined;
        report.push({
          userId: uid,
          subId: sub.id as string,
          endpointPrefix,
          userAgent: (sub as { user_agent?: string | null }).user_agent ?? null,
          statusCode: resp?.statusCode ?? 201,
          status: "ok",
        });
      } catch (e: unknown) {
        const code = (e as { statusCode?: number })?.statusCode ?? null;
        const msg = (e as Error)?.message;
        if (code === 404 || code === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          console.warn("[webpush] suscripción stale eliminada", { uid, subId: sub.id, code });
          report.push({
            userId: uid,
            subId: sub.id as string,
            endpointPrefix,
            userAgent: (sub as { user_agent?: string | null }).user_agent ?? null,
            statusCode: code,
            status: "stale_removed",
          });
        } else {
          console.error("[webpush] error de entrega", { uid, subId: sub.id, code, msg });
          report.push({
            userId: uid,
            subId: sub.id as string,
            endpointPrefix,
            userAgent: (sub as { user_agent?: string | null }).user_agent ?? null,
            statusCode: code,
            status: "error",
            errorMessage: msg,
          });
        }
      }
    }
  }
  return report;
}
