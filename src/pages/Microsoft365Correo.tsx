import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EmailView } from "@/components/microsoft/EmailView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { Loader2 } from "lucide-react";

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
        <div className="h-[calc(100vh-100px)]">
          <div className="flex items-center gap-3 mb-2">
            <div>
              <h1 className="text-lg font-semibold text-foreground">Correo</h1>
              <p className="text-xs text-muted-foreground">
                Outlook · {profile?.displayName || profile?.mail || ""}
              </p>
            </div>
          </div>
          <div className="h-[calc(100%-44px)]">
            <EmailView />
          </div>
        </div>
      </ErrorBoundary>
    </AppLayout>
  );
};

export default Microsoft365Correo;
