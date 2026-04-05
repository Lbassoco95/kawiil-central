import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";

function NotFoundContent() {
  const location = useLocation();

  useEffect(() => {
    console.error("404: ruta inexistente:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <img src="/images/kawiil-logo.png" alt="Kawiil" className="h-16 w-16 mb-6 opacity-90" />
      <p className="text-sm font-medium text-muted-foreground mb-2">Error 404</p>
      <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Página no encontrada</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        La página que buscas no existe o fue movida.
      </p>
      <Button asChild size="lg" className="mb-6">
        <Link to="/">Volver al Dashboard</Link>
      </Button>
      <div className="flex flex-wrap gap-3 justify-center text-sm">
        <Link to="/tareas" className="text-primary hover:underline">
          Tareas
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link to="/proyectos" className="text-primary hover:underline">
          Proyectos
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link to="/clientes" className="text-primary hover:underline">
          Clientes
        </Link>
      </div>
    </div>
  );
}

const NotFound = () => {
  const { user } = useAuth();

  if (user) {
    return (
      <AppLayout>
        <NotFoundContent />
      </AppLayout>
    );
  }

  return (
    <div className="min-h-screen w-full bg-background flex flex-col items-center justify-center p-6">
      <NotFoundContent />
      <p className="mt-8 text-xs text-muted-foreground">
        <Link to="/login" className="text-primary hover:underline">
          Iniciar sesión
        </Link>
      </p>
    </div>
  );
};

export default NotFound;
