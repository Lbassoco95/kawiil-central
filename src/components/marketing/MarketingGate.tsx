import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useModulePermissions } from "@/hooks/useModulePermissions";

// Marketing falla cerrado: sin permiso confirmado por la base (o si la consulta falla) no se muestra ni la ruta.
export function MarketingGate({ children }: { children: ReactNode }) {
  const { hasModuleStrict, isLoading } = useModulePermissions();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!hasModuleStrict("marketing")) return <Navigate to="/" replace />;
  return <>{children}</>;
}
