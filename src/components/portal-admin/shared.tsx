import { useEffect, useState } from "react";
import { portalDb } from "@/lib/portalAdmin";

export interface ClientOpt { id: string; name: string; rfc: string | null }

export function useClients() {
  const [clients, setClients] = useState<ClientOpt[]>([]);
  useEffect(() => {
    portalDb.from("clients").select("id, name, rfc").order("name").then(({ data }) => setClients((data as ClientOpt[]) ?? []));
  }, []);
  return clients;
}

export function ClientPicker({ value, onChange, clients, id = "cliente", label = "Cliente" }: {
  value: string; onChange: (v: string) => void; clients: ClientOpt[]; id?: string; label?: string;
}) {
  return (
    <label htmlFor={id} className="block text-sm">
      <span className="font-medium">{label}</span>
      <select id={id} className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Elija un cliente…</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.rfc ? ` · ${c.rfc}` : ""}</option>)}
      </select>
    </label>
  );
}

export const Section = ({ title, children, desc }: { title: string; desc?: string; children: React.ReactNode }) => (
  <section className="rounded-xl border bg-card p-4">
    <h3 className="text-base font-semibold">{title}</h3>
    {desc && <p className="mb-2 text-sm text-muted-foreground">{desc}</p>}
    <div className="mt-2">{children}</div>
  </section>
);

export const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n));
export const date = (d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d)) : "—";
