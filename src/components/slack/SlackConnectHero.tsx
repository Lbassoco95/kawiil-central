import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare } from "lucide-react";

type Props = {
  onConnect: () => void;
  isConnecting: boolean;
};

export function SlackConnectHero({ onConnect, isConnecting }: Props) {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-6 py-16">
      <div className="max-w-md w-full text-center space-y-8 animate-fade-in">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 shadow-lg shadow-primary/5">
          <MessageSquare className="h-10 w-10 text-primary" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Slack en Kawiil</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Conecta tu cuenta del workspace para ver canales, mensajes directos y grupos desde aquí. Misma conversación
            que en Slack, con la experiencia de Kawiil OS.
          </p>
        </div>
        <Button size="lg" className="w-full sm:w-auto min-w-[200px]" onClick={onConnect} disabled={isConnecting}>
          {isConnecting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Abriendo Slack…
            </>
          ) : (
            "Conectar con Slack"
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          Se abrirá una ventana segura de Slack. Acepta los permisos para mensajes y canales que ya usas en el equipo.
        </p>
      </div>
    </div>
  );
}
