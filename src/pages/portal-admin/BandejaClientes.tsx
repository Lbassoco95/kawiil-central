/**
 * Comunicación → bandeja «Clientes» (y «Prospectos»): conversaciones del portal
 * del cliente, guardadas en kawiil-central (portal_threads/portal_messages).
 * No usa Slack como almacén; Slack solo recibe el aviso. La parte de Slack de
 * Comunicación (src/pages/Comunicacion.tsx) no se modifica.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, MessageSquare, Paperclip, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { portalDb, portalApi } from "@/lib/portalAdmin";
import { formatMX } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";

interface InboxRow {
  thread_id: string; client_id: string; client_name: string; kind: string; subject: string; status: string;
  assigned_to: string | null; assigned_name: string | null; last_message_at: string | null; unread_count: number; overdue: boolean; sla_hours: number; last_body: string | null;
}
interface Msg { id: string; author_kind: string; author_name: string | null; body: string; created_at: string }
interface Att { id: string; message_id: string; file_name: string }

export default function BandejaClientes() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState<"servicio" | "contratacion">(params.get("bandeja") === "prospectos" ? "contratacion" : "servicio");
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [sel, setSel] = useState<string | null>(params.get("hilo"));
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [atts, setAtts] = useState<Att[]>([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [staff, setStaff] = useState<{ user_id: string; full_name: string }[]>([]);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await portalDb.rpc("portal_staff_inbox", { _kind: kind });
    if (error) toast.error(error.message);
    setRows((data as InboxRow[]) ?? []);
  }, [kind]);
  const loadThread = useCallback(async (id: string) => {
    const [{ data: m }, { data: a }] = await Promise.all([
      portalDb.from("portal_messages").select("id, author_kind, author_name, body, created_at").eq("thread_id", id).order("created_at"),
      portalDb.from("portal_message_attachments").select("id, message_id, file_name, portal_messages!inner(thread_id)").eq("portal_messages.thread_id", id),
    ]);
    setMsgs((m as Msg[]) ?? []);
    setAtts((a as Att[]) ?? []);
    await portalDb.rpc("portal_thread_mark_read", { _thread_id: id });
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (sel) void loadThread(sel).then(load); }, [sel, loadThread, load]);
  useEffect(() => {
    portalDb.from("profiles").select("user_id, full_name").eq("is_active", true).order("full_name").then(({ data }) => setStaff((data as typeof staff) ?? []));
  }, []);

  const current = useMemo(() => rows.find((r) => r.thread_id === sel) ?? null, [rows, sel]);
  const shown = rows.filter((r) => !filter || `${r.client_name} ${r.subject}`.toLowerCase().includes(filter.toLowerCase()));

  const reply = async () => {
    if (!current || !text.trim()) return;
    try {
      const { data: org } = await portalDb.rpc("portal_client_org_id", { _client_id: current.client_id });
      const attachments = [];
      for (const f of files) {
        const path = `${org}/${current.client_id}/mensajes/${current.thread_id}/${Date.now()}_${f.name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
        const up = await portalDb.storage.from("portal").upload(path, f, { contentType: f.type || "application/octet-stream" });
        if (up.error) throw new Error(up.error.message);
        attachments.push({ storage_path: path, file_name: f.name, mime_type: f.type, size_bytes: f.size });
      }
      const { error } = await portalDb.rpc("portal_message_send", { _thread_id: current.thread_id, _body: text, _attachments: attachments });
      if (error) throw new Error(error.message);
      setText(""); setFiles([]);
      await loadThread(current.thread_id);
      await load();
      toast.success("Respuesta enviada; el cliente recibe un aviso por correo.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const update = async (patch: { assigned?: string; status?: string }) => {
    if (!current) return;
    const { error } = await portalDb.rpc("portal_staff_thread_update", { _thread_id: current.thread_id, _assigned_to: patch.assigned ?? null, _status: patch.status ?? null });
    if (error) toast.error(error.message); else await load();
  };

  return (
    <AppLayout contentMaxWidth="full">
      <PageHeader
        title="Comunicación · Clientes"
        description="Mensajes del portal del cliente. Se guardan en Kawiil OS; a Slack solo llega el aviso."
        icon={<MessageSquare className="h-5 w-5" />}
        actions={<Button variant="outline" asChild><Link to="/comunicacion">Ir a Slack</Link></Button>}
      />
      <Tabs value={kind} onValueChange={(v) => { setKind(v as typeof kind); setSel(null); setParams(v === "contratacion" ? { bandeja: "prospectos" } : {}); }} className="mb-3">
        <TabsList>
          <TabsTrigger value="servicio">Clientes</TabsTrigger>
          <TabsTrigger value="contratacion">Prospectos</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid min-h-[60vh] gap-4 lg:grid-cols-[22rem_1fr]">
        <aside className="space-y-2">
          <Input placeholder="Buscar cliente o asunto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Buscar conversación" />
          {shown.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No hay conversaciones {kind === "servicio" ? "de sus clientes asignados" : "de prospectos"}.</p>}
          <ul className="space-y-1">
            {shown.map((r) => (
              <li key={r.thread_id}>
                <button onClick={() => { setSel(r.thread_id); setParams({ ...(kind === "contratacion" ? { bandeja: "prospectos" } : {}), hilo: r.thread_id }); }}
                  className={cn("w-full rounded-lg border p-2 text-left", sel === r.thread_id ? "border-primary bg-primary/5" : "bg-card")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{r.client_name}</span>
                    {r.unread_count > 0 && <Badge>{r.unread_count} sin leer</Badge>}
                  </div>
                  <p className="truncate text-sm">{r.subject}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.last_body}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                    {r.overdue && <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900"><AlertTriangle className="h-3 w-3" />Sin respuesta más de {r.sla_hours} h</span>}
                    {r.status === "resuelto" && <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900"><CheckCircle2 className="h-3 w-3" />Resuelto</span>}
                    <span className="text-muted-foreground">{r.assigned_name ? `Asignado: ${r.assigned_name}` : "Sin asignar"} · {r.last_message_at ? formatMX(r.last_message_at, "dd MMM HH:mm") : ""}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="rounded-xl border bg-card p-4">
          {!current ? <p className="text-sm text-muted-foreground">Elija una conversación.</p> : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div><h2 className="text-lg font-semibold">{current.subject}</h2><p className="text-sm text-muted-foreground">{current.client_name}</p></div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => update({ assigned: user?.id })}><UserPlus className="mr-1 h-4 w-4" />Asignarme</Button>
                  <select aria-label="Asignar a" className="h-9 rounded-md border px-2 text-sm" value={current.assigned_to ?? ""} onChange={(e) => e.target.value && update({ assigned: e.target.value })}>
                    <option value="">Asignar a…</option>
                    {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}
                  </select>
                  {current.status === "resuelto"
                    ? <Button size="sm" variant="outline" onClick={() => update({ status: "abierto" })}>Reabrir</Button>
                    : <Button size="sm" onClick={() => update({ status: "resuelto" })}>Marcar como resuelto</Button>}
                </div>
              </div>
              <ol className="mb-3 max-h-[50vh] space-y-2 overflow-y-auto">
                {msgs.map((m) => (
                  <li key={m.id} className={cn("max-w-[80%] rounded-lg p-3 text-sm", m.author_kind === "equipo" ? "ml-auto bg-primary/10" : "border bg-background")}>
                    <p className="text-xs text-muted-foreground">{m.author_kind === "equipo" ? `${m.author_name ?? "Equipo"} (Kawiil)` : `${m.author_name ?? "Cliente"} (cliente)`} · {formatMX(m.created_at, "dd MMM yyyy HH:mm")}</p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    {atts.filter((a) => a.message_id === m.id).map((a) => (
                      <button key={a.id} className="mt-1 flex items-center gap-1 text-xs text-primary underline" onClick={() => portalApi.openFile("adjunto", a.id)}><Paperclip className="h-3 w-3" />{a.file_name}</button>
                    ))}
                  </li>
                ))}
              </ol>
              <div className="space-y-2">
                <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Responder al cliente (trato de usted)…" aria-label="Respuesta" />
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="file" multiple className="max-w-xs" onChange={(e) => setFiles([...(e.target.files ?? [])])} aria-label="Adjuntos" />
                  <Button onClick={reply} disabled={!text.trim()}>Enviar respuesta</Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
