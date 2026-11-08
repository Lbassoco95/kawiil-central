import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatConstructor, useCrearAgente, type AgenteCreado } from "@/hooks/useAgenteConstructor";
import { CADENCIAS, FUENTES_KAWIIL, type MensajeChat, type PropuestaAgente } from "../../../supabase/functions/_shared/agenteConstructor";

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
      <Lista titulo="Conectado a (solo lectura)" items={p.fuentes.map((f) => FUENTES_KAWIIL[f])} />
      <p className="text-sm"><span className="text-xs font-medium text-muted-foreground">Cadencia: </span>{CADENCIAS[p.cadencia]}</p>
      <Lista titulo="Límites y cuándo escala a una persona" items={p.limites} />
      <p className="text-xs text-muted-foreground">Se crea en el registro de agentes, en reposo. Solo prepara borradores y lee dentro de Kawiil; la conexión real con tus fuentes depende del servicio de agentes. Si quieres cambiar algo, díselo al chat y te dejo otra versión.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button onClick={onCrear} disabled={creando} data-testid="constructor-crear">
        {creando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Crear agente
      </Button>
    </div>
  );
}

export function ConstructorAgentes({ onCreado }: { onCreado?: (a: AgenteCreado) => void }) {
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [texto, setTexto] = useState("");
  const [propuesta, setPropuesta] = useState<PropuestaAgente | null>(null);
  const [creado, setCreado] = useState<AgenteCreado | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const chat = useChatConstructor();
  const crear = useCrearAgente();
  const fin = useRef<HTMLDivElement>(null);
  useEffect(() => { fin.current?.scrollIntoView?.({ block: "nearest" }); }, [mensajes, propuesta, creado]);

  const enviar = () => {
    const t = texto.trim();
    if (!t || chat.isPending) return;
    const siguiente: MensajeChat[] = [...mensajes, { role: "user", content: t }];
    setMensajes(siguiente); setTexto(""); setFallo(null);
    chat.mutate(siguiente, {
      onSuccess: (r) => {
        setMensajes((m) => [...m, { role: "assistant", content: r.texto }]);
        if (r.propuesta) { setPropuesta(r.propuesta); setCreado(null); }
        else if (r.avisos?.length) setFallo(`La propuesta quedó incompleta: ${r.avisos.join(" ")} Pídele al chat que la complete.`);
      },
      onError: (e) => setFallo((e as Error).message),
    });
  };
  const confirmar = () => {
    if (!propuesta) return;
    crear.mutate(propuesta, { onSuccess: (a) => { setCreado(a); setPropuesta(null); onCreado?.(a); } });
  };
  const nuevo = () => { setMensajes([]); setPropuesta(null); setCreado(null); setFallo(null); crear.reset(); };

  return (
    <div className="space-y-3" data-testid="constructor">
      <div className="zen-glass space-y-3 rounded-3xl p-4">
        <div className="max-h-[50vh] space-y-3 overflow-y-auto" aria-live="polite">
          <p className="rounded-2xl bg-muted/50 p-3 text-sm">{SALUDO}</p>
          {mensajes.map((m, i) => (
            <p key={i} data-testid={`constructor-msg-${m.role}`} className={`whitespace-pre-wrap rounded-2xl p-3 text-sm ${m.role === "user" ? "ml-8 bg-primary/10" : "mr-8 bg-muted/50"}`}>{m.content}</p>
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
        <div className="zen-glass flex flex-wrap items-center gap-3 rounded-2xl p-4 text-sm" data-testid="constructor-creado" role="status">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          <span><strong>{creado.display_name}</strong> quedó en el registro de agentes, en reposo. Ya puedes darle instrucciones en la pestaña «Instrucciones».</span>
          <Button variant="outline" size="sm" onClick={nuevo}>Crear otro</Button>
        </div>
      )}
    </div>
  );
}
