import { type ReactNode } from "react";
import { useModulePermissions } from "@/hooks/useModulePermissions";
import { Button } from "@/components/ui/button";

// Falla cerrado. Mientras Dirección no decida quién ve el módulo, solo entran las cuentas con el permiso estricto «admin»
// (no se crea ninguna llave nueva en la base).
function Aviso({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6" data-testid={testId}>
      <div className="max-w-md space-y-3 text-center">{children}</div>
    </div>
  );
}

export function AgentesGate({ children }: { children: ReactNode }) {
  const { hasModuleStrict, isLoading, isError, isFetched, refetch } = useModulePermissions();
  if (isLoading || (!isFetched && !isError)) {
    return <Aviso testId="agentes-acceso-cargando"><p className="text-sm text-muted-foreground">Verificando tus permisos…</p></Aviso>;
  }
  if (isError) {
    return (
      <Aviso testId="agentes-acceso-error">
        <h1 className="text-lg font-semibold">No pudimos leer tus permisos</h1>
        <p className="text-sm text-muted-foreground">Por seguridad, Agentes no se muestra hasta confirmar tu permiso.</p>
        <Button variant="outline" onClick={() => void refetch()}>Reintentar</Button>
      </Aviso>
    );
  }
  if (!hasModuleStrict("admin")) {
    return (
      <Aviso testId="agentes-acceso-sin-permiso">
        <h1 className="text-lg font-semibold">Tu cuenta no tiene acceso a Agentes</h1>
        <p className="text-sm text-muted-foreground">Pide a Dirección que asigne el permiso a esta cuenta.</p>
      </Aviso>
    );
  }
  return <>{children}</>;
}
