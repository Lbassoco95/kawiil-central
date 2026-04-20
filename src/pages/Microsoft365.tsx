import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CalendarView } from "@/components/microsoft/CalendarView";
import { EmailView } from "@/components/microsoft/EmailView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection, useSyncMicrosoftPhoto } from "@/hooks/useMicrosoft";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Calendar, Mail, Loader2, RefreshCw, Inbox } from "lucide-react";

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

  const accountLabel = profile?.displayName || profile?.mail || "Conectado";

  return (
    <AppLayout>
      <ErrorBoundary>
        <div className="space-y-6 animate-fade-in">
          <PageHeader
            variant="hero"
            breadcrumb={["Kawiil OS", "Microsoft 365"]}
            icon={<Inbox />}
            title="Microsoft 365"
            description={`Calendario y correo de Outlook · ${accountLabel}`}
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncPhoto.mutate()}
                disabled={syncPhoto.isPending}
              >
                {syncPhoto.isPending ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                )}
                Sincronizar foto de Outlook
              </Button>
            }
          />

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold tracking-tight text-foreground">Calendario</h2>
            </div>
            <CalendarView />
          </section>

          <div className="border-t border-border/40" />

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold tracking-tight text-foreground">Correo</h2>
            </div>
            <EmailView />
          </section>
        </div>
      </ErrorBoundary>
    </AppLayout>
  );
};

export default Microsoft365;
