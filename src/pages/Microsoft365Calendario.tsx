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
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isConnected) {
    return (
      <AppLayout>
        <MicrosoftConnectCard onConnect={connect} isConnecting={isConnecting} />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ErrorBoundary>
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Calendario</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Outlook · {profile?.displayName || profile?.mail || ""}
            </p>
          </div>
          <CalendarView />
        </div>
      </ErrorBoundary>
    </AppLayout>
  );
};

export default Microsoft365Calendario;
