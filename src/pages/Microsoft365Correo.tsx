import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EmailView } from "@/components/microsoft/EmailView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { Mail, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const Microsoft365Correo = () => {
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
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">Correo</h1>
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Solo lectura
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Outlook · {profile?.displayName || profile?.mail || ""} · Referencia rápida para emergencias
            </p>
          </div>
          <EmailView />
        </div>
      </ErrorBoundary>
    </AppLayout>
  );
};

export default Microsoft365Correo;
