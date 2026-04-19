import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PersonalDashboard } from "@/components/dashboard/PersonalDashboard";
import { TeamDashboard } from "@/components/dashboard/TeamDashboard";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { RecordatoriosEntryButton } from "@/components/reminders/RecordatoriosEntryButton";

const Dashboard = () => {
  const [view, setView] = useState<"personal" | "equipo">("personal");

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header con toggle (saludo va en el AppTopbar) */}
        <div className="surface-toolbar flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="gradient-text text-2xl font-bold tracking-tight sm:text-3xl">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              {view === "personal" ? "Tu espacio personal" : "Vista colaborativa del equipo"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
          </div>
        </div>

        {view === "personal" ? (
          <>
            <PersonalDashboard />
            <DashboardOverview />
          </>
        ) : (
          <TeamDashboard />
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
