import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { AgentesRegistro } from "@/components/marketing/AgentesRegistro";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Oficina } from "@/components/agentes/Oficina";
import { agentesDelModulo, esAgenteLegal, resumenServicio } from "@/lib/agentes/registro";
import { datosDemo, figurasOficina } from "@/lib/agentes/oficina";
import { useAgentesRegistro, useErroresAgentes, useTareasAgentes } from "@/hooks/useAgentesRegistro";

// Módulo Agentes · fases 1 y 2 (solo lectura): oficina y tablas: agentes de Cerebro / kawiil-agents y su historial de tareas.
// No escribe en la base ni despacha tareas. Los agentes de Marketing tienen su vista en /marketing.
export default function Agentes() {
  const agentes = useAgentesRegistro();
  const tareas = useTareasAgentes();
  const errores = useErroresAgentes((agentes.data ?? []).filter(esAgenteLegal).map((a) => a.id));
  const [reloj, setReloj] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setReloj(new Date()), 60_000); return () => clearInterval(t); }, []);
  const [demo, setDemo] = useState(false);
  const reales = useMemo(() => agentesDelModulo(agentes.data ?? []), [agentes.data]);
  const servicio = useMemo(() => resumenServicio(reales, reloj), [reales, reloj]);
  const fuente = useMemo(() => (demo ? datosDemo(reloj) : { agentes: reales, tareas: tareas.data ?? [] }), [demo, reales, tareas.data, reloj]);
  const figuras = useMemo(() => figurasOficina(fuente.agentes, fuente.tareas, reloj), [fuente, reloj]);
  const cargando = !demo && agentes.isLoading;
  return (
    <AppLayout>
      <div className="space-y-6 p-4 md:p-6">
        <PageHeader title="Agentes" description="Quién está activo, qué hizo y si falló. Solo lectura." icon={<Bot className="h-5 w-5" />} />
        <p className="text-xs text-muted-foreground">
          Los agentes de Marketing se ven en <Link className="underline" to="/marketing">Marketing → Agentes</Link>.
        </p>
        <Tabs defaultValue="oficina">
          <TabsList>
            <TabsTrigger value="oficina">Oficina</TabsTrigger>
            <TabsTrigger value="tablas">Tablas</TabsTrigger>
          </TabsList>
          <TabsContent value="oficina" className="mt-4 space-y-3">
            {!demo && servicio.estado !== "en_linea" && (
              <p className="zen-glass rounded-2xl p-3 text-sm" data-testid="oficina-sin-servicio">
                El servicio de agentes no da señal reciente, así que la oficina muestra el último estado conocido. Puedes ver cómo se vería con actividad.
              </p>
            )}
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Ver demostración con datos de ejemplo</label>
            {cargando ? <p className="text-sm text-muted-foreground">Leyendo el registro de agentes…</p>
              : agentes.isError && !demo ? <p className="text-sm text-muted-foreground">No pudimos leer el registro de agentes. Inténtalo de nuevo.</p>
              : <Oficina figuras={figuras} ahora={reloj} demo={demo} />}
          </TabsContent>
          <TabsContent value="tablas" className="mt-4">
            <AgentesRegistro sinMarketing errores={errores.data ?? []} agentes={agentes.data ?? []} tareas={tareas.data ?? []}
              estadoAgentes={agentes.isError ? "error" : agentes.isLoading ? "cargando" : "ok"}
              estadoTareas={tareas.isError ? "error" : tareas.isLoading ? "cargando" : "ok"} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
