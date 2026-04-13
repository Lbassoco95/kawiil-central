import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PersonalDashboard } from "@/components/dashboard/PersonalDashboard";
import { TeamDashboard } from "@/components/dashboard/TeamDashboard";
import { RecordatoriosEntryButton } from "@/components/reminders/RecordatoriosEntryButton";

const Dashboard = () => {
  const [view, setView] = useState<"personal" | "equipo">("personal");

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header with toggle */}
        <div className="surface-toolbar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-foreground tracking-tight">Dashboard</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              {view === "personal" ? "Tu espacio personal" : "Vista colaborativa del equipo"}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
            {view === "personal" ? <RecordatoriosEntryButton /> : null}
            <div className="flex items-center rounded-full border border-border/40 bg-background/60 p-1 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setView("personal")}
                className={`px-3 sm:px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
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
                className={`px-3 sm:px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
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

        {view === "personal" ? <PersonalDashboard /> : <TeamDashboard />}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
