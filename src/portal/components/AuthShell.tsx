import type { ReactNode } from "react";
import { DEMO_FISCAL_MARK, isPortalDemoMode } from "../lib/demo";

export default function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  const demo = isPortalDemoMode();
  return (
    <div className="flex min-h-screen flex-col bg-accent" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {demo && (
        <div className="kw-demo-banner" role="status">
          Entorno de demostración · {DEMO_FISCAL_MARK}
        </div>
      )}
      <div className="flex flex-1 flex-col px-4 py-10">
        <main className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
          <p className="text-3xl font-bold text-accent" style={{ fontFamily: "Rajdhani" }}>
            KAWIIL{demo ? " · DEMO" : ""}
          </p>
          <h1 className="mb-4 mt-1 text-xl text-foreground">{title}</h1>
          {children}
        </main>
      </div>
    </div>
  );
}
