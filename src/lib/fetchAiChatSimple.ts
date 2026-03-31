import { supabase } from "@/integrations/supabase/client";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

const MSG_ANTHROPIC_BILLING_FALLBACK =
  "Los créditos del proveedor de IA (Anthropic/Claude) están agotados o son insuficientes. " +
  "Un administrador debe añadir créditos en https://console.anthropic.com (Plans & Billing) y comprobar el secreto ANTHROPIC_API_KEY en Supabase.";

export type AiChatSimpleMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * Modo simple + insightLite en ai-chat: una respuesta JSON, sin herramientas ni SSE.
 * Menos tokens y menos carga que el chat completo; reintenta ante 429.
 */
export async function fetchAiChatSimpleContent(
  messages: AiChatSimpleMessage[],
  options?: { retries?: number },
): Promise<string> {
  const maxAttempts = Math.max(1, (options?.retries ?? 2) + 1);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("No hay sesión");

    const resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        messages,
        simple: true,
        insightLite: true,
      }),
    });

    const ct = resp.headers.get("content-type") || "";

    if (resp.status === 429) {
      let msg = "Demasiadas solicitudes. Intenta de nuevo en unos segundos.";
      let retryAfterMs: number | undefined;
      try {
        const j = (await resp.json()) as {
          message?: string;
          error?: string;
          retry_after?: number;
        };
        msg = j.message || j.error || msg;
        if (typeof j.retry_after === "number") retryAfterMs = j.retry_after * 1000;
      } catch {
        /* ignore */
      }
      lastError = new Error(msg);
      if (attempt < maxAttempts - 1) {
        const wait = retryAfterMs ?? 2500 * (attempt + 1);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw lastError;
    }

    if (resp.status === 402) {
      const raw = await resp.text();
      let msg = MSG_ANTHROPIC_BILLING_FALLBACK;
      try {
        const j = JSON.parse(raw) as { message?: string; error?: string; code?: string };
        if (j.code === "anthropic_billing" || j.message || j.error) {
          msg = j.message || j.error || msg;
        }
      } catch {
        /* usar fallback */
      }
      throw new Error(msg);
    }

    if (!resp.ok) {
      let msg = `Error ${resp.status}`;
      try {
        const j = (await resp.json()) as {
          message?: string;
          error?: string;
          code?: string;
        };
        if (j.code === "anthropic_billing") {
          msg = j.message || j.error || MSG_ANTHROPIC_BILLING_FALLBACK;
        } else {
          msg = j.message || j.error || msg;
        }
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }

    if (!ct.includes("application/json")) {
      throw new Error("Respuesta inesperada del servidor.");
    }

    const data = (await resp.json()) as {
      content?: string;
      error?: string;
      message?: string;
    };
    if (data.error && !data.content) {
      throw new Error(data.message || data.error);
    }
    return (data.content || "").trim();
  }

  throw lastError ?? new Error("Error desconocido");
}
