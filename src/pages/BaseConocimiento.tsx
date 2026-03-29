import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import {
  BookOpen, Building2, FolderKanban, Bot, BarChart3,
} from "lucide-react";
import { ClientsLearningTab } from "@/components/knowledge/ClientsLearningTab";
import { ProjectsLearningTab } from "@/components/knowledge/ProjectsLearningTab";
import { AgentsTab } from "@/components/knowledge/AgentsTab";
import { StatsTab } from "@/components/knowledge/StatsTab";

type TabKey = "clientes" | "proyectos" | "agentes" | "estadisticas";

const tabs: { key: TabKey; label: string; icon: typeof Building2 }[] = [
  { key: "clientes", label: "Por Cliente", icon: Building2 },
  { key: "proyectos", label: "Por Proyecto", icon: FolderKanban },
  { key: "agentes", label: "Agentes", icon: Bot },
  { key: "estadisticas", label: "Estadísticas", icon: BarChart3 },
];

const BaseConocimiento = () => {
  const [activeTab, setActiveTab] = useState<TabKey>("clientes");

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Conocimiento
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Dashboard de inteligencia: monitorea qué está aprendiendo el sistema, por cliente y por proyecto
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <Button
                key={t.key}
                variant="ghost"
                size="sm"
                className={`tab-pill gap-1.5 ${activeTab === t.key ? "tab-pill-active" : "tab-pill-inactive"}`}
                onClick={() => setActiveTab(t.key)}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </Button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="animate-fade-in">
          {activeTab === "clientes" && <ClientsLearningTab />}
          {activeTab === "proyectos" && <ProjectsLearningTab />}
          {activeTab === "agentes" && <AgentsTab />}
          {activeTab === "estadisticas" && <StatsTab />}
        </div>
      </div>
    </AppLayout>
  );
};

export default BaseConocimiento;
