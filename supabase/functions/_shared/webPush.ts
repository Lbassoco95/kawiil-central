type SendWebPushArgs = {
  userIds: string[];
  title: string;
  body: string;
  url: string;
  tag?: string;
  force?: boolean;
};

let webpushClient: {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ) => Promise<unknown>;
} | null = null;

async function getWebPushClient() {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return null;
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
) {
  const client = await getWebPushClient();
  if (!client) return;

  const uniqueUserIds = [...new Set(args.userIds.filter((uid) => typeof uid === "string" && uid.trim()))];
  if (uniqueUserIds.length === 0) return;

  for (const uid of uniqueUserIds) {
    if (!args.force) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("desktop_push_notifications")
        .eq("user_id", uid)
        .maybeSingle();
      if (prof?.desktop_push_notifications !== true) continue;
    }

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", uid);

    for (const sub of subs || []) {
      try {
        await client.sendNotification(
          {
            endpoint: sub.endpoint as string,
            keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
          },
          JSON.stringify({
            title: args.title,
            body: args.body,
            url: args.url,
            tag: args.tag || `kawiil-${Date.now()}`,
          }),
        );
      } catch (e: unknown) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
        console.error("webpush delivery error:", code);
      }
    }
  }
}
