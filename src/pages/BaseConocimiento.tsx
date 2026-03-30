import { useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import {
  BookOpen, Building2, FolderKanban, Bot, BarChart3, Users,
} from "lucide-react";
import { ClientsLearningTab } from "@/components/knowledge/ClientsLearningTab";
import { ProjectsLearningTab } from "@/components/knowledge/ProjectsLearningTab";
import { CelulasLearningTab } from "@/components/knowledge/CelulasLearningTab";
import { AgentsTab } from "@/components/knowledge/AgentsTab";
import { StatsTab } from "@/components/knowledge/StatsTab";

type TabKey = "clientes" | "proyectos" | "celulas" | "agentes" | "estadisticas";

const VALID_TABS: TabKey[] = ["clientes", "proyectos", "celulas", "agentes", "estadisticas"];

const tabs: { key: TabKey; label: string; icon: typeof Building2 }[] = [
  { key: "clientes", label: "Por Cliente", icon: Building2 },
  { key: "proyectos", label: "Por Proyecto", icon: FolderKanban },
  { key: "celulas", label: "Por Célula", icon: Users },
  { key: "agentes", label: "Agentes", icon: Bot },
  { key: "estadisticas", label: "Estadísticas", icon: BarChart3 },
];

const BaseConocimiento = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab") as TabKey | null;
  const [activeTab, setActiveTabState] = useState<TabKey>(
    urlTab && VALID_TABS.includes(urlTab) ? urlTab : "clientes"
  );

  const setActiveTab = useCallback((key: TabKey) => {
    setActiveTabState(key);
    setSearchParams((prev) => { const p = new URLSearchParams(prev); p.set("tab", key); return p; }, { replace: true });
  }, [setSearchParams]);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
            <BookOpen className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Conocimiento
          </h1>
          <p className="text-sm text-muted-foreground mt-1 hidden sm:block">
            Dashboard de inteligencia: monitorea qué está aprendiendo el sistema, por cliente, proyecto y célula
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <Button
                key={t.key}
                variant="ghost"
                size="sm"
                className={`tab-pill gap-1.5 shrink-0 ${activeTab === t.key ? "tab-pill-active" : "tab-pill-inactive"}`}
                onClick={() => setActiveTab(t.key)}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden xs:inline sm:inline">{t.label}</span>
                <span className="xs:hidden sm:hidden">{t.label.split(" ").pop()}</span>
              </Button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="animate-fade-in">
          {activeTab === "clientes" && <ClientsLearningTab />}
          {activeTab === "proyectos" && <ProjectsLearningTab />}
          {activeTab === "celulas" && <CelulasLearningTab />}
          {activeTab === "agentes" && <AgentsTab />}
          {activeTab === "estadisticas" && <StatsTab />}
        </div>
      </div>
    </AppLayout>
  );
};

export default BaseConocimiento;
