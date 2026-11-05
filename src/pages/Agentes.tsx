import { Link } from "react-router-dom";
import { Bot } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { AgentesRegistro } from "@/components/marketing/AgentesRegistro";
import { useAgentesRegistro, useTareasAgentes } from "@/hooks/useAgentesRegistro";

// Módulo Agentes · fase 1 (solo lectura): agentes de Cerebro / kawiil-agents y su historial de tareas.
// No escribe en la base ni despacha tareas. Los agentes de Marketing tienen su vista en /marketing.
export default function Agentes() {
  const agentes = useAgentesRegistro();
  const tareas = useTareasAgentes();
  return (
    <AppLayout>
      <div className="space-y-6 p-4 md:p-6">
        <PageHeader title="Agentes" description="Quién está activo, qué hizo y si falló. Solo lectura." icon={<Bot className="h-5 w-5" />} />
        <p className="text-xs text-muted-foreground">
          Los agentes de Marketing se ven en <Link className="underline" to="/marketing">Marketing → Agentes</Link>.
        </p>
        <AgentesRegistro sinMarketing agentes={agentes.data ?? []} tareas={tareas.data ?? []}
          estadoAgentes={agentes.isError ? "error" : agentes.isLoading ? "cargando" : "ok"}
          estadoTareas={tareas.isError ? "error" : tareas.isLoading ? "cargando" : "ok"} />
      </div>
    </AppLayout>
  );
}
