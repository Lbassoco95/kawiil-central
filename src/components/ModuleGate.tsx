import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useModulePermissions } from "@/hooks/useModulePermissions";

interface ModuleGateProps {
  moduleKey: string;
  children: ReactNode;
}

export function ModuleGate({ moduleKey, children }: ModuleGateProps) {
  const { hasModule, isLoading } = useModulePermissions();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!hasModule(moduleKey)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
