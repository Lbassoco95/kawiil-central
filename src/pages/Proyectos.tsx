import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, FolderKanban } from "lucide-react";

const Proyectos = () => {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Proyectos</h1>
            <p className="text-sm text-muted-foreground">Proyectos por cliente o internos</p>
          </div>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo proyecto
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar proyectos..." className="pl-9" />
          </div>
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="text-center py-12">
              <FolderKanban className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-medium text-foreground">Sin proyectos aún</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Crea tu primer proyecto para organizar tareas.
              </p>
              <Button className="mt-4">
                <Plus className="mr-2 h-4 w-4" />
                Crear proyecto
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Proyectos;
