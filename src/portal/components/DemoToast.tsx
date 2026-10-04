import { useEffect, useState } from "react";
import { onDemoToast, type DemoToast as Toast } from "../lib/demoStore";

export default function DemoToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const off = onDemoToast((t) => {
      setToast(t);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), 3200);
    });
    return () => {
      off();
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  if (!toast) return null;
  const color =
    toast.tone === "ok" ? "var(--positive-text)" : toast.tone === "warn" ? "var(--caution-text)" : "var(--link)";
  return (
    <div className="kw-toast" role="status" aria-live="polite" style={{ borderColor: color }}>
      <span className="kw-caption" style={{ color }}>
        {toast.tone === "ok" ? "Listo" : toast.tone === "warn" ? "Aviso" : "Demo"}
      </span>
      <p className="kw-small" style={{ margin: "2px 0 0" }}>
        {toast.text}
      </p>
    </div>
  );
}
