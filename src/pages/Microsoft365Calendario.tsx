import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CalendarView } from "@/components/microsoft/CalendarView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { Calendar } from "lucide-react";

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
          <PageHeader
            variant="hero"
            breadcrumb={["Kawiil OS", "Microsoft 365", "Calendario"]}
            icon={<Calendar />}
            title="Calendario"
            description={`Outlook · ${profile?.displayName || profile?.mail || "Conectado"} — con tareas de Kawiil`}
          />
          <CalendarView />
        </div>
      </ErrorBoundary>
    </AppLayout>
  );
};

export default Microsoft365Calendario;
