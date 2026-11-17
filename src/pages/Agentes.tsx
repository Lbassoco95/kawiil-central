import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Bot } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { AgentesRegistro } from "@/components/marketing/AgentesRegistro";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarraTareas } from "@/components/agentes/BarraTareas";
import { VistaOficina } from "@/components/agentes/VistaOficina";
import { ConstructorAgentes } from "@/components/agentes/ConstructorAgentes";
import { FigurasContext } from "@/components/agentes/BandaEquipo";
import { IndicadorEnVivo } from "@/components/agentes/IndicadorEnVivo";
import { agentesDelModulo, esAgenteLegal, resumenServicio } from "@/lib/agentes/registro";
import { figurasOficina } from "@/lib/agentes/oficina";
import { destinoDePestanaVieja, escribirVista, leerPestanaEscritorio, leerVista, type PestanaEscritorio, type Vista } from "@/lib/agentes/vistas";
import { useAgentesRegistro, useErroresAgentes, useTareasAgentes } from "@/hooks/useAgentesRegistro";
import { useAgentesEnVivo } from "@/hooks/useAgentesEnVivo";

// Módulo Agentes: dos pestañas. «Oficina» (plano → sala de la isla → escritorio del agente, con todo lo de cada agente dentro de su escritorio) y
// «Administrar» (Crear agente + Tablas). Las 12 pestañas de antes ya no existen: sus enlaces (`?pestana=memoria`, etc.) se traducen con PESTANAS_VIEJAS.
// La pantalla no escribe en la base directamente: crear agentes pasa por `agente-constructor` y las instrucciones por `dispatch-to-agent`.
type Seccion = "oficina" | "administrar";
// Pestaña del escritorio a la que lleva cada paso del «conectar agente» del Constructor (nombres viejos de pestaña).
const SECCION_PARAM = "pestana";

