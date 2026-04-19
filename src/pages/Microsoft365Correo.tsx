import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EmailView } from "@/components/microsoft/EmailView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { useTasksRealtime } from "@/hooks/useTasksRealtime";
import { Mail } from "lucide-react";

const Microsoft365Correo = () => {
  const { isConnected, isLoading, connect, isConnecting, profile } = useMicrosoftConnection();
  useTasksRealtime();

  return (
    <AppLayout contentMaxWidth="full">
      <div className="flex flex-col h-full min-h-0 min-w-0 bg-card">
        <div className="shrink-0 border-b border-border/70 bg-card px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold tracking-tight text-foreground">Correo</h1>
              {profile && (
                <p className="truncate text-[11px] text-muted-foreground -mt-0.5">
                  {profile.displayName || profile.mail || ""}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="space-y-3 w-full max-w-md px-6">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex gap-3 animate-pulse">
                    <div className="h-10 w-10 rounded-full bg-secondary/40 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-secondary/40 rounded w-3/4" />
                      <div className="h-3 bg-secondary/30 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : !isConnected ? (
            <div className="p-6 animate-scale-in">
              <MicrosoftConnectCard onConnect={connect} isConnecting={isConnecting} />
            </div>
          ) : (
            <ErrorBoundary>
              <div className="h-full min-h-0 min-w-0 w-full animate-fade-in">
                <EmailView />
              </div>
            </ErrorBoundary>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default Microsoft365Correo;
