import { useState, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PersonalDashboard } from "@/components/dashboard/PersonalDashboard";
import { TeamDashboard } from "@/components/dashboard/TeamDashboard";
import { nowMX } from "@/lib/dateUtils";

const Dashboard = () => {
  const [view, setView] = useState<"personal" | "equipo">("personal");
  const [currentTime, setCurrentTime] = useState(() => nowMX());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(nowMX()), 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header with toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center justify-between sm:block">
            <div>
              <h1 className="text-lg sm:text-xl font-semibold text-foreground">Dashboard</h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                {view === "personal" ? "Tu espacio personal" : "Vista colaborativa del equipo"}
              </p>
            </div>
            <div className="flex items-center bg-secondary/50 rounded-full p-1 sm:hidden">
              <button
                onClick={() => setView("personal")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  view === "personal"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Personal
              </button>
              <button
                onClick={() => setView("equipo")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  view === "equipo"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Equipo
              </button>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-foreground capitalize">
                {currentTime.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
              </p>
              <p className="text-xs text-muted-foreground">
                {currentTime.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })} hrs
              </p>
            </div>
            <div className="flex items-center bg-secondary/50 rounded-full p-1">
              <button
                onClick={() => setView("personal")}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  view === "personal"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Personal
              </button>
              <button
                onClick={() => setView("equipo")}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  view === "equipo"
                    ? "bg-background text-foreground shadow-sm"
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