export default function Agentes() {
  const agentes = useAgentesRegistro();
  const tareas = useTareasAgentes();
  const enVivo = useAgentesEnVivo();   // refresca solo cuando un agente empieza o termina algo
  const errores = useErroresAgentes((agentes.data ?? []).filter(esAgenteLegal).map((a) => a.id));
  const [reloj, setReloj] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setReloj(new Date()), 60_000); return () => clearInterval(t); }, []);
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();

  // Enlaces viejos: ?pestana=<una de las 12> se reescribe a la nueva organización (sin dejar entrada en el historial).
  const viejo = destinoDePestanaVieja(params.get(SECCION_PARAM));
  useEffect(() => {
    if (!viejo) return;
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (viejo.pestana === "administrar") n.set(SECCION_PARAM, "administrar"); else n.delete(SECCION_PARAM);
      if (viejo.escritorio && n.get("vista")?.startsWith("agente:")) n.set("tab", viejo.escritorio);
      return n;
    }, { replace: true });
  }, [viejo, setParams]);
  const seccion: Seccion = (viejo ? viejo.pestana : params.get(SECCION_PARAM)) === "administrar" ? "administrar" : "oficina";
  const vista = useMemo(() => leerVista(params.get("vista")), [params]);
  const pestanaEscritorio = leerPestanaEscritorio(params.get("tab"));
  const cambiarSeccion = (s: string) => setParams((p) => { const n = new URLSearchParams(p); if (s === "administrar") n.set(SECCION_PARAM, "administrar"); else n.delete(SECCION_PARAM); return n; });
  const cambiarVista = (v: Vista, tab?: PestanaEscritorio) => setParams((p) => {
    const n = new URLSearchParams(p); const x = escribirVista(v);
    if (x) n.set("vista", x); else n.delete("vista");
    if (v.tipo !== "agente") n.delete("tab"); else if (tab) n.set("tab", tab);
    n.delete(SECCION_PARAM);
    return n;
  });
  const cambiarPestanaEscritorio = (t: PestanaEscritorio) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; });

  const reales = useMemo(() => agentesDelModulo(agentes.data ?? []), [agentes.data]);
  const servicio = useMemo(() => resumenServicio(reales, reloj), [reales, reloj]);
  // El plano incluye también a Marketing (su módulo sigue aparte en /marketing): todos los agentes del registro.
  const todasLasFiguras = useMemo(() => figurasOficina(agentes.data ?? [], tareas.data ?? [], reloj), [agentes.data, tareas.data, reloj]);
  const figurasReales = useMemo(() => figurasOficina(reales, tareas.data ?? [], reloj), [reales, tareas.data, reloj]);
  const cargando = agentes.isLoading;

  // Desde la barra de tareas: «Abrir la conversación» lleva al escritorio del agente que recibió esa tarea.
  const abrirConversacion = (taskId?: string) => {
    const t = (tareas.data ?? []).find((x) => x.id === taskId);
    if (t?.agent_id) cambiarVista({ tipo: "agente", id: t.agent_id }, "conversaciones"); else cambiarVista({ tipo: "plano" });
  };
  // Desde el Constructor: Instrucciones / Documentos / Programar de un agente recién creado → su escritorio, en la pestaña que corresponde.
  const irAlEscritorio = (pestanaVieja: string, id: string) => cambiarVista({ tipo: "agente", id }, destinoDePestanaVieja(pestanaVieja)?.escritorio ?? "conversaciones");

  return (
    <AppLayout>
     <FigurasContext.Provider value={figurasReales}>
      <div className="space-y-6 p-4 md:p-6">
        <PageHeader title="Agentes" description="Quién está activo, qué hizo y si falló. Crea agentes y dales instrucciones." icon={<Bot className="h-5 w-5" />} />
        <p className="text-xs text-muted-foreground">
          Los agentes de Marketing se ven en <Link className="underline" to="/marketing">Marketing → Agentes</Link>.
        </p>
        <BarraTareas agentes={reales} onVerSeguimiento={abrirConversacion} />
        <IndicadorEnVivo estado={enVivo} actualizadoEn={Math.max(agentes.dataUpdatedAt, tareas.dataUpdatedAt)} />
        <Tabs value={seccion} onValueChange={cambiarSeccion}>
          <TabsList>
            <TabsTrigger value="oficina" data-testid="seccion-oficina">Oficina</TabsTrigger>
            <TabsTrigger value="administrar" data-testid="seccion-administrar">Administrar</TabsTrigger>
          </TabsList>
          <TabsContent value="oficina" className="mt-4 space-y-3">
            {servicio.estado !== "en_linea" && (
              <p className="zen-glass rounded-2xl p-3 text-sm" data-testid="oficina-sin-servicio">
                El servicio de agentes no da señal reciente, así que la oficina muestra el último estado conocido.
              </p>
            )}
            {cargando ? <p className="text-sm text-muted-foreground">Leyendo el registro de agentes…</p>
              : agentes.isError ? <p className="text-sm text-muted-foreground">No pudimos leer el registro de agentes. Inténtalo de nuevo.</p>
              : <VistaOficina figuras={todasLasFiguras} agentes={agentes.data ?? []} tareas={tareas.data ?? []} ahora={reloj} vista={vista} onVista={(v) => cambiarVista(v)}
                  alAbrirMarketing={() => navegar("/marketing")} onElegirAgente={(id) => cambiarVista({ tipo: "agente", id })} pestana={pestanaEscritorio} onPestana={cambiarPestanaEscritorio} />}
          </TabsContent>
          <TabsContent value="administrar" className="mt-4 space-y-6">
            <section aria-label="Crear agente" className="space-y-3" data-testid="administrar-crear">
              <h2 className="text-lg font-medium">Crear agente</h2>
              <ConstructorAgentes agentes={reales} onIr={irAlEscritorio} />
            </section>
            <section aria-label="Tablas" className="space-y-3" data-testid="administrar-tablas">
              <h2 className="text-lg font-medium">Tablas</h2>
              <AgentesRegistro sinMarketing errores={errores.data ?? []} agentes={agentes.data ?? []} tareas={tareas.data ?? []}
                estadoAgentes={agentes.isError ? "error" : agentes.isLoading ? "cargando" : "ok"}
                estadoTareas={tareas.isError ? "error" : tareas.isLoading ? "cargando" : "ok"} />
            </section>
          </TabsContent>
        </Tabs>
      </div>
     </FigurasContext.Provider>
    </AppLayout>
  );
}
