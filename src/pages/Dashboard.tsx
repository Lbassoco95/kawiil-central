import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PersonalDashboard } from "@/components/dashboard/PersonalDashboard";
import { TeamDashboard } from "@/components/dashboard/TeamDashboard";
import { RecordatoriosEntryButton } from "@/components/reminders/RecordatoriosEntryButton";
import { PageHeader } from "@/components/shared/PageHeader";
import { LayoutDashboard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";

const Dashboard = () => {
  const [view, setView] = useState<"personal" | "equipo">("personal");

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          variant="hero"
          breadcrumb={["Kawiil OS", "Inicio", view === "personal" ? "Personal" : "Equipo"]}
          icon={<LayoutDashboard />}
          iconAccent={KAWIIL_AI_GRADIENT}
          title="Dashboard"
          description={
            view === "personal"
              ? "Tu espacio personal: tareas, recordatorios y ritmo del día."
              : "Vista colaborativa del equipo: pulse, cargas y métricas."
          }
          actions={
            <>
              <Badge
                variant="outline"
                className="hidden sm:inline-flex border-sky-300/70 bg-sky-50/70 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300"
              >
                v2.4
              </Badge>
              {view === "personal" ? <RecordatoriosEntryButton /> : null}
              <div className="flex items-center rounded-full border border-border/40 bg-background/60 p-1 backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => setView("personal")}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 ${
                    view === "personal"
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border/50"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Personal
                </button>
                <button
                  type="button"
                  onClick={() => setView("equipo")}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 ${
                    view === "equipo"
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border/50"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Equipo
                </button>
              </div>
            </>
          }
        />

        {view === "personal" ? (
          <PersonalDashboard />
        ) : (
          <TeamDashboard />
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
