import { useEffect, useRef, useState } from "react";
import { MarkdownAgente } from "@/components/agentes/MarkdownAgente";
import { Loader2, Send, Sparkles, CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatConstructor, useCrearAgente, type AgenteCreado } from "@/hooks/useAgenteConstructor";
import { useBorradores, useEliminarBorrador, useGuardarBorrador } from "@/hooks/useBorradoresAgente";
import { guardable, type Borrador } from "@/lib/agentes/borradores";
import { cuandoRelativo, type AgenteRegistro } from "@/lib/agentes/registro";
import { useCuentasAgente } from "@/hooks/useAgenteConstructor";
import { pasosDeConexion } from "@/lib/agentes/conexion";
import { AVISO_SECRETO, CADENCIAS, FUENTES_KAWIIL, pareceSecreto, type MensajeChat, type PropuestaAgente } from "../../../supabase/functions/_shared/agenteConstructor";

// Chat especializado para crear agentes (solo Dirección). El chat propone; nada se crea hasta que la persona pulsa «Crear agente».
const SALUDO = "Hola, soy el Constructor de Agentes. Cuéntame qué agente necesitas, por ejemplo: «un oficial de cumplimiento para Vizum que vigile sus documentos y me entregue un informe semanal». Yo te hago las preguntas que falten y te dejo una propuesta para que la revises antes de crearlo.";

