import { AppLayout } from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserManagement } from "@/components/admin/UserManagement";
import { AreaManagement } from "@/components/admin/AreaManagement";
import { CatalogManagement } from "@/components/admin/CatalogManagement";

const Admin = () => {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Administración</h1>
          <p className="text-sm text-muted-foreground">Gestión de usuarios, roles y catálogos</p>
        </div>

        <Tabs defaultValue="usuarios">
          <TabsList>
            <TabsTrigger value="usuarios">Usuarios</TabsTrigger>
            <TabsTrigger value="areas">Áreas</TabsTrigger>
            <TabsTrigger value="catalogos">Catálogos</TabsTrigger>
          </TabsList>

          <TabsContent value="usuarios" className="mt-4">
            <UserManagement />
          </TabsContent>

          <TabsContent value="areas" className="mt-4">
            <AreaManagement />
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
