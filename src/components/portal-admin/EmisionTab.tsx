import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { portalDb, portalApi, fileToBase64 } from "@/lib/portalAdmin";
import { ClientPicker, Section, date, useClients } from "./shared";

interface Dossier { complete: boolean; origin: string; checks: { key: string; ok: boolean; label: string; detail: string }[] }
interface Cancel { id: string; client_id: string; motivo: string; folio_sustitucion: string | null; comment: string | null; status: string; requested_at: string; portal_cfdi: { uuid: string; total: number } | null }

export default function EmisionTab() {
  const clients = useClients();
  const [client, setClient] = useState("");
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [letter, setLetter] = useState({ version: "", fecha: "" });
  const [csd, setCsd] = useState<{ registry_id: string; cert_serial: string; cert_not_after: string; revoked_at: string | null; registered_via: string }[]>([]);
  const [files, setFiles] = useState<{ cer: File | null; key: File | null; pwd: string }>({ cer: null, key: null, pwd: "" });
  const [cancels, setCancels] = useState<Cancel[]>([]);

  const load = useCallback(async () => {
    const { data: c } = await portalDb.from("portal_cancel_requests").select("id, client_id, motivo, folio_sustitucion, comment, status, requested_at, portal_cfdi(uuid, total)").in("status", ["solicitada", "en_revision"]).order("requested_at");
    setCancels((c as unknown as Cancel[]) ?? []);
    if (!client) return;
    const [{ data: d }, { data: s }] = await Promise.all([
      portalDb.rpc("portal_emission_dossier", { _client_id: client }),
      portalDb.from("portal_client_settings").select("emission_enabled").eq("client_id", client).maybeSingle(),
    ]);
    setDossier(d as Dossier);
    setEnabled(!!s?.emission_enabled);
    const r = await portalApi.call<{ csd: typeof csd }>("csd.estado", { client_id: client }).catch(() => ({ csd: [] }));
    setCsd(r.csd);
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (v: boolean) => {
    const { error } = await portalDb.rpc("portal_staff_set_emission", { _client_id: client, _enabled: v });
    if (error) toast.error(error.message); else toast.success(v ? "Emisión activada" : "Emisión apagada");
    await load();
  };

  return (
    <div className="space-y-4">
      <Section title="Interruptor de emisión por cliente" desc="Apagada por defecto. La base impide activarla si el expediente está incompleto. Mientras Kawiil no conecte un PAC, la emisión usa el emisor de PRUEBA (sin validez fiscal).">
        <div className="max-w-md"><ClientPicker value={client} onChange={setClient} clients={clients} /></div>
        {dossier && (
          <div className="mt-3 space-y-2">
            <ul className="space-y-1 text-sm">{dossier.checks.map((c) => (
              <li key={c.key} className="flex flex-wrap gap-2"><Badge variant={c.ok ? "default" : "destructive"}>{c.ok ? "Completo" : "Falta"}</Badge><strong>{c.label}:</strong><span className="text-muted-foreground">{c.detail}</span></li>))}
            </ul>
            <label className="flex items-center gap-2 text-sm"><Switch checked={enabled} onCheckedChange={toggle} disabled={!dossier.complete && !enabled} />Emisión {enabled ? "activada" : "apagada"}{!dossier.complete && !enabled && " — complete el expediente primero"}</label>
          </div>
        )}
      </Section>
      {client && dossier?.origin !== "basico" && (
        <Section title="Carta de instrucción" desc="Registre la carta firmada por el cliente (la plantilla es un marcador hasta que Kawiil entregue el texto).">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">Versión<Input value={letter.version} onChange={(e) => setLetter({ ...letter, version: e.target.value })} /></label>
            <label className="text-sm">Fecha de firma<Input type="date" value={letter.fecha} onChange={(e) => setLetter({ ...letter, fecha: e.target.value })} /></label>
            <Button size="sm" disabled={!letter.version || !letter.fecha} onClick={async () => {
              const { error } = await portalDb.rpc("portal_staff_register_instruction_letter", { _client_id: client, _version: letter.version, _signed_date: letter.fecha, _storage_path: null });
              if (error) toast.error(error.message); else { toast.success("Carta registrada"); await load(); }
            }}>Registrar carta</Button>
          </div>
        </Section>
      )}
      {client && (
        <Section title="Certificado de sello digital" desc="Se carga una vez, se cifra y nunca se vuelve a mostrar ni a descargar. Solo se usa para sellar; cada uso queda en bitácora. La alerta de vencimiento la envía cert-expiry-notifier.">
          <ul className="space-y-1 text-sm">{csd.map((c) => (
            <li key={c.registry_id} className="flex flex-wrap items-center gap-2">Serie <span className="font-mono">{c.cert_serial}</span> · vence {date(c.cert_not_after)} · cargado desde {c.registered_via}
              {c.revoked_at ? <Badge variant="destructive">Revocado</Badge> : <Button size="sm" variant="ghost" onClick={async () => { await portalApi.call("csd.revocar", { registry_id: c.registry_id }); await load(); }}>Revocar</Button>}
            </li>))}
          </ul>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-sm">.cer<Input type="file" accept=".cer" onChange={(e) => setFiles({ ...files, cer: e.target.files?.[0] ?? null })} /></label>
            <label className="text-sm">.key<Input type="file" accept=".key" onChange={(e) => setFiles({ ...files, key: e.target.files?.[0] ?? null })} /></label>
            <label className="text-sm">Contraseña<Input type="password" autoComplete="off" value={files.pwd} onChange={(e) => setFiles({ ...files, pwd: e.target.value })} /></label>
            <Button size="sm" disabled={!files.cer || !files.key || !files.pwd} onClick={async () => {
              try { await portalApi.call("csd.cargar", { client_id: client, cer_base64: await fileToBase64(files.cer!), key_base64: await fileToBase64(files.key!), password: files.pwd }); setFiles({ cer: null, key: null, pwd: "" }); toast.success("CSD guardado"); await load(); }
              catch (e) { toast.error((e as Error).message); }
            }}>Cargar CSD</Button>
          </div>
        </Section>
      )}
      <Section title={`Solicitudes de cancelación (${cancels.length})`} desc="El cliente solicita; Kawiil revisa y ejecuta la cancelación ante el SAT (sin PAC conectado, se ejecuta fuera y aquí se registra).">
        <ul className="space-y-2 text-sm">{cancels.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
            <span><span className="font-mono">{c.portal_cfdi?.uuid}</span> · motivo {c.motivo}{c.folio_sustitucion ? ` · sustituye ${c.folio_sustitucion}` : ""} · {c.comment} · {date(c.requested_at)} <Badge variant="outline">{c.status}</Badge></span>
            <span className="flex gap-1">
              {(["en_revision", "ejecutada", "rechazada"] as const).map((s) => <Button key={s} size="sm" variant={s === "ejecutada" ? "default" : "outline"} onClick={async () => {
                const { error } = await portalDb.rpc("portal_staff_resolve_cancel", { _request_id: c.id, _status: s, _note: null });
                if (error) toast.error(error.message); else await load();
              }}>{s === "en_revision" ? "En revisión" : s === "ejecutada" ? "Marcar ejecutada" : "Rechazar"}</Button>)}
            </span>
          </li>))}
        </ul>
      </Section>
    </div>
  );
}
