import { type ReactNode } from "react";
import { useModulePermissions } from "@/hooks/useModulePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

// Marketing falla cerrado: sin permiso confirmado por la base (o si la consulta falla) no se muestra el contenido.
// Cuando no deja entrar, explica la causa (sin relajar el permiso): cargando, error de consulta o sin permiso.
function Aviso({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6" data-testid={testId}>
      <div className="max-w-md space-y-3 text-center">{children}</div>
    </div>
  );
}

export function MarketingGate({ children }: { children: ReactNode }) {
  const { hasModuleStrict, isLoading, isError, isFetched, refetch } = useModulePermissions();
  const { user } = useAuth();

  if (isLoading || (!isFetched && !isError)) {
    return (
      <Aviso testId="marketing-acceso-cargando">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Verificando tus permisos…</p>
      </Aviso>
    );
  }

  if (isError) {
    return (
      <Aviso testId="marketing-acceso-error">
        <h1 className="text-lg font-semibold">No pudimos leer tus permisos</h1>
        <p className="text-sm text-muted-foreground">
          Por seguridad, Marketing no se muestra hasta confirmar tu permiso. Esto no significa que lo hayas perdido.
        </p>
        <Button variant="outline" onClick={() => void refetch()}>Reintentar</Button>
      </Aviso>
    );
  }

  if (!hasModuleStrict("marketing")) {
    return (
      <Aviso testId="marketing-acceso-sin-permiso">
        <h1 className="text-lg font-semibold">Tu cuenta no tiene acceso a Marketing</h1>
        <p className="text-sm text-muted-foreground">
          Iniciaste sesión como <strong>{user?.email ?? "(sin correo)"}</strong>. Si esperabas tener acceso, pide a
          Dirección que asigne el permiso a esta cuenta, o entra con la cuenta que lo tiene.
        </p>
      </Aviso>
    );
  }

  return <>{children}</>;
}
