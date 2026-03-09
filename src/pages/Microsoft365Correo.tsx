import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EmailView } from "@/components/microsoft/EmailView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection, useUnreadEmailCount } from "@/hooks/useMicrosoft";
import { Mail, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const Microsoft365Correo = () => {
  const { isConnected, isLoading, connect, isConnecting, profile } = useMicrosoftConnection();
  const { data: unreadCount = 0 } = useUnreadEmailCount();

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
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-semibold text-foreground">Correo</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Outlook · {profile?.displayName || profile?.mail || ""} · Referencia rápida para emergencias
              </p>
            </div>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs h-6 px-2.5">
                {unreadCount} sin leer
              </Badge>
            )}
          </div>
          <EmailView />
        </div>
      </ErrorBoundary>
    </AppLayout>
  );
};

export default Microsoft365Correo;
