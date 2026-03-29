import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CalendarView } from "@/components/microsoft/CalendarView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { Calendar, Loader2 } from "lucide-react";

const Microsoft365Calendario = () => {
  const { isConnected, isLoading, connect, isConnecting, profile } = useMicrosoftConnection();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4 py-8">
          <div className="h-8 w-48 bg-secondary/30 rounded-lg animate-pulse" />
          <div className="h-4 w-64 bg-secondary/20 rounded animate-pulse" />
          <div className="grid grid-cols-7 gap-2 mt-6">
            {[...Array(35)].map((_, i) => (
              <div key={i} className="h-20 bg-secondary/20 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!isConnected) {
    return (
      <AppLayout>
        <div className="animate-scale-in">
          <MicrosoftConnectCard onConnect={connect} isConnecting={isConnecting} />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ErrorBoundary>
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-foreground">Calendario</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Outlook · {profile?.displayName || profile?.mail || ""} — con tareas de Kawiil
              </p>
            </div>
          </div>
          <CalendarView />
        </div>
      </ErrorBoundary>
    </AppLayout>
  );
};

export default Microsoft365Calendario;
