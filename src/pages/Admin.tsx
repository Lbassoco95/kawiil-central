import { AppLayout } from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserManagement } from "@/components/admin/UserManagement";
import { CelulaManagement } from "@/components/admin/CelulaManagement";
import { CatalogManagement } from "@/components/admin/CatalogManagement";

const Admin = () => {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Administración</h1>
          <p className="text-sm text-muted-foreground">Gestión de Kawiilers, grados y catálogos</p>
        </div>

        <Tabs defaultValue="usuarios">
          <TabsList>
            <TabsTrigger value="usuarios">Kawiilers</TabsTrigger>
            <TabsTrigger value="celulas">Células</TabsTrigger>
            <TabsTrigger value="catalogos">Catálogos</TabsTrigger>
          </TabsList>

          <TabsContent value="usuarios" className="mt-4">
            <UserManagement />
          </TabsContent>

          <TabsContent value="celulas" className="mt-4">
            <CelulaManagement />
          </TabsContent>

          <TabsContent value="catalogos" className="mt-4">
            <CatalogManagement />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default Admin;
