import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useModulePermissions } from "@/hooks/useModulePermissions";

interface ModuleGateProps {
  moduleKey: string;
  children: ReactNode;
}

export function ModuleGate({ moduleKey, children }: ModuleGateProps) {
  const { hasModule, isLoading } = useModulePermissions();

  if (isLoading) return null;

  if (!hasModule(moduleKey)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
