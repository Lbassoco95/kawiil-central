import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PersonalDashboard } from "@/components/dashboard/PersonalDashboard";
import { TeamDashboard } from "@/components/dashboard/TeamDashboard";

const Dashboard = () => {
  const [view, setView] = useState<"personal" | "equipo">("personal");

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header with toggle */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">Dashboard</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              {view === "personal" ? "Tu espacio personal" : "Vista colaborativa del equipo"}
            </p>
          </div>
          <div className="flex items-center bg-secondary/50 rounded-full p-1">
            <button
              onClick={() => setView("personal")}
              className={`px-3 sm:px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                view === "personal"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Personal
            </button>
            <button
              onClick={() => setView("equipo")}
              className={`px-3 sm:px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                view === "equipo"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Equipo
            </button>
          </div>
        </div>

        {view === "personal" ? <PersonalDashboard /> : <TeamDashboard />}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
