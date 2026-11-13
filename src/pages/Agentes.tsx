import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { AgentesRegistro } from "@/components/marketing/AgentesRegistro";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Oficina } from "@/components/agentes/Oficina";
import { ConstructorAgentes } from "@/components/agentes/ConstructorAgentes";
import { InstruirAgente } from "@/components/agentes/InstruirAgente";
import { ProgramarAgente } from "@/components/agentes/ProgramarAgente";
import { EnsenarAgente } from "@/components/agentes/EnsenarAgente";
import { DocumentosAgente } from "@/components/agentes/DocumentosAgente";
import { SeguimientoAgentes } from "@/components/agentes/SeguimientoAgentes";
import { TrabajosAgente } from "@/components/agentes/TrabajosAgente";
import { agentesDelModulo, esAgenteLegal, resumenServicio } from "@/lib/agentes/registro";
import { datosDemo, esAgenteDelEquipo, figurasDeLaBanda, figurasOficina, filtrarAmbito, type AmbitoOficina } from "@/lib/agentes/oficina";
import { BandaEquipo, FigurasContext } from "@/components/agentes/BandaEquipo";
import { useAgentesRegistro, useErroresAgentes, useTareasAgentes } from "@/hooks/useAgentesRegistro";

// Módulo Agentes: oficina y tablas (solo lectura) + Constructor de agentes y envío de instrucciones (solo Dirección, vía funciones).
// La pantalla no escribe en la base directamente: crear agentes pasa por `agente-constructor` y las instrucciones por `dispatch-to-agent`. Los agentes de Marketing tienen su vista en /marketing.
export default function Agentes() {
  const agentes = useAgentesRegistro();
  const tareas = useTareasAgentes();
  const errores = useErroresAgentes((agentes.data ?? []).filter(esAgenteLegal).map((a) => a.id));
  const [reloj, setReloj] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setReloj(new Date()), 60_000); return () => clearInterval(t); }, []);
  const [demo, setDemo] = useState(false);
  const [pestana, setPestana] = useState("oficina");
  const [conectar, setConectar] = useState<string | null>(null);   // agente recién creado al que se le abre Documentos / Programar / Instrucciones
  const [seguir, setSeguir] = useState<string | null>(null);   // solicitud que se abre en Seguimiento al venir de Instrucciones
  const [ambito, setAmbito] = useState<AmbitoOficina>("todos");
  const reales = useMemo(() => agentesDelModulo(agentes.data ?? []), [agentes.data]);
  const servicio = useMemo(() => resumenServicio(reales, reloj), [reales, reloj]);
  const fuente = useMemo(() => (demo ? datosDemo(reloj) : { agentes: reales, tareas: tareas.data ?? [] }), [demo, reales, tareas.data, reloj]);
  const figuras = useMemo(() => figurasOficina(demo ? fuente.agentes : filtrarAmbito(fuente.agentes, ambito), fuente.tareas, reloj), [fuente, reloj, demo, ambito]);
  // Siempre a la vista: todos los agentes reales (sin filtro de ámbito), con quien trabaja primero.
  const figurasReales = useMemo(() => figurasOficina(reales, tareas.data ?? [], reloj), [reales, tareas.data, reloj]);
  const banda = useMemo(() => figurasDeLaBanda(figurasReales, new Set(reales.filter(esAgenteDelEquipo).map((a) => a.id))), [figurasReales, reales]);
  const [verEnOficina, setVerEnOficina] = useState<string | null>(null);
  const cargando = !demo && agentes.isLoading;
  return (
    <AppLayout>
     <FigurasContext.Provider value={figurasReales}>
      <div className="space-y-6 p-4 md:p-6">
        <PageHeader title="Agentes" description="Quién está activo, qué hizo y si falló. Crea agentes y dales instrucciones." icon={<Bot className="h-5 w-5" />} />
        <p className="text-xs text-muted-foreground">
          Los agentes de Marketing se ven en <Link className="underline" to="/marketing">Marketing → Agentes</Link>.
        </p>
        {!demo && <BandaEquipo figuras={banda} onElegir={(id) => { setVerEnOficina(id); setAmbito("todos"); setPestana("oficina"); }} />}
        <Tabs value={pestana} onValueChange={setPestana}>
          <TabsList>
            <TabsTrigger value="oficina">Oficina</TabsTrigger>
            <TabsTrigger value="tablas">Tablas</TabsTrigger>
            <TabsTrigger value="crear">Crear agente</TabsTrigger>
            <TabsTrigger value="instrucciones">Instrucciones</TabsTrigger>
            <TabsTrigger value="seguimiento">Seguimiento</TabsTrigger>
            <TabsTrigger value="documentos">Documentos</TabsTrigger>
            <TabsTrigger value="ensenar">Enseñar</TabsTrigger>
            <TabsTrigger value="programar">Programar</TabsTrigger>
          </TabsList>
          <TabsContent value="oficina" className="mt-4 space-y-3">
            {!demo && servicio.estado !== "en_linea" && (
              <p className="zen-glass rounded-2xl p-3 text-sm" data-testid="oficina-sin-servicio">
                El servicio de agentes no da señal reciente, así que la oficina muestra el último estado conocido. Puedes ver cómo se vería con actividad.
              </p>
            )}
            {!demo && (
              <div className="flex gap-2 text-xs" role="group" aria-label="Qué agentes ver en la oficina">
                {(["todos", "legales", "equipo"] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={ambito === v} data-testid={`ambito-${v}`} onClick={() => setAmbito(v)}
                    className={`rounded-full border px-3 py-1 ${ambito === v ? "border-primary/60 bg-primary/10" : "border-border/60"}`}>
                    {v === "legales" ? "Agentes legales" : v === "equipo" ? "Mi equipo" : "Todos los agentes"}
                  </button>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Ver demostración con datos de ejemplo</label>
            {cargando ? <p className="text-sm text-muted-foreground">Leyendo el registro de agentes…</p>
              : agentes.isError && !demo ? <p className="text-sm text-muted-foreground">No pudimos leer el registro de agentes. Inténtalo de nuevo.</p>
              : <Oficina key={verEnOficina ?? "oficina"} seleccionInicial={verEnOficina} figuras={figuras} ahora={reloj} demo={demo} detalleExtra={demo ? undefined : (f) => <TrabajosAgente agentId={f.id} nombre={f.nombre} ahora={reloj} />} />}
          </TabsContent>
          <TabsContent value="tablas" className="mt-4">
            <AgentesRegistro sinMarketing errores={errores.data ?? []} agentes={agentes.data ?? []} tareas={tareas.data ?? []}
              estadoAgentes={agentes.isError ? "error" : agentes.isLoading ? "cargando" : "ok"}
              estadoTareas={tareas.isError ? "error" : tareas.isLoading ? "cargando" : "ok"} />
          </TabsContent>
          <TabsContent value="crear" className="mt-4"><ConstructorAgentes agentes={reales} onIr={(p, id) => { setConectar(id); setPestana(p); }} /></TabsContent>
          <TabsContent value="instrucciones" className="mt-4"><InstruirAgente key={conectar ?? "instruir"} agenteInicial={conectar ?? undefined} agentes={reales} onVerSeguimiento={(id) => { setSeguir(id ?? null); setPestana("seguimiento"); }} /></TabsContent>
          <TabsContent value="seguimiento" className="mt-4"><SeguimientoAgentes key={seguir ?? "lista"} ahora={reloj} seleccionInicial={seguir} /></TabsContent>
          <TabsContent value="documentos" className="mt-4"><DocumentosAgente key={conectar ?? "docs"} agenteInicial={conectar ?? undefined} agentes={reales} /></TabsContent>
          <TabsContent value="ensenar" className="mt-4"><EnsenarAgente agentes={reales} tareas={tareas.data ?? []} ahora={reloj} /></TabsContent>
          <TabsContent value="programar" className="mt-4"><ProgramarAgente key={conectar ?? "prog"} agenteInicial={conectar ?? undefined} agentes={reales} /></TabsContent>
        </Tabs>
      </div>
     </FigurasContext.Provider>
    </AppLayout>
  );
}
