import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CalendarView } from "@/components/microsoft/CalendarView";
import { EmailView } from "@/components/microsoft/EmailView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { Calendar, Mail, Loader2 } from "lucide-react";

const Microsoft365 = () => {
  const { isConnected, isLoading, connect, isConnecting, profile } = useMicrosoftConnection();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
        <div className="space-y-8">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Microsoft 365</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Calendario y correo de Outlook · {profile?.displayName || profile?.mail || ""}
            </p>
          </div>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Calendario</h2>
            </div>
            <CalendarView />
          </section>

          <div className="border-t border-border/40" />

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Mail className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Correo</h2>
            </div>
            <EmailView />
          </section>
        </div>
      </ErrorBoundary>
    </AppLayout>
  );
};

export default Microsoft365;
