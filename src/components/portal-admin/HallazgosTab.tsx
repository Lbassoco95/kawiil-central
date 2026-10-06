/**
 * Stub mínimo en central: anotar un hallazgo/seguimiento demo para un cliente.
 * Aún NO publica al portal OS (falta API/RPC). Persistencia local del navegador del staff.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClientPicker, Section, useClients } from "./shared";

const KEY = "kawiil-central-demo-hallazgos-v1";

type Note = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  followUp: string;
  status: "abierto" | "en_seguimiento" | "cerrado";
  createdAt: string;
};

function load(): Note[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as Note[];
  } catch {
    return [];
  }
}

export default function HallazgosTab() {
  const clients = useClients();
  const [client, setClient] = useState("");
  const [title, setTitle] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [status, setStatus] = useState<Note["status"]>("abierto");
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    setNotes(load());
  }, []);

  const save = () => {
    const c = clients.find((x) => x.id === client);
    if (!c || !title.trim()) {
      toast.error("Elige cliente y título");
      return;
    }
    const note: Note = {
      id: `h-${Date.now()}`,
      clientId: c.id,
      clientName: c.name,
      title: title.trim(),
      followUp: followUp.trim(),
      status,
      createdAt: new Date().toISOString(),
    };
    const next = [note, ...load()];
    localStorage.setItem(KEY, JSON.stringify(next));
    setNotes(next);
    setTitle("");
    setFollowUp("");
    toast.success("Hallazgo demo guardado en este navegador (aún no se publica a Kawiil OS)");
  };

  return (
    <div className="space-y-4">
      <Section
        title="Seguimientos / hallazgos (stub demo)"
        desc="Superficie mínima para anotar lo que el cliente vería en «Seguimientos de Kawiil». Hoy solo persiste en localStorage del staff; falta cablear publicación al portal OS."
      >
        <div className="grid gap-2 md:grid-cols-2">
          <ClientPicker value={client} onChange={setClient} clients={clients} />
          <label className="text-sm">
            Estatus
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2"
              value={status}
              onChange={(e) => setStatus(e.target.value as Note["status"])}
            >
              <option value="abierto">Abierto</option>
              <option value="en_seguimiento">En seguimiento</option>
              <option value="cerrado">Cerrado</option>
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            Título del hallazgo
            <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Concentración de ingresos en un cliente" />
          </label>
          <label className="text-sm md:col-span-2">
            Seguimiento / próximo paso
            <Input className="mt-1" value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="Ej. Revisar mix de clientes en junta" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={save}>
            Guardar hallazgo demo
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              localStorage.removeItem(KEY);
              setNotes([]);
              toast.message("Notas demo borradas");
            }}
          >
            Limpiar notas locales
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Pendiente: tabla/RPC en Supabase + endpoint portal para que OS lea en solo lectura. Hasta entonces el portal muestra fixture demo.
        </p>
      </Section>
      <Section title="Notas en este navegador" desc="No son la fuente de verdad del portal; sirven para ensayar el flujo del equipo.">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin notas aún.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border p-2 text-sm">
                <strong>{n.clientName}</strong> · {n.status}
                <div className="font-medium">{n.title}</div>
                {n.followUp ? <div className="text-muted-foreground">Seguimiento: {n.followUp}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
