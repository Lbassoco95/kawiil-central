import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { portalDb, portalApi } from "@/lib/portalAdmin";
import { ClientPicker, Section, date, useClients } from "./shared";

interface Account {
  user_id: string; email: string; full_name: string | null; status: string; tier: string | null; created_via: string; created_at: string;
  memberships: { id: string; client_id: string; client_name: string; role: string; status: string }[];
}
const ROLES = ["administrador", "operativo", "consulta"];

export default function CuentasTab() {
  const clients = useClients();
  const [rows, setRows] = useState<Account[]>([]);
  const [link, setLink] = useState<Record<string, { client: string; role: string; tier: string }>>({});
  const [inv, setInv] = useState({ email: "", full_name: "", client: "", role: "administrador", tier: "premier" });
  const [set, setSet] = useState({ client: "", owner: "", sla: "", limit: "", tickets: false });
  const [staff, setStaff] = useState<{ user_id: string; full_name: string }[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await portalDb.rpc("portal_staff_accounts");
    if (error) toast.error(error.message);
    setRows((data as Account[]) ?? []);
  }, []);
  useEffect(() => { void load(); portalDb.from("profiles").select("user_id, full_name").eq("is_active", true).order("full_name").then(({ data }) => setStaff((data as typeof staff) ?? [])); }, [load]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    const { error } = await p;
    if (error) toast.error(error.message); else { toast.success(ok); await load(); }
  };
  const pending = rows.filter((r) => r.status === "pendiente");

  return (
    <div className="space-y-4">
      <Section title={`Cuentas pendientes (${pending.length})`} desc="Registradas desde el portal o la tienda. No ven ningún dato hasta que las vincule. El nombre de la cuenta no vincula por sí solo: verifique la identidad.">
        {pending.length === 0 && <p className="text-sm text-muted-foreground">No hay cuentas pendientes.</p>}
        <ul className="space-y-2">{pending.map((a) => {
          const l = link[a.user_id] ?? { client: "", role: "administrador", tier: "premier" };
          return (
            <li key={a.user_id} className="grid gap-2 rounded-md border p-2 md:grid-cols-[1fr_16rem_10rem_8rem_auto] md:items-end">
              <div><p className="font-medium">{a.full_name ?? "—"}</p><p className="text-xs text-muted-foreground">{a.email} · {date(a.created_at)}</p></div>
              <ClientPicker id={`l-${a.user_id}`} value={l.client} clients={clients} onChange={(v) => setLink({ ...link, [a.user_id]: { ...l, client: v } })} />
              <select aria-label="Rol" className="h-9 rounded-md border px-2 text-sm" value={l.role} onChange={(e) => setLink({ ...link, [a.user_id]: { ...l, role: e.target.value } })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
              <select aria-label="Nivel" className="h-9 rounded-md border px-2 text-sm" value={l.tier} onChange={(e) => setLink({ ...link, [a.user_id]: { ...l, tier: e.target.value } })}><option value="premier">premier</option><option value="basico">básico</option></select>
              <Button size="sm" disabled={!l.client} onClick={() => run(portalDb.rpc("portal_staff_link_account", { _user_id: a.user_id, _client_id: l.client, _role: l.role, _tier: l.tier }), "Cuenta vinculada")}>Vincular</Button>
            </li>
          );
        })}</ul>
      </Section>

      <Section title="Invitar directamente" desc="Crea la cuenta ya vinculada (sin estado pendiente) y envía un correo para que la persona elija su contraseña.">
        <div className="grid gap-2 md:grid-cols-5 md:items-end">
          <label className="text-sm">Correo<Input value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></label>
          <label className="text-sm">Nombre<Input value={inv.full_name} onChange={(e) => setInv({ ...inv, full_name: e.target.value })} /></label>
          <ClientPicker id="inv-cl" value={inv.client} clients={clients} onChange={(v) => setInv({ ...inv, client: v })} />
          <select aria-label="Rol" className="h-9 rounded-md border px-2 text-sm" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          <Button disabled={!inv.email || !inv.client || !inv.full_name} onClick={async () => {
            try { await portalApi.call("central/invitar", { email: inv.email, full_name: inv.full_name, client_id: inv.client, role: inv.role, tier: inv.tier }); toast.success("Invitación enviada"); setInv({ ...inv, email: "", full_name: "" }); await load(); }
            catch (e) { toast.error((e as Error).message); }
          }}>Invitar</Button>
        </div>
      </Section>

      <Section title="Cuentas activas y suspendidas">
        <ul className="space-y-2">{rows.filter((r) => r.status !== "pendiente").map((a) => (
          <li key={a.user_id} className="rounded-md border p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><span className="font-medium">{a.full_name ?? a.email}</span> <span className="text-muted-foreground">{a.email}</span> <Badge variant={a.status === "activa" ? "default" : "destructive"}>{a.status}</Badge> <Badge variant="outline">{a.tier === "premier" ? "premier" : "básico"}</Badge></div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => run(portalDb.rpc("portal_staff_set_account", { _user_id: a.user_id, _tier: a.tier === "premier" ? "basico" : "premier", _suspended: null }), "Nivel cambiado")}>Cambiar a {a.tier === "premier" ? "básico" : "premier"}</Button>
                <Button size="sm" variant={a.status === "suspendida" ? "default" : "destructive"} onClick={() => run(portalDb.rpc("portal_staff_set_account", { _user_id: a.user_id, _tier: null, _suspended: a.status !== "suspendida" }), a.status === "suspendida" ? "Cuenta reactivada" : "Cuenta suspendida")}>{a.status === "suspendida" ? "Reactivar" : "Suspender"}</Button>
              </div>
            </div>
            <ul className="mt-1 space-y-1">{a.memberships.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <span>{m.client_name}</span>
                <select aria-label={`Rol en ${m.client_name}`} className="h-8 rounded-md border px-2" value={m.role} onChange={(e) => run(portalDb.rpc("portal_staff_set_membership", { _membership_id: m.id, _role: e.target.value, _status: m.status }), "Rol actualizado")}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
                <Button size="sm" variant="ghost" onClick={() => run(portalDb.rpc("portal_staff_set_membership", { _membership_id: m.id, _role: m.role, _status: m.status === "activa" ? "suspendida" : "activa" }), "Acceso actualizado")}>{m.status === "activa" ? "Quitar acceso a este cliente" : "Devolver acceso"}</Button>
              </li>))}
            </ul>
          </li>))}
        </ul>
      </Section>

      <Section title="Ajustes del portal por cliente" desc="Responsable de la bandeja (vacío hasta que se asigne), plazo para marcar hilos sin respuesta, límite de facturas del nivel básico y tickets en nivel básico (servicio de paga).">
        <div className="grid gap-2 md:grid-cols-6 md:items-end">
          <div className="md:col-span-2"><ClientPicker id="set-cl" value={set.client} clients={clients} onChange={(v) => setSet({ ...set, client: v })} /></div>
          <select aria-label="Responsable de la bandeja" className="h-9 rounded-md border px-2 text-sm" value={set.owner} onChange={(e) => setSet({ ...set, owner: e.target.value })}><option value="">(sin cambio)</option>{staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}</select>
          <label className="text-sm">Horas sin respuesta<Input inputMode="numeric" value={set.sla} onChange={(e) => setSet({ ...set, sla: e.target.value })} /></label>
          <label className="text-sm">Límite básico<Input inputMode="numeric" value={set.limit} onChange={(e) => setSet({ ...set, limit: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={set.tickets} onChange={(e) => setSet({ ...set, tickets: e.target.checked })} />Tickets en básico</label>
        </div>
        <Button className="mt-2" size="sm" disabled={!set.client} onClick={() => run(portalDb.rpc("portal_staff_update_client_settings", {
          _client_id: set.client, _inbox_owner_user_id: set.owner || null, _thread_sla_hours: set.sla ? Number(set.sla) : null,
          _basic_invoice_limit: set.limit ? Number(set.limit) : null, _basic_tickets_enabled: set.tickets, _clear_inbox_owner: false,
        }), "Ajustes guardados")}>Guardar ajustes</Button>
      </Section>
    </div>
  );
}
