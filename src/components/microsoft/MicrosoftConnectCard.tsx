import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface MicrosoftConnectCardProps {
  onConnect: () => void;
  isConnecting: boolean;
}

export function MicrosoftConnectCard({ onConnect, isConnecting }: MicrosoftConnectCardProps) {
  return (
    <div className="flex items-center justify-center py-20">
      <Card variant="glass" className="w-full max-w-md shadow-md">
        <CardContent className="p-8 text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <svg viewBox="0 0 23 23" className="w-8 h-8">
              <path fill="#f35325" d="M1 1h10v10H1z" />
              <path fill="#81bc06" d="M12 1h10v10H12z" />
              <path fill="#05a6f0" d="M1 12h10v10H1z" />
              <path fill="#ffba08" d="M12 12h10v10H12z" />
            </svg>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight gradient-text">Conectar Microsoft 365</h2>
          <p className="text-sm text-muted-foreground">
            Vincula tu cuenta de Microsoft para ver tu calendario de Outlook, correos y bloquear horarios desde tus tareas.
          </p>
          <Button onClick={onConnect} disabled={isConnecting} className="w-full">
            {isConnecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Conectando...
              </>
            ) : (
              "Iniciar sesión con Microsoft"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
