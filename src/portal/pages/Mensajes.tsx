import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, CheckCheck, Paperclip } from "lucide-react";
import { usePortal } from "../lib/session";
import { callApi, fileToBase64, openFile } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { Empty, Notice, PageTitle, StatusPill } from "../components/ui";

interface Thread { id: string; subject: string; status: string; kind: string; last_message_at: string | null }
interface Msg { id: string; author_kind: "cliente" | "equipo"; author_name: string | null; body: string; created_at: string }
interface Att { id: string; message_id: string; file_name: string }

export default function Mensajes() {
  const { active, me } = usePortal();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [atts, setAtts] = useState<Att[]>([]);
  const [readState, setReadState] = useState<{ team_last_read_at: string | null } | null>(null);
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const canWrite = active?.role !== "consulta";
  const basic = me?.tier === "basico";

  const loadThreads = useCallback(async () => {
    if (!active) return;
    const data = await callApi<{ hilos: Thread[] }>("mensajes.listar", { client_id: active.client_id });
    setThreads(data.hilos);
  }, [active]);
  const loadThread = useCallback(async (id: string) => {
    const data = await callApi<{ mensajes: Msg[]; adjuntos: Att[]; lectura: { team_last_read_at: string | null } }>("mensajes.leer", { thread_id: id });
    setMsgs(data.mensajes);
    setAtts(data.adjuntos);
    setReadState(data.lectura);
  }, []);
  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => { if (sel) void loadThread(sel); }, [sel, loadThread]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || !text.trim()) return;
    setErr(null);
    try {
      const encoded = await Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, base64: await fileToBase64(file) })));
      const data = await callApi<{ thread_id: string }>("mensajes.enviar", {
        client_id: active.client_id, thread_id: sel, subject: subject || (basic ? "Quiero contratar un servicio" : "Consulta"), body: text, files: encoded,
      });
      if (!sel) setSel(data.thread_id);
      else await loadThread(sel);
      setText(""); setSubject(""); setFiles([]);
      await loadThreads();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const teamRead = (m: Msg) => m.author_kind === "cliente" && readState?.team_last_read_at && new Date(readState.team_last_read_at) >= new Date(m.created_at);

  return (
    <>
      <PageTitle title="Mensajes" subtitle={basic ? "Escríbanos para contratar un servicio de Kawiil." : "Converse con su equipo de Kawiil."}
        actions={canWrite && <Button variant="outline" onClick={() => { setSel(null); setMsgs([]); }}>Nueva conversación</Button>} />
      <div className="grid gap-4 md:grid-cols-3">
        <nav aria-label="Conversaciones" className="md:col-span-1">
          {threads.length === 0 ? <Empty>Sin conversaciones todavía.</Empty> : (
            <ul className="space-y-1">{threads.map((t) => (
              <li key={t.id}><button onClick={() => setSel(t.id)} aria-current={sel === t.id} className={`w-full rounded-lg border p-2 text-left ${sel === t.id ? "border-accent bg-secondary" : "bg-card"}`}>
                <p className="truncate font-medium">{t.subject}</p>
                <p className="text-xs text-muted-foreground">{fmtDateTime(t.last_message_at)} · <StatusPill tone={t.status === "resuelto" ? "ok" : "info"}>{t.status === "resuelto" ? "Resuelta" : "Abierta"}</StatusPill></p>
              </button></li>))}
            </ul>
          )}
        </nav>
        <section className="md:col-span-2" aria-label="Conversación">
          {sel && (
            <ol className="mb-3 space-y-2">{msgs.map((m) => (
              <li key={m.id} className={`max-w-[85%] rounded-xl p-3 ${m.author_kind === "cliente" ? "ml-auto bg-secondary" : "bg-card border"}`}>
                <p className="text-xs text-muted-foreground">{m.author_kind === "equipo" ? `${m.author_name ?? "Equipo"} · Kawiil` : "Usted"} · {fmtDateTime(m.created_at)}</p>
                <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                {atts.filter((a) => a.message_id === m.id).map((a) => <button key={a.id} className="mt-1 flex items-center gap-1 text-xs text-primary underline" onClick={() => openFile("adjunto", a.id)}><Paperclip className="h-3 w-3" aria-hidden="true" />{a.file_name}</button>)}
                {m.author_kind === "cliente" && (
                  <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                    {teamRead(m) ? <><CheckCheck className="h-3 w-3" aria-hidden="true" />Leído por el equipo</> : <><Check className="h-3 w-3" aria-hidden="true" />Enviado</>}
                  </p>
                )}
              </li>))}
            </ol>
          )}
          {canWrite ? (
            <form onSubmit={send} className="space-y-2 rounded-xl border bg-card p-3">
              {!sel && <div><Label htmlFor="m-asunto">Asunto</Label><Input id="m-asunto" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={basic ? "Quiero contratar un servicio" : "¿En qué le ayudamos?"} /></div>}
              <div><Label htmlFor="m-texto">Mensaje</Label><Textarea id="m-texto" rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={10000} /></div>
              <div><Label htmlFor="m-adj">Adjuntos (opcional)</Label><Input id="m-adj" type="file" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} /></div>
              {err && <Notice tone="bad">{err}</Notice>}
              <Button type="submit" disabled={!text.trim()}>Enviar</Button>
            </form>
          ) : <Notice tone="info">Su rol es de consulta: puede leer, pero no escribir.</Notice>}
        </section>
      </div>
    </>
  );
}
