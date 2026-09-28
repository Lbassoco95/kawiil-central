import type { ReactNode } from "react";

export default function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-accent px-4 py-10" style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top))" }}>
      <main className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
        <p className="text-3xl font-bold text-accent" style={{ fontFamily: "Rajdhani" }}>KAWIIL</p>
        <h1 className="mb-4 mt-1 text-xl text-foreground">{title}</h1>
        {children}
      </main>
    </div>
  );
}
