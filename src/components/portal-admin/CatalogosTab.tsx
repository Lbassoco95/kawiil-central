import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { portalDb } from "@/lib/portalAdmin";
import { Section, date } from "./shared";

interface Cat { id: string; organization_id: string; name: string; kind: string; clave_prod_serv: string | null; cuenta_contable: string | null; active: boolean }
interface Rule { id: string; category_id: string; match_rfc_emisor: string | null; match_clave_prefix: string | null; match_text: string | null; priority: number; active: boolean }
interface Merchant { id: string; name: string; window_type: string; window_days: number | null }
interface Legal { id: string; kind: string; version: string; title: string; is_placeholder: boolean; published_at: string | null }

export default function CatalogosTab() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [legal, setLegal] = useState<Legal[]>([]);
  const [nc, setNc] = useState({ name: "", kind: "general", clave: "", cuenta: "" });
  const [nr, setNr] = useState({ category: "", rfc: "", clave: "", text: "" });
  const [nl, setNl] = useState({ kind: "aviso_privacidad", version: "", title: "", body: "" });
  const [org, setOrg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: c }, { data: r }, { data: m }, { data: l }, { data: u }] = await Promise.all([
      portalDb.from("portal_expense_categories").select("*").order("name"),
      portalDb.from("portal_category_rules").select("*").order("priority"),
      portalDb.from("fis_merchants").select("id, name, window_type, window_days").order("name"),
      portalDb.from("portal_legal_documents").select("id, kind, version, title, is_placeholder, published_at").order("created_at", { ascending: false }),
      portalDb.auth.getUser(),
    ]);
    setCats((c as Cat[]) ?? []); setRules((r as Rule[]) ?? []); setMerchants((m as Merchant[]) ?? []); setLegal((l as Legal[]) ?? []);
    if (u.user) { const { data: p } = await portalDb.from("profiles").select("organization_id").eq("user_id", u.user.id).single(); setOrg(p?.organization_id ?? null); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const ok = async (p: PromiseLike<{ error: { message: string } | null }>, msg = "Guardado") => { const { error } = await p; if (error) toast.error(error.message); else { toast.success(msg); await load(); } };

  return (
    <div className="space-y-4">
      <Section title="Categorías de gasto" desc="Cada categoría se puede vincular a una clave de producto o servicio del SAT y a una cuenta contable. «combustible» y «restaurante» activan las marcas de deducibilidad.">
        <ul className="space-y-1 text-sm">{cats.map((c) => (
          <li key={c.id} className="grid gap-2 md:grid-cols-[1fr_9rem_9rem_9rem_auto] md:items-center">
            <span>{c.name} {!c.active && <Badge variant="outline">inactiva</Badge>}</span>
            <select aria-label="Tipo" className="h-8 rounded-md border px-2" defaultValue={c.kind} onChange={(e) => ok(portalDb.from("portal_expense_categories").update({ kind: e.target.value }).eq("id", c.id))}><option value="general">general</option><option value="combustible">combustible</option><option value="restaurante">restaurante</option></select>
            <Input aria-label="Clave SAT" className="h-8 font-mono" defaultValue={c.clave_prod_serv ?? ""} placeholder="Clave SAT" onBlur={(e) => e.target.value !== (c.clave_prod_serv ?? "") && ok(portalDb.from("portal_expense_categories").update({ clave_prod_serv: e.target.value || null }).eq("id", c.id))} />
            <Input aria-label="Cuenta contable" className="h-8 font-mono" defaultValue={c.cuenta_contable ?? ""} placeholder="Cuenta" onBlur={(e) => e.target.value !== (c.cuenta_contable ?? "") && ok(portalDb.from("portal_expense_categories").update({ cuenta_contable: e.target.value || null }).eq("id", c.id))} />
            <Button size="sm" variant="ghost" onClick={() => ok(portalDb.from("portal_expense_categories").update({ active: !c.active }).eq("id", c.id))}>{c.active ? "Desactivar" : "Activar"}</Button>
          </li>))}
        </ul>
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_9rem_9rem_9rem_auto]">
          <Input placeholder="Nueva categoría" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} aria-label="Nombre de la nueva categoría" />
          <select aria-label="Tipo" className="h-9 rounded-md border px-2" value={nc.kind} onChange={(e) => setNc({ ...nc, kind: e.target.value })}><option value="general">general</option><option value="combustible">combustible</option><option value="restaurante">restaurante</option></select>
          <Input placeholder="Clave SAT" value={nc.clave} onChange={(e) => setNc({ ...nc, clave: e.target.value })} aria-label="Clave SAT" />
          <Input placeholder="Cuenta" value={nc.cuenta} onChange={(e) => setNc({ ...nc, cuenta: e.target.value })} aria-label="Cuenta contable" />
          <Button size="sm" disabled={!nc.name || !org} onClick={() => ok(portalDb.from("portal_expense_categories").insert({ organization_id: org, name: nc.name, kind: nc.kind, clave_prod_serv: nc.clave || null, cuenta_contable: nc.cuenta || null }))}>Agregar</Button>
        </div>
      </Section>
      <Section title="Reglas automáticas" desc="Paso 1 de la categorización. Una regla propone; la confirmación es siempre de una persona.">
        <ul className="space-y-1 text-sm">{rules.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2">{cats.find((c) => c.id === r.category_id)?.name} ← {[r.match_rfc_emisor && `RFC ${r.match_rfc_emisor}`, r.match_clave_prefix && `clave ${r.match_clave_prefix}*`, r.match_text && `texto «${r.match_text}»`].filter(Boolean).join(" y ")}
            <Button size="sm" variant="ghost" onClick={() => ok(portalDb.from("portal_category_rules").delete().eq("id", r.id), "Regla eliminada")}>Quitar</Button></li>))}
        </ul>
        <div className="mt-2 grid gap-2 md:grid-cols-5">
          <select aria-label="Categoría" className="h-9 rounded-md border px-2" value={nr.category} onChange={(e) => setNr({ ...nr, category: e.target.value })}><option value="">Categoría…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <Input placeholder="RFC emisor" value={nr.rfc} onChange={(e) => setNr({ ...nr, rfc: e.target.value.toUpperCase() })} aria-label="RFC emisor" />
          <Input placeholder="Prefijo clave SAT" value={nr.clave} onChange={(e) => setNr({ ...nr, clave: e.target.value })} aria-label="Prefijo de clave SAT" />
          <Input placeholder="Texto" value={nr.text} onChange={(e) => setNr({ ...nr, text: e.target.value })} aria-label="Texto" />
          <Button size="sm" disabled={!nr.category || !(nr.rfc || nr.clave || nr.text) || !org} onClick={() => ok(portalDb.from("portal_category_rules").insert({ organization_id: org, category_id: nr.category, match_rfc_emisor: nr.rfc || null, match_clave_prefix: nr.clave || null, match_text: nr.text || null }))}>Agregar regla</Button>
        </div>
      </Section>
      <Section title="Ventanas de facturación por comercio" desc="Catálogo de Ju'un (fis_merchants). Aquí solo se edita la ventana; la receta del portal del comercio es de Ju'un.">
        <ul className="grid gap-1 text-sm md:grid-cols-2">{merchants.map((m) => (
          <li key={m.id} className="flex items-center gap-2">
            <span className="w-48 truncate">{m.name}</span>
            <select aria-label={`Ventana de ${m.name}`} className="h-8 rounded-md border px-2" defaultValue={m.window_type} onChange={(e) => ok(portalDb.rpc("portal_staff_merchant_update_window", { _merchant_id: m.id, _window_type: e.target.value, _window_days: e.target.value === "days" ? m.window_days ?? 7 : null }))}>
              <option value="days">días</option><option value="end_of_month">fin de mes</option><option value="not_applicable">no se factura</option></select>
            {m.window_type === "days" && <Input aria-label={`Días de ${m.name}`} className="h-8 w-20" type="number" min={1} defaultValue={m.window_days ?? 7} onBlur={(e) => ok(portalDb.rpc("portal_staff_merchant_update_window", { _merchant_id: m.id, _window_type: "days", _window_days: Number(e.target.value) }))} />}
          </li>))}
        </ul>
      </Section>
      <Section title="Textos legales (versionados)" desc="Los textos marcados «marcador» son provisionales. Publicar una versión nueva obliga a los usuarios a aceptarla al entrar.">
        <ul className="space-y-1 text-sm">{legal.map((l) => (
          <li key={l.id}>{l.kind} · <span className="font-mono">{l.version}</span> · {l.title} {l.is_placeholder && <Badge variant="destructive">marcador</Badge>} · {l.published_at ? `vigente desde ${date(l.published_at)}` : "sin publicar"}</li>))}
        </ul>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <select aria-label="Tipo de texto" className="h-9 rounded-md border px-2" value={nl.kind} onChange={(e) => setNl({ ...nl, kind: e.target.value })}><option value="aviso_privacidad">Aviso de privacidad</option><option value="terminos">Términos</option><option value="contrato_uso">Contrato de uso</option><option value="carta_instruccion">Carta de instrucción</option></select>
          <Input placeholder="Versión (p. ej. 1.0)" value={nl.version} onChange={(e) => setNl({ ...nl, version: e.target.value })} aria-label="Versión" />
          <Input placeholder="Título" value={nl.title} onChange={(e) => setNl({ ...nl, title: e.target.value })} aria-label="Título" />
          <Textarea className="md:col-span-3" rows={5} placeholder="Texto en Markdown" value={nl.body} onChange={(e) => setNl({ ...nl, body: e.target.value })} aria-label="Texto" />
        </div>
        <Button className="mt-2" size="sm" disabled={!nl.version || !nl.title || !nl.body} onClick={() => ok(portalDb.from("portal_legal_documents").insert({ kind: nl.kind, version: nl.version, title: nl.title, body_md: nl.body, is_placeholder: false, published_at: new Date().toISOString() }), "Versión publicada")}>Publicar versión</Button>
      </Section>
    </div>
  );
}