function Lista({ titulo, items }: { titulo: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <ul className="list-disc pl-5 text-sm">{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}

export function TarjetaPropuesta({ p, onCrear, creando, error }: { p: PropuestaAgente; onCrear: () => void; creando: boolean; error: string | null }) {
  return (
    <div className="zen-glass space-y-3 rounded-2xl border border-primary/30 p-4" data-testid="constructor-propuesta">
      <div>
        <p className="text-base font-semibold">{p.nombre_visible}</p>
        <p className="text-sm text-muted-foreground">{p.rol}{p.cliente ? ` · ${p.cliente}` : ""}</p>
      </div>
      <p className="text-sm">{p.descripcion}</p>
      <div><p className="text-xs font-medium text-muted-foreground">Misión</p><p className="text-sm">{p.mision}</p></div>
      <Lista titulo="Qué sabe hacer" items={p.capacidades} />
      <Lista titulo="Qué entrega" items={p.entregables} />
      {p.informes && <div><p className="text-xs font-medium text-muted-foreground">Informes</p><p className="text-sm">{p.informes}</p></div>}
      <Lista titulo="Fuentes que declara (hoy solo funcionan: tareas del despacho, el cliente de la tarea y el conocimiento indexado; el resto aún no tiene conector)" items={p.fuentes.map((f) => FUENTES_KAWIIL[f])} />
      <p className="text-sm"><span className="text-xs font-medium text-muted-foreground">Cadencia: </span>{CADENCIAS[p.cadencia]}{p.cadencia !== "bajo_demanda" && " · queda sin programar: actívala en la pestaña «Programar»"}</p>
      <Lista titulo="Internet: solo estos dominios" items={p.dominios_permitidos} />
      <Lista titulo="Páginas que se le dejan" items={p.paginas.map((x) => `${x.titulo}: ${x.url}`)} />
      {p.credenciales.length > 0 && (
        <div data-testid="constructor-credenciales">
          <Lista titulo="Accesos por 1Password (solo la referencia; la contraseña nunca se guarda en Kawiil. Cada tarea exige tu autorización y el agente solo consulta)" items={p.credenciales.map((c) => `${c.etiqueta} → ${c.referencia}${c.dominio ? ` · ${c.dominio}` : ""}`)} />
        </div>
      )}
      <Lista titulo="Límites y cuándo escala a una persona" items={p.limites} />
      <p className="text-xs text-muted-foreground">Se crea en el registro de agentes, en reposo. Solo prepara borradores y lee dentro de Kawiil; la conexión real con tus fuentes depende del servicio de agentes. Si quieres cambiar algo, díselo al chat y te dejo otra versión.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button onClick={onCrear} disabled={creando} data-testid="constructor-crear">
        {creando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Crear agente
      </Button>
    </div>
  );
}

// Borradores guardados: si se quedó a la mitad la creación de un agente, aquí se retoma tal cual (conversación y propuesta).
function Borradores({ lista, onContinuar, onEliminar, eliminando }: { lista: Borrador[]; onContinuar: (b: Borrador) => void; onEliminar: (id: string) => void; eliminando: boolean }) {
  if (lista.length === 0) return null;
  const ahora = new Date();
  return (
    <div className="zen-glass space-y-2 rounded-2xl p-3" data-testid="borradores">
      <p className="text-sm font-medium">Continúa donde te quedaste</p>
      <ul className="space-y-2">
        {lista.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 p-2 text-sm" data-testid={`borrador-${b.id}`}>
            <span className="min-w-0 flex-1"><strong className="block truncate">{b.titulo}</strong><span className="text-xs text-muted-foreground">{b.propuesta ? "Con propuesta lista · " : ""}{b.mensajes.length} mensajes · {cuandoRelativo(b.actualizado, ahora)}</span></span>
            <Button size="sm" onClick={() => onContinuar(b)} data-testid={`continuar-${b.id}`}>Continuar</Button>
            <Button size="sm" variant="outline" disabled={eliminando} onClick={() => onEliminar(b.id)} aria-label={`Eliminar borrador ${b.titulo}`} data-testid={`eliminar-${b.id}`}><Trash2 className="h-4 w-4" /></Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Después de crear: lo que le falta al agente para trabajar (lee su configuración real). Cada paso lleva a la pestaña con el agente ya elegido.
function ConectarAgente({ agente, creado, onIr }: { agente?: AgenteRegistro; creado: AgenteCreado; onIr?: (pestana: string, agenteId: string) => void }) {
  const cuentas = useCuentasAgente();
  const pasos = pasosDeConexion(agente);
  return (
    <div className="space-y-2" data-testid="conectar-agente">
      <p className="font-medium">Conecta a {creado.display_name} para que pueda trabajar</p>
      <p className="text-xs text-muted-foreground">Ahora está en reposo y solo conoce su descripción. Su señal en la Oficina aparece en unos minutos. Cada paso es opcional y puedes volver cuando quieras.</p>
      <ul className="space-y-2">
        {pasos.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 p-2" data-testid={`paso-${p.id}`}>
            <span className="min-w-0 flex-1"><span aria-hidden>{p.hecho ? "✅" : "⬜"} </span><strong>{p.titulo}</strong><span className="block text-xs text-muted-foreground">{p.detalle}</span></span>
            {p.id === "cuentas"
              ? <Button size="sm" variant={p.hecho ? "outline" : "default"} disabled={cuentas.isPending || !agente} onClick={() => cuentas.mutate({ agent_id: creado.id, activa: !p.hecho })} data-testid="paso-cuentas-boton">{p.hecho ? "Quitar" : "Activar"}</Button>
              : <Button size="sm" variant={p.hecho ? "outline" : "default"} onClick={() => onIr?.(p.pestana, creado.id)} data-testid={`ir-${p.id}`}>{p.hecho ? "Revisar" : p.boton}</Button>}
          </li>
        ))}
      </ul>
      {cuentas.isError && <p role="alert" className="text-sm text-destructive">{(cuentas.error as Error).message}</p>}
    </div>
  );
}

const nuevoId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)));

export function ConstructorAgentes({ onCreado, agentes = [], onIr }: { onCreado?: (a: AgenteCreado) => void; agentes?: AgenteRegistro[]; onIr?: (pestana: string, agenteId: string) => void }) {
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [texto, setTexto] = useState("");
  const [propuesta, setPropuesta] = useState<PropuestaAgente | null>(null);
  const [creado, setCreado] = useState<AgenteCreado | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const chat = useChatConstructor();
  const crear = useCrearAgente();
  const fin = useRef<HTMLDivElement>(null);
  const borradores = useBorradores();
  const guardar = useGuardarBorrador();
  const eliminar = useEliminarBorrador();
  const [borradorId, setBorradorId] = useState<string | null>(null);
  const [avisoGuardado, setAvisoGuardado] = useState<string | null>(null);
  useEffect(() => { fin.current?.scrollIntoView?.({ block: "nearest" }); }, [mensajes, propuesta, creado]);

  // Autoguardado: cuando el chat se detiene (no mientras piensa) y hay algo dicho, se guarda el borrador. Un secreto nunca se guarda.
  useEffect(() => {
    if (creado || chat.isPending || !guardable(mensajes)) return;
    const id = borradorId ?? nuevoId();
    const t = setTimeout(() => {
      if (!borradorId) setBorradorId(id);
      guardar.mutate({ id, mensajes, propuesta }, { onSuccess: () => setAvisoGuardado("Borrador guardado"), onError: () => setAvisoGuardado("No se pudo guardar el borrador") });
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensajes, propuesta, chat.isPending, creado]);

  const enviar = () => {
    const t = texto.trim();
    if (!t || chat.isPending) return;
    // Un secreto no sale del navegador: ni al modelo ni al servidor.
    if (pareceSecreto(t)) { setFallo(AVISO_SECRETO); setTexto(""); return; }
    const siguiente: MensajeChat[] = [...mensajes, { role: "user", content: t }];
    setMensajes(siguiente); setTexto(""); setFallo(null);
    chat.mutate(siguiente, {
      onSuccess: (r) => {
        if (r.secreto) { setMensajes(mensajes); setFallo(r.texto); return; }
        setMensajes((m) => [...m, { role: "assistant", content: r.texto }]);
        if (r.propuesta) { setPropuesta(r.propuesta); setCreado(null); }
        else if (r.avisos?.length) setFallo(`La propuesta quedó incompleta: ${r.avisos.join(" ")} Pídele al chat que la complete.`);
      },
      onError: (e) => setFallo((e as Error).message),
    });
  };
  const confirmar = () => {
    if (!propuesta) return;
    crear.mutate(propuesta, { onSuccess: (a) => { setCreado(a); setPropuesta(null); onCreado?.(a); if (borradorId) { eliminar.mutate(borradorId); setBorradorId(null); } } });
  };
  const nuevo = () => { setMensajes([]); setPropuesta(null); setCreado(null); setFallo(null); setBorradorId(null); setAvisoGuardado(null); crear.reset(); };
  const continuar = (b: Borrador) => { setMensajes(b.mensajes); setPropuesta(b.propuesta); setBorradorId(b.id); setCreado(null); setFallo(null); setAvisoGuardado(null); crear.reset(); };
  const descartar = (id: string) => { eliminar.mutate(id); if (id === borradorId) nuevo(); };

  return (
    <div className="space-y-3" data-testid="constructor">
      {mensajes.length === 0 && !creado && <Borradores lista={borradores.data ?? []} onContinuar={continuar} onEliminar={descartar} eliminando={eliminar.isPending} />}
      <div className="zen-glass space-y-3 rounded-3xl p-4">
        {mensajes.length > 0 && !creado && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" data-testid="borrador-estado">
            <span role="status">{avisoGuardado ?? "Se guarda solo mientras avanzas"}</span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={nuevo} data-testid="constructor-otro">Empezar otro</Button>
              {borradorId && <Button variant="outline" size="sm" onClick={() => descartar(borradorId)} data-testid="constructor-descartar">Descartar borrador</Button>}
            </span>
          </div>
        )}
        <div className="max-h-[50vh] space-y-3 overflow-y-auto" aria-live="polite">
          <p className="rounded-2xl bg-muted/50 p-3 text-sm">{SALUDO}</p>
          {mensajes.map((m, i) => (
            m.role === "user"
              ? <p key={i} data-testid={`constructor-msg-${m.role}`} className="ml-8 whitespace-pre-wrap rounded-2xl bg-primary/10 p-3 text-sm">{m.content}</p>
              : <div key={i} data-testid={`constructor-msg-${m.role}`} className="mr-8 rounded-2xl bg-muted/50 p-3 text-sm"><MarkdownAgente texto={m.content} /></div>
          ))}
          {chat.isPending && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Pensando…</p>}
          <div ref={fin} />
        </div>
        {fallo && <p role="alert" className="text-sm text-destructive" data-testid="constructor-error">{fallo}</p>}
        <div className="flex items-end gap-2">
          <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Describe el agente que necesitas…" aria-label="Mensaje para el Constructor de Agentes"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }} />
          <Button onClick={enviar} disabled={chat.isPending || !texto.trim()} aria-label="Enviar" data-testid="constructor-enviar"><Send className="h-4 w-4" /></Button>
        </div>
      </div>
      {propuesta && <TarjetaPropuesta p={propuesta} onCrear={confirmar} creando={crear.isPending} error={crear.isError ? (crear.error as Error).message : null} />}
      {creado && (
        <div className="zen-glass space-y-3 rounded-2xl p-4 text-sm" data-testid="constructor-creado" role="status">
          <div className="flex flex-wrap items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <span><strong>{creado.display_name}</strong> quedó en el registro de agentes, en reposo.</span>
            <Button variant="outline" size="sm" onClick={nuevo}>Crear otro</Button>
          </div>
          <ConectarAgente agente={agentes.find((a) => a.id === creado.id)} creado={creado} onIr={onIr} />
        </div>
      )}
    </div>
  );
}
