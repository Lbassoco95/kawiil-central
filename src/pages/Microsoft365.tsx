import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CalendarView } from "@/components/microsoft/CalendarView";
import { EmailView } from "@/components/microsoft/EmailView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection, useSyncMicrosoftPhoto } from "@/hooks/useMicrosoft";
import { Button } from "@/components/ui/button";
import { Calendar, Mail, Loader2, RefreshCw } from "lucide-react";

const Microsoft365 = () => {
  const { isConnected, isLoading, connect, isConnecting, profile } = useMicrosoftConnection();
  const syncPhoto = useSyncMicrosoftPhoto();

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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight gradient-text">Microsoft 365</h1>
              <p className="text-sm sm:text-base text-muted-foreground mt-1">
                Calendario y correo de Outlook · {profile?.displayName || profile?.mail || ""}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncPhoto.mutate()}
              disabled={syncPhoto.isPending}
              className="self-start sm:self-auto"
            >
              {syncPhoto.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
              )}
              Sincronizar foto de Outlook
            </Button>
          </div>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold tracking-tight gradient-text">Calendario</h2>
            </div>
            <CalendarView />
          </section>

          <div className="border-t border-border/40" />

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Mail className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold tracking-tight gradient-text">Correo</h2>
            </div>
            <EmailView />
          </section>
        </div>
      </ErrorBoundary>
    </AppLayout>
  );
};

export default Microsoft365;
