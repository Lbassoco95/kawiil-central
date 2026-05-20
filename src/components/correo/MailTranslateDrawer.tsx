import { useState, useEffect } from "react";
import { X, Sparkles, Copy, CheckCheck, ArrowLeftRight } from "lucide-react";

interface EmailShape {
  id?: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  bodyPreview?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
}

interface Props {
  open: boolean;
  email: EmailShape | null;
  onClose: () => void;
}

const LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
];

const TONES = ["Formal", "Neutro", "Amigable", "Técnico", "Ejecutivo"];

function stripHtml(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

export function MailTranslateDrawer({ open, email, onClose }: Props) {
  const [sourceLang, setSourceLang] = useState("es");
  const [targetLang, setTargetLang] = useState("en");
  const [tone, setTone]             = useState("Formal");
  const [translated, setTranslated] = useState("");
  const [isLoading, setIsLoading]   = useState(false);
  const [copied, setCopied]         = useState(false);

  const originalText = (() => {
    if (!email) return "";
    if (email.body?.content) {
      if (email.body.contentType?.toLowerCase() === "html") return stripHtml(email.body.content);
      return email.body.content;
    }
    return email.bodyPreview || "";
  })();

  // Limpiar traducción al cambiar correo
  useEffect(() => {
    setTranslated("");
    setCopied(false);
  }, [email]);

  const swapLanguages = () => {
    const tmp = sourceLang;
    setSourceLang(targetLang);
    setTargetLang(tmp);
    if (translated) {
      // El texto traducido pasa a ser el original (intercambio visual)
    }
  };

  const handleTranslate = async () => {
    if (!originalText.trim()) return;
    setIsLoading(true);
    setTranslated("");
    try {
      // Llamada al edge ai-chat reutilizando el prompt de traducción
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        import.meta.env.VITE_SUPABASE_URL as string,
        import.meta.env.VITE_SUPABASE_ANON_KEY as string
      );
      const prompt = `Traduce el siguiente texto del ${LANGUAGES.find((l) => l.code === sourceLang)?.label ?? sourceLang} al ${LANGUAGES.find((l) => l.code === targetLang)?.label ?? targetLang}. Tono: ${tone}. Devuelve SOLO el texto traducido, sin explicaciones adicionales.\n\nTexto:\n${originalText.slice(0, 4000)}`;
      const { data } = await supabase.functions.invoke("ai-chat", {
        body: { message: prompt, context: "translate-email" },
      });
      setTranslated(
        (data as { reply?: string; content?: string } | null)?.reply ||
        (data as { reply?: string; content?: string } | null)?.content ||
        "No se pudo traducir el texto."
      );
    } catch (err) {
      console.error("[MailTranslateDrawer]", err);
      setTranslated("Ocurrió un error al traducir. Intenta de nuevo.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!translated) return;
    navigator.clipboard.writeText(translated).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <div
        className={`tr-drawer-backdrop ${open ? "open" : ""}`}
        onClick={onClose}
      />
      <div
        className={`tr-drawer ${open ? "open" : ""}`}
        role="dialog"
        aria-modal
        aria-label="Traducir correo"
      >
        {/* Encabezado */}
        <div className="tr-head">
          <div className="tr-head-top">
            <span className="tr-ai-badge">
              <Sparkles size={11} /> Kawiil AI · Traducción
            </span>
            <button className="tr-close" onClick={onClose}><X size={14} /></button>
          </div>

          <div className="tr-title">{email?.subject || "Traducir correo"}</div>

          {/* Selección de idiomas */}
          <div className="tr-lang-bar">
            <div className="tr-lang-side">
              <div className="tr-lang-lbl">Idioma original</div>
              <div className="tr-lang-chip">
                <select
                  value={sourceLang}
                  onChange={(e) => setSourceLang(e.target.value)}
                  style={{ border: 0, background: "transparent", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "hsl(var(--foreground))", fontFamily: "inherit" }}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={swapLanguages}
              style={{
                background: "transparent",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
                color: "hsl(var(--muted-foreground))",
                display: "flex",
                alignItems: "center",
                marginTop: 16,
              }}
              title="Intercambiar idiomas"
            >
              <ArrowLeftRight size={14} />
            </button>

            <div className="tr-lang-side">
              <div className="tr-lang-lbl">Traducir a</div>
              <div className="tr-lang-chip">
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  style={{ border: 0, background: "transparent", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "hsl(var(--foreground))", fontFamily: "inherit" }}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Tono */}
          <div className="tr-tone-bar">
            <span className="tr-tone-lbl">Tono:</span>
            {TONES.map((t) => (
              <button
                key={t}
                className={`tr-tone ${tone === t ? "active" : ""}`}
                onClick={() => setTone(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Paneles de texto */}
        <div className="tr-body">
          {/* Original */}
          <div className="tr-pane">
            <div className="tr-pane-head">
              <span className="tr-pane-name">
                {LANGUAGES.find((l) => l.code === sourceLang)?.label ?? sourceLang}
              </span>
            </div>
            <div className="tr-pane-body">
              {originalText
                ? originalText.split("\n").map((line, i) => (
                    <p key={i}>{line || <br />}</p>
                  ))
                : <p style={{ opacity: 0.5, fontStyle: "italic" }}>Sin contenido</p>}
            </div>
          </div>

          {/* Traducción */}
          <div className="tr-pane">
            <div className="tr-pane-head">
              <span className="tr-pane-name">
                {LANGUAGES.find((l) => l.code === targetLang)?.label ?? targetLang}
              </span>
              {translated && (
                <button
                  onClick={handleCopy}
                  style={{
                    background: "transparent",
                    border: 0,
                    cursor: "pointer",
                    color: "hsl(var(--muted-foreground))",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    marginLeft: "auto",
                  }}
                >
                  {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              )}
            </div>
            <div className="tr-pane-body">
              {isLoading ? (
                <p style={{ opacity: 0.6, fontStyle: "italic", fontSize: 12 }}>
                  Traduciendo con Kawiil AI…
                </p>
              ) : translated ? (
                translated.split("\n").map((line, i) => (
                  <p key={i}>{line || <br />}</p>
                ))
              ) : (
                <p style={{ opacity: 0.5, fontStyle: "italic" }}>
                  Pulsa "Traducir" para ver el resultado
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="tr-foot">
          <button className="tr-foot-btn ghost" onClick={onClose}>Cerrar</button>
          <button
            className="tr-foot-btn primary"
            onClick={handleTranslate}
            disabled={!originalText.trim() || isLoading}
          >
            <Sparkles size={13} />
            {isLoading ? "Traduciendo…" : "Traducir con AI"}
          </button>
        </div>
      </div>
    </>
  );
}
