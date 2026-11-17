import { dominiosEscritura } from "../../../supabase/functions/_shared/seguimiento";
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { nombreAgente, type AgenteRegistro } from "@/lib/agentes/registro";
import { SelectorAgentes } from "@/components/agentes/SelectorAgentes";
import { FichaAgente } from "@/components/agentes/FichaAgente";
import { useInstruirAgente } from "@/hooks/useAgenteConstructor";

export function etiquetasAccesos(a: AgenteRegistro | undefined): { etiqueta: string; dominio: string }[] {
  const lista = (a?.config as { credenciales_1password?: unknown } | null | undefined)?.credenciales_1password;
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((c) => (c && typeof c.etiqueta === "string" ? [{ etiqueta: c.etiqueta, dominio: typeof c.dominio === "string" ? c.dominio : "su sitio" }] : []));
}

// Darle una instrucción a un agente: crea una tarea por el despacho que ya existe. No modifica al agente ni guarda datos de expedientes aquí.
// Accesos que el texto menciona (por su nombre, o por su primera palabra si tiene 4+ letras: «SITI») pero que NO están marcados: el agente no podría entrar.
export function accesosOlvidados(texto: string, accesos: { etiqueta: string }[], marcados: string[]): string[] {
  const t = texto.toLowerCase();
  return accesos.filter((a) => {
    if (marcados.includes(a.etiqueta)) return false;
    const e = a.etiqueta.toLowerCase(), primera = e.split(/\s+/)[0];
    return t.includes(e) || (primera.length >= 4 && new RegExp(`\\b${primera.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t));
  }).map((a) => a.etiqueta);
}

// Casilla de «autorizo usar» por acceso de 1Password, solo para ESTA tarea. Sin marcarla el agente no inicia sesión. Solo etiqueta y dominio; nunca la referencia.
export function AutorizarAccesos({ accesos, marcados, onCambio, texto = "" }: { accesos: { etiqueta: string; dominio: string }[]; marcados: string[]; onCambio: (v: string[]) => void; texto?: string }) {
  if (accesos.length === 0) return null;
  const olvidados = accesosOlvidados(texto, accesos, marcados);
  return (
    <fieldset className="space-y-2 rounded-2xl border border-border/60 p-3 text-sm" data-testid="instruir-accesos">
      <legend className="px-1 text-xs font-medium text-muted-foreground">Accesos de 1Password (solo para esta tarea)</legend>
      <p className="text-xs text-muted-foreground">Sin tu autorización el agente no puede iniciar sesión. Solo consulta: no envía formularios ni hace trámites, y nunca ve la contraseña.</p>
      {olvidados.length > 0 && <p role="alert" className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900" data-testid="acceso-olvidado">Mencionas «{olvidados.join("», «")}» pero no marcaste su autorización: el agente no podrá entrar.</p>}
      {accesos.map((a) => (
        <label key={a.etiqueta} className="flex items-center gap-2">
          <input type="checkbox" checked={marcados.includes(a.etiqueta)} data-testid={`instruir-acceso-${a.etiqueta}`}
            onChange={(e) => onCambio(e.target.checked ? [...marcados, a.etiqueta] : marcados.filter((x) => x !== a.etiqueta))} />
          Autorizo usar «{a.etiqueta}» en {a.dominio}
        </label>
      ))}
    </fieldset>
  );
}

// Las dos autorizaciones juntas y plegadas, para el chat: ocupan una línea (con lo que está autorizado a la vista) y se abren solo cuando hace falta,
// en vez de quitarle espacio a la conversación. Mismas casillas y mismas reglas que en Instrucciones.
export function PermisosTarea({ accesos, aprobados, onAccesos, sitios, escribir, onEscribir, texto = "" }: {
  texto?: string;
  accesos: { etiqueta: string; dominio: string }[]; aprobados: string[]; onAccesos: (v: string[]) => void;
  sitios: string[]; escribir: string[]; onEscribir: (v: string[]) => void;
}) {
  if (accesos.length === 0 && sitios.length === 0) return null;
  const marcados = [...aprobados.filter((e) => accesos.some((a) => a.etiqueta === e)), ...escribir.filter((d) => sitios.includes(d)).map((d) => `escribir en ${d}`)];
  const olvidados = accesosOlvidados(texto, accesos, aprobados);
  return (
    <details className="rounded-xl border border-border/60 bg-background text-sm" data-testid="permisos-tarea" open={olvidados.length > 0 ? true : undefined}>
      <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-medium" data-testid="permisos-resumen">
        Permisos para este mensaje · {olvidados.length > 0 ? <span className="font-semibold text-amber-700">⚠ falta autorizar «{olvidados.join("», «")}»</span> : marcados.length ? <span className="text-primary">{marcados.join(", ")}</span> : <span className="text-muted-foreground">ninguno autorizado (solo lee)</span>}
      </summary>
      <div className="max-h-56 space-y-2 overflow-y-auto p-2">
        <AutorizarAccesos accesos={accesos} marcados={aprobados} onCambio={onAccesos} texto={texto} />
        <AutorizarEscritura sitios={sitios} marcados={escribir} onCambio={onEscribir} />
      </div>
    </details>
  );
}

// Casilla de «autorizo escribir» por sitio, solo para ESTA tarea. Sin marcarla el agente lee, descarga y prepara un resumen, pero no carga nada.
export function AutorizarEscritura({ sitios, marcados, onCambio }: { sitios: string[]; marcados: string[]; onCambio: (v: string[]) => void }) {
  if (sitios.length === 0) return null;
  return (
    <fieldset className="space-y-2 rounded-2xl border border-amber-300/70 bg-amber-50/40 p-3 text-sm" data-testid="autorizar-escritura">
      <legend className="px-1 text-xs font-medium text-muted-foreground">Escribir en sitios (solo para esta tarea)</legend>
      <p className="text-xs text-muted-foreground">Sin marcarla, el agente solo lee y te prepara un resumen para que lo apruebes. Márcala cuando ya revisaste lo que va a cargar: solo cargará lo que apruebes en tu instrucción.</p>
      {sitios.map((d) => (
        <label key={d} className="flex items-center gap-2">
          <input type="checkbox" checked={marcados.includes(d)} data-testid={`autorizar-escritura-${d}`}
            onChange={(e) => onCambio(e.target.checked ? [...marcados, d] : marcados.filter((x) => x !== d))} />
          Autorizo escribir y enviar formularios en {d}
        </label>
      ))}
    </fieldset>
  );
}
