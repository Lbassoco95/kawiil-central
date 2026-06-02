import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EmailView } from "@/components/microsoft/EmailView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { useTasksRealtime } from "@/hooks/useTasksRealtime";
import { Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const Microsoft365Correo = () => {
  const { isConnected, isLoading, connect, isConnecting, profile } = useMicrosoftConnection();
  useTasksRealtime();

  return (
    <AppLayout contentMaxWidth="full">
      <div className="flex flex-col h-full min-h-0 min-w-0 bg-card">
        <div className="shrink-0 border-b border-border/70 bg-card/80 backdrop-blur-sm px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white shadow-sm ring-1 ring-white/10"
              style={{ background: "linear-gradient(135deg, hsl(207 100% 42%), hsl(217 91% 60%))" }}
            >
              <Mail className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] leading-tight text-muted-foreground">
                <span className="font-bold gradient-text text-foreground">Correo</span>
                <span> · Integraciones</span>
                {profile && (
                  <span>
                    {" · Outlook · "}
                    {profile.displayName || profile.mail || ""}
                  </span>
                )}
              </p>
            </div>
            {isConnected && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() => connect()}
                      disabled={isConnecting}
                    >
                      <RefreshCw className={`h-3 w-3 ${isConnecting ? "animate-spin" : ""}`} />
                      Actualizar permisos
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs max-w-xs">
                    Vuelve a autorizar Microsoft para obtener permisos nuevos (reglas de correo, etc.)
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
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
