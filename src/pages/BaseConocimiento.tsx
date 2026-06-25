import { useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  BookOpen, Building2, FolderKanban, Bot, BarChart3, Users, Lightbulb, ShieldCheck,
} from "lucide-react";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";
import { KnowledgeKawiilCard } from "@/components/knowledge/KnowledgeKawiilCard";
import { ClientsLearningTab } from "@/components/knowledge/ClientsLearningTab";
import { ProjectsLearningTab } from "@/components/knowledge/ProjectsLearningTab";
import { CelulasLearningTab } from "@/components/knowledge/CelulasLearningTab";
import { AgentsTab } from "@/components/knowledge/AgentsTab";
import { StatsTab } from "@/components/knowledge/StatsTab";
import { SuggestionsTab } from "@/components/knowledge/SuggestionsTab";
import { SatCoverageTab } from "@/components/knowledge/SatCoverageTab";

type TabKey = "clientes" | "proyectos" | "celulas" | "agentes" | "estadisticas" | "sugerencias" | "sat";

const VALID_TABS: TabKey[] = ["clientes", "proyectos", "celulas", "agentes", "estadisticas", "sugerencias", "sat"];

const tabs: { key: TabKey; label: string; icon: typeof Building2 }[] = [
  { key: "clientes", label: "Por Cliente", icon: Building2 },
  { key: "proyectos", label: "Por Proyecto", icon: FolderKanban },
  { key: "celulas", label: "Por Célula", icon: Users },
  { key: "agentes", label: "Agentes", icon: Bot },
  { key: "estadisticas", label: "Estadísticas", icon: BarChart3 },
  { key: "sugerencias", label: "Sugerencias", icon: Lightbulb },
  { key: "sat", label: "SAT", icon: ShieldCheck },
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
        <PageHeader
          variant="hero"
          breadcrumb={["Kawiil OS", "Conocimiento", "Base"]}
          icon={<BookOpen />}
          iconAccent={KAWIIL_AI_GRADIENT}
          title="Conocimiento"
          description="Dashboard de inteligencia: monitorea qué está aprendiendo el sistema, por cliente, proyecto y célula"
          actions={
            <Badge
              variant="outline"
              className="hidden sm:inline-flex border-sky-300/70 bg-sky-50/70 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300"
            >
              v2.4
            </Badge>
          }
        />
        <KnowledgeKawiilCard activeTab={activeTab} onGoToTab={(t) => setActiveTab(t)} />
        <div className="surface-toolbar space-y-4 p-4 md:p-5 rounded-xl border border-border/50">
          <div className="flex gap-1 overflow-x-auto rounded-lg border border-border/40 bg-background/40 p-1 backdrop-blur-sm">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <Button
                  key={t.key}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "tab-pill gap-1.5 shrink-0",
                    activeTab === t.key ? "tab-pill-active" : "tab-pill-inactive",
                  )}
                  onClick={() => setActiveTab(t.key)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden xs:inline sm:inline">{t.label}</span>
                  <span className="xs:hidden sm:hidden">{t.label.split(" ").pop()}</span>
                </Button>
              );
            })}
          </div>
        </div>

        <div key={activeTab} className="animate-fade-in">
          {activeTab === "clientes" && <ClientsLearningTab />}
          {activeTab === "proyectos" && <ProjectsLearningTab />}
          {activeTab === "celulas" && <CelulasLearningTab />}
          {activeTab === "agentes" && <AgentsTab />}
          {activeTab === "estadisticas" && <StatsTab />}
          {activeTab === "sugerencias" && <SuggestionsTab />}
          {activeTab === "sat" && <SatCoverageTab />}
        </div>
      </div>
    </AppLayout>
  );
};

export default BaseConocimiento;
