import type { ReactNode } from "react";
import { DEMO_FISCAL_MARK, isPortalDemoMode } from "../lib/demo";

export default function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  const demo = isPortalDemoMode();
  return (
    <div className="flex min-h-screen flex-col bg-background" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {demo && (
        <div className="kw-demo-banner" role="status">
          Entorno de demostración · {DEMO_FISCAL_MARK}
        </div>
      )}
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-2">
        <div className="flex items-center justify-center px-4 py-10 sm:px-8">
          <main className="w-full max-w-sm space-y-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <img src="/images/kawiil-logo.png" alt="Kawiil" className="h-14 w-14" />
              <img src="/images/kawiil-brand-blue.png" alt="Kawiil MX" className="h-8" />
              <div>
                <p className="text-base font-semibold tracking-tight gradient-text">
                  Kawiil{demo ? " · DEMO" : ""} · Portal del cliente
                </p>
                <h1 className="mt-1 text-sm text-muted-foreground">{title}</h1>
              </div>
            </div>
            <div className="surface-toolbar space-y-4 p-5 sm:p-6">{children}</div>
          </main>
        </div>

        <div
          className="relative hidden overflow-hidden lg:block"
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)",
          }}
          aria-hidden
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 top-12 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute -right-20 bottom-10 h-96 w-96 rounded-full bg-white/15 blur-3xl" />
            <div className="absolute right-24 top-32 h-32 w-32 rounded-full border border-white/30" />
            <div className="absolute bottom-32 left-16 h-48 w-48 rounded-full border border-white/20" />
          </div>
          <div className="relative z-10 flex h-full flex-col justify-between p-12 text-white">
            <div className="flex items-center gap-3">
              <img src="/images/kawiil-logo.png" alt="" className="h-9 w-9 brightness-0 invert" />
              <span className="text-sm font-semibold tracking-wide">Kawiil OS</span>
              {demo && (
                <span className="rounded-md border border-white/40 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                  DEMO
                </span>
              )}
            </div>
            <div className="space-y-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/70">Portal del cliente</p>
              <h2 className="max-w-md text-3xl font-bold leading-tight tracking-tight">
                Todo lo que Kawiil trabaja por usted, en un solo lugar.
              </h2>
              <p className="max-w-md text-sm text-white/80">
                Resumen, facturación, documentos y alertas de tu cuenta. En esta fase solo consultas: no cargas XML ni consultas el SAT desde aquí.
              </p>
            </div>
            <p className="text-[11px] text-white/60">© {new Date().getFullYear()} Kawiil MX · Portal del cliente</p>
          </div>
        </div>
      </div>
    </div>
  );
}
