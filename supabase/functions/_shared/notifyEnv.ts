/**
 * Carga la configuración de canales de `notify` desde las variables de entorno
 * (secrets de Supabase). Vive aparte de _shared/notify.ts porque usa `Deno.env`
 * y notify.ts debe permanecer libre de Deno para poder testearse con vitest.
 *
 * Reutiliza los MISMOS secrets que ya usan las Edge Functions del repo:
 *   - Slack:    SLACK_BOT_TOKEN, SLACK_CHANNEL_ID
 *   - Email:    AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET (o MICROSOFT_*), SENDER_EMAIL
 *   - WhatsApp: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (opcional; stub si faltan)
 */
import type { NotifyConfig } from "./notify.ts";

const env = (k: string): string | undefined => {
  const v = Deno.env.get(k);
  return v && v.trim() ? v.trim() : undefined;
};

export function loadNotifyConfigFromEnv(): NotifyConfig {
  return {
    slackBotToken: env("SLACK_BOT_TOKEN"),
    slackDefaultChannel: env("SLACK_CHANNEL_ID"),
    graph: {
      tenant: env("AZURE_TENANT_ID") || env("MICROSOFT_TENANT_ID"),
      clientId: env("AZURE_CLIENT_ID") || env("MICROSOFT_CLIENT_ID"),
      clientSecret: env("AZURE_CLIENT_SECRET") || env("MICROSOFT_CLIENT_SECRET"),
      sender: env("SENDER_EMAIL") || "comercial@kawiil.mx",
    },
    whatsapp: {
      token: env("WHATSAPP_TOKEN"),
      phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"),
      apiVersion: env("WHATSAPP_API_VERSION") || "v21.0",
    },
  };
}
