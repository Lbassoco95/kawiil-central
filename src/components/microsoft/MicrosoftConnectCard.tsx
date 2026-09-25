import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

interface MicrosoftConnectCardProps {
  onConnect: () => void;
  isConnecting: boolean;
  /** Error de la API (Edge caída, secret Azure, etc.) — distinto de «aún no vinculado». */
  connectionError?: string | null;
  onRetryConnection?: () => void;
}

export function MicrosoftConnectCard({
  onConnect,
  isConnecting,
  connectionError,
  onRetryConnection,
}: MicrosoftConnectCardProps) {
  if (connectionError) {
    return (
      <div className="flex items-center justify-center py-20 px-4">
        <Card variant="glass" className="w-full max-w-md shadow-md">
          <CardContent className="p-8 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
              No pudimos verificar Microsoft 365
            </h2>
            <p className="text-sm text-muted-foreground text-left whitespace-pre-wrap break-words">
              {connectionError}
            </p>
            <p className="text-xs text-muted-foreground text-left">
              Esto no es el login de Kawiil OS (correo/contraseña). Es la vinculación de Outlook
              para calendario y correo. Si el problema es el client secret de Azure, un
              administrador debe renovarlo en Supabase Secrets.
            </p>
            <div className="flex flex-col gap-2">
              {onRetryConnection && (
                <Button onClick={onRetryConnection} variant="default" className="w-full">
                  Reintentar verificación
                </Button>
              )}
              <Button onClick={onConnect} disabled={isConnecting} variant="outline" className="w-full">
                {isConnecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Conectando...
                  </>
                ) : (
                  "Reintentar vinculación con Microsoft"
                )}
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link to="/">
                  <ArrowLeft className="mr-2 h-4 w-4" /> Volver al inicio de Kawiil
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-20 px-4">
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
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight gradient-text">
            Conectar Microsoft 365
          </h2>
          <p className="text-sm text-muted-foreground">
            Vincula tu cuenta de Outlook para ver calendario, correos y bloquear horarios desde
            Kawiil. Esto no sustituye el inicio de sesión de Kawiil OS (correo y contraseña).
          </p>
          <Button onClick={onConnect} disabled={isConnecting} className="w-full">
            {isConnecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redirigiendo a Microsoft...
              </>
            ) : (
              "Vincular cuenta de Microsoft"
            )}
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" /> Volver al inicio
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
