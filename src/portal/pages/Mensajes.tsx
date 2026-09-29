import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, CheckCheck, Paperclip } from "lucide-react";
import { usePortal } from "../lib/session";
import { db } from "../lib/supabase";
import { openFile } from "../lib/api";
import { safeName } from "../lib/files";
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
    const { data } = await db.from("portal_threads").select("id, subject, status, kind, last_message_at").eq("client_id", active.client_id).order("last_message_at", { ascending: false });
    setThreads((data as Thread[]) ?? []);
  }, [active]);
  const loadThread = useCallback(async (id: string) => {
    const [{ data: m }, { data: a }, { data: rs }] = await Promise.all([
      db.from("portal_messages").select("id, author_kind, author_name, body, created_at").eq("thread_id", id).order("created_at"),
      db.from("portal_message_attachments").select("id, message_id, file_name, portal_messages!inner(thread_id)").eq("portal_messages.thread_id", id),
      db.rpc("portal_thread_read_state", { _thread_id: id }),
    ]);
    setMsgs((m as Msg[]) ?? []);
    setAtts((a as Att[]) ?? []);
    setReadState(rs as { team_last_read_at: string | null });
    await db.rpc("portal_thread_mark_read", { _thread_id: id });
  }, []);
  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => { if (sel) void loadThread(sel); }, [sel, loadThread]);

  const uploadAll = async (threadId: string) => {
    const { data: org } = await db.rpc("portal_client_org_id", { _client_id: active!.client_id });
    const out = [];
    for (const f of files) {
      if (f.size > 20 * 1024 * 1024) throw new Error(`«${f.name}» pasa de 20 MB.`);
      const path = `${org}/${active!.client_id}/mensajes/${threadId}/${Date.now()}_${safeName(f.name)}`;
      const up = await db.storage.from("portal").upload(path, f, { contentType: f.type || "application/octet-stream" });
      if (up.error) throw new Error("No se pudo subir el adjunto.");
      out.push({ storage_path: path, file_name: f.name, mime_type: f.type, size_bytes: f.size });
    }
    return out;
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || !text.trim()) return;
    setErr(null);
    try {
      if (!sel) {
        const { data, error } = await db.rpc("portal_thread_create", { _client_id: active.client_id, _subject: subject || (basic ? "Quiero contratar un servicio" : "Consulta"), _body: text });
        if (error) throw new Error(error.message);
        if (files.length) {
          const attachments = await uploadAll(data as string);
          await db.rpc("portal_message_send", { _thread_id: data, _body: "(adjuntos)", _attachments: attachments });
        }
        setSel(data as string);
      } else {
        const attachments = files.length ? await uploadAll(sel) : [];
        const { error } = await db.rpc("portal_message_send", { _thread_id: sel, _body: text, _attachments: attachments });
        if (error) throw new Error(error.message);
        await loadThread(sel);
      }
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
