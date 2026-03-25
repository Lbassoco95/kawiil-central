import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Copy, X } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

const QUICK_PROMPTS = [
  { label: "Respuesta profesional", prompt: "Redacta una respuesta profesional y cordial a este correo." },
  { label: "Resumir hilo", prompt: "Resume los puntos clave de este correo en viñetas." },
  { label: "Traducir al inglés", prompt: "Traduce este correo al inglés manteniendo el tono profesional." },
];

interface Props {
  emailSubject: string;
  emailBody: string;
  senderName?: string;
  onInsertText?: (text: string) => void;
  onClose: () => void;
}

export function EmailAIAssistant({ emailSubject, emailBody, senderName, onInsertText, onClose }: Props) {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);

  const sendPrompt = async (text: string) => {
    if (!text.trim() || loading) return;
    setLoading(true);
    setResponse("");

    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No session");

      const context = `Asunto: ${emailSubject}\nDe: ${senderName || "Desconocido"}\n\nContenido del correo:\n${stripHtml(emailBody).substring(0, 3000)}`;

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          messages: [
            { role: "user", content: `Contexto del correo:\n${context}\n\nInstrucción: ${text}` },
          ],
          systemPrompt: "Eres un asistente de correo electrónico profesional. Ayudas a redactar respuestas, resumir hilos y traducir correos. Responde de forma concisa y profesional en el idioma que te pidan.",
        }),
      });

      if (!resp.ok) throw new Error(`Error ${resp.status}`);

      if (resp.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = resp.body?.getReader();
        const decoder = new TextDecoder();
        let full = "";
        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.text) {
                  full += parsed.text;
                  setResponse(full);
                }
              } catch {}
            }
          }
        }
      } else {
        const data = await resp.json();
        setResponse(data.reply || data.text || JSON.stringify(data));
      }
    } catch (err) {
      console.error("AI assistant error:", err);
      toast.error("Error al consultar el asistente");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(response);
    toast.success("Copiado al portapapeles");
  };

  const handleInsert = () => {
    if (onInsertText && response) {
      onInsertText(response);
      toast.success("Texto insertado en la respuesta");
    }
  };

  return (
    <div className="border border-border rounded-lg p-3 bg-muted/30 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          Asistente Kawiil AI
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_PROMPTS.map((qp) => (
          <Button
            key={qp.label}
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => { setPrompt(qp.prompt); sendPrompt(qp.prompt); }}
            disabled={loading}
          >
            {qp.label}
          </Button>
        ))}
      </div>

      <div className="flex gap-2">
        <Textarea
          placeholder="Escribe una instrucción personalizada..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          className="text-xs"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendPrompt(prompt); } }}
        />
        <Button size="sm" onClick={() => sendPrompt(prompt)} disabled={loading || !prompt.trim()} className="shrink-0">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {(response || loading) && (
        <div className="border border-border rounded-md p-3 bg-background">
          {loading && !response && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generando...
            </div>
          )}
          {response && (
            <>
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <ReactMarkdown>{response}</ReactMarkdown>
              </div>
              <div className="flex gap-2 mt-2 pt-2 border-t">
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={handleCopy}>
                  <Copy className="mr-1 h-3 w-3" /> Copiar
                </Button>
                {onInsertText && (
                  <Button size="sm" className="text-xs h-7" onClick={handleInsert}>
                    Usar en respuesta
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
