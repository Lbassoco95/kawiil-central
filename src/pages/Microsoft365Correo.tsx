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
        <div className="shrink-0 border-b border-border/70 bg-card/80 backdrop-blur-sm px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="grid h-9 w-9 place-items-center rounded-xl text-white shadow-sm ring-1 ring-white/10"
              style={{ background: "linear-gradient(135deg, hsl(207 100% 42%), hsl(217 91% 60%))" }}
            >
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80 leading-none mb-0.5">
                Kawiil OS<span className="mx-1 opacity-50">·</span>Integraciones<span className="mx-1 opacity-50">·</span>Correo
              </p>
              <div className="flex items-baseline gap-2">
                <h1 className="text-base font-bold tracking-tight gradient-text leading-tight">Correo</h1>
                {profile && (
                  <p className="truncate text-[11px] text-muted-foreground leading-tight">
                    Outlook · {profile.displayName || profile.mail || ""}
                  </p>
                )}
              </div>
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
