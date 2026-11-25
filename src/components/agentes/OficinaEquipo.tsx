import { Link } from "react-router-dom";
import { EscritorioAgente, EstilosOficina } from "@/components/agentes/escritorio";
import { SALAS } from "@/lib/agentes/salas";
import { departamentoDe } from "@/lib/agentes/departamentos";
import { estadoVisible, esSoloLectura, urlChat } from "@/lib/agentes/chat";
import { llamadasDeOficina, resumenLlamadas, textoAgentes, type Oficina } from "@/lib/agentes/equipos";
import { esperasDe } from "@/lib/agentes/actividad";
import { nombreAgente, type AgenteRegistro, type TareaAgente } from "@/lib/agentes/registro";
import type { FiguraOficina } from "@/lib/agentes/oficina";

// Pantalla de una oficina de equipo (R1.b a R1.d): un nivel más dentro de la sala (Todos los departamentos → sala → oficina).
// Jefe de oficina, agentes que creó (quién, cuándo y para qué), lugar libre, organigrama, llamadas entre agentes y cómo crece la oficina.
// Solo lectura. Todo sale del registro de agentes y de las tareas reales; sin datos de ejemplo ni campos entre corchetes.
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "fecha no registrada");
const hora = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ESTADO_LLAMADA = { en_curso: "En curso", terminada: "Terminó", con_error: "Con error", otra: "Sin resultado" } as const;
const MARCA_LLAMADA = { en_curso: "●", terminada: "✓", con_error: "✕", otra: "–" } as const;

function Estado({ f, esperas, agente }: { f?: FiguraOficina; esperas: number; agente?: AgenteRegistro }) {
  if (!f) return null;
  const e = estadoVisible(f.estado, esperas, esSoloLectura(agente?.config));
  return <span className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-xs" data-testid={`oficina-estado-${f.id}`}><span aria-hidden>{e.marca}</span>{e.texto}</span>;
}

export function OficinaEquipo({ oficina, jefe, agentes, figuras, tareas, ahora, nombreSala, onVolverSala }: {
  oficina: Oficina; jefe: AgenteRegistro; agentes: AgenteRegistro[]; figuras: FiguraOficina[]; tareas: TareaAgente[]; ahora: Date; nombreSala: string; onVolverSala: () => void;
}) {
  const fig = (id: string) => figuras.find((f) => f.id === id);
  const nombreDe = (id: string) => { const a = agentes.find((x) => x.id === id); return a ? nombreAgente(a) : "otro agente"; };
  const fJefe = fig(jefe.id);
  const equipoOrigen = SALAS[departamentoDe(jefe).clave]?.zonas.find(([, cs]) => cs.includes(jefe.name))?.[0] ?? departamentoDe(jefe).nombre;
  const llamadas = llamadasDeOficina(oficina, tareas), resumen = resumenLlamadas(llamadas, ahora);
  const n = oficina.miembros.length;
  return (
    <section className="space-y-4" aria-label={oficina.nombre} data-testid="oficina-equipo">
      <EstilosOficina />
      <header className="zen-glass flex flex-wrap items-center justify-between gap-3 rounded-3xl p-4" style={{ borderColor: oficina.tinte, background: `${oficina.tinte}66` }}>
        <div>
          <h2 className="text-lg font-medium" data-testid="oficina-nombre">{oficina.nombre}</h2>
          <p className="text-sm text-muted-foreground" data-testid="oficina-contador">{textoAgentes(n)} · dentro de la sala de {nombreSala}</p>
        </div>
        <button type="button" onClick={onVolverSala} data-testid="oficina-volver-sala" className="min-h-11 rounded-full border border-border/60 bg-background/70 px-4 text-sm">Volver a la sala</button>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="zen-glass space-y-3 rounded-3xl p-4" aria-label="Jefe de oficina" data-testid="oficina-jefe">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Jefe de oficina</h3>
          <div className="flex items-start gap-3">
            {fJefe && <div className="shrink-0"><EscritorioAgente f={fJefe} compacto /></div>}
            <div className="min-w-0 space-y-1">
              <p className="text-base font-medium">{oficina.jefeNombre} <Estado f={fJefe} esperas={esperasDe(jefe.id, tareas)} agente={jefe} /></p>
              <p className="text-sm">Dirige esta oficina.</p>
              <p className="text-sm text-muted-foreground" data-testid="oficina-jefe-equipos">También trabaja en el equipo «{equipoOrigen}» de la sala, donde no dirige.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={urlChat(jefe.id)} className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground" data-testid="oficina-hablar">Hablar con {oficina.jefeNombre}</Link>
            <a href={urlChat(jefe.id)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-border/60 px-4 text-sm" data-testid="oficina-jefe-pestana">Abrir en pestaña</a>
          </div>
        </section>

        <section className="zen-glass space-y-3 rounded-3xl p-4" aria-label="Agentes que creó" data-testid="oficina-miembros">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agentes que {oficina.jefeNombre} creó · {textoAgentes(n)}</h3>
          <ul className="space-y-2">
            {oficina.miembros.map(({ agente, creacion }) => (
              <li key={agente.id} className="rounded-2xl border border-border/50 bg-background/50 p-3" data-testid={`oficina-miembro-${agente.id}`}>
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{nombreAgente(agente)} <Estado f={fig(agente.id)} esperas={esperasDe(agente.id, tareas)} agente={agente} /></p>
                <p className="text-xs text-muted-foreground">Creado por {oficina.jefeNombre} · {fecha(creacion.cuando)}</p>
                {creacion.para && <p className="text-xs">Para qué: <span className="text-muted-foreground">{creacion.para}</span></p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link to={urlChat(agente.id)} className="inline-flex min-h-11 items-center rounded-full border border-border/60 px-4 text-sm" data-testid={`oficina-chat-${agente.id}`}>Abrir el chat</Link>
                  <a href={urlChat(agente.id)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-border/60 px-4 text-sm">Abrir en pestaña</a>
                </div>
              </li>
            ))}
            <li className="rounded-2xl border-2 border-dashed p-3" style={{ borderColor: oficina.tinte }} data-testid="oficina-lugar-libre">
              <p className="text-sm font-medium">Lugar libre</p>
              <p className="text-xs text-muted-foreground">Cada agente que {oficina.jefeNombre} cree recibe un escritorio aquí. El piso de otro color y el letrero muestran que es su equipo y no el de la sala general.</p>
              <Link to={urlChat(jefe.id)} className="mt-2 inline-flex min-h-11 items-center rounded-full border border-border/60 bg-background/70 px-4 text-sm" data-testid="oficina-pedir-crear">Pedirle a {oficina.jefeNombre} que cree un agente</Link>
            </li>
          </ul>
        </section>
      </div>

      <section className="zen-glass space-y-3 rounded-3xl p-4" aria-label="Organigrama" data-testid="oficina-organigrama">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quién dirige a quién</h3>
        <ul className="space-y-1 text-sm">
          <li><strong>Dirección</strong>
            <ul className="ml-4 mt-1 space-y-1 border-l border-border/60 pl-4">
              <li data-testid="organigrama-jefe">{oficina.jefeNombre} <span className="text-muted-foreground">· jefe de oficina (dirige en «{oficina.nombre}»; en «{equipoOrigen}» no dirige)</span>
                <ul className="ml-4 mt-1 space-y-1 border-l border-border/60 pl-4">
                  {oficina.miembros.map(({ agente }) => <li key={agente.id} data-testid={`organigrama-${agente.id}`}>{nombreAgente(agente)} <span className="text-muted-foreground">· reporta a {oficina.jefeNombre}</span></li>)}
                </ul>
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <section className="zen-glass space-y-3 rounded-3xl p-4" aria-label="Llamadas entre agentes" data-testid="oficina-llamadas">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Llamadas entre agentes de esta oficina</h3>
        <p className="text-sm" data-testid="oficina-llamadas-resumen">Esta semana: {resumen.semana} · En curso: {resumen.enCurso} · Con error: {resumen.conError}</p>
        {llamadas.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="oficina-llamadas-vacio">Aún no hay llamadas entre los agentes de esta oficina.</p> : (
          <ul className="space-y-2">
            {llamadas.slice(0, 20).map((l) => (
              <li key={l.id} className="rounded-2xl border border-border/50 bg-background/50 p-3 text-sm" data-testid={`llamada-${l.id}`}>
                <p><strong>{nombreDe(l.de)}</strong> llamó a <strong>{nombreDe(l.a)}</strong> · <span className="whitespace-nowrap"><span aria-hidden>{MARCA_LLAMADA[l.estado]}</span> {ESTADO_LLAMADA[l.estado]}</span> · {hora(l.cuando)}</p>
                <p className="text-xs text-muted-foreground">Tipo de trabajo: {l.tipo.replace(/_/g, " ")}</p>
                <Link to={urlChat(l.de, { conv: l.conversacionOrigen })} className="mt-1 inline-flex min-h-11 items-center rounded-full border border-border/60 px-4 text-sm" data-testid={`llamada-abrir-${l.id}`}>Abrir el chat</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="zen-glass space-y-2 rounded-3xl p-4" aria-label="Cómo crece la oficina" data-testid="oficina-crece">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cómo crece esta oficina</h3>
        <p className="text-sm text-muted-foreground">Cada agente nuevo suma un escritorio y el letrero actualiza el número. Siempre queda un lugar libre. Si se llena, la oficina se ensancha dentro de la sala sin cambiar su color ni su letrero.</p>
        <h4 className="pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Historial</h4>
        <ul className="space-y-1 text-sm" data-testid="oficina-historial">
          {oficina.abierta && <li>Se abrió el {fecha(oficina.abierta)}.</li>}
          {oficina.miembros.map(({ agente, creacion }) => <li key={agente.id}>{fecha(creacion.cuando)} · {oficina.jefeNombre} creó a {nombreAgente(agente)}{creacion.para ? ` — ${creacion.para}` : ""}</li>)}
        </ul>
      </section>
    </section>
  );
}
