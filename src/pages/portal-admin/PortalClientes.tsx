/**
 * Central → «Portal de clientes»: administración del portal del cliente (M3).
 * Cuentas, emisión, publicación, mapeo de Dropbox, «Facturación de gastos»
 * (tickets) y facturas. Los permisos los aplica la base (RPC portal_staff_*).
 */
import { useSearchParams } from "react-router-dom";
import { Globe } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CuentasTab from "@/components/portal-admin/CuentasTab";
import EmisionTab from "@/components/portal-admin/EmisionTab";
import PublicacionTab from "@/components/portal-admin/PublicacionTab";
import DropboxTab from "@/components/portal-admin/DropboxTab";
import FacturacionGastosTab from "@/components/portal-admin/FacturacionGastosTab";
import FacturasTab from "@/components/portal-admin/FacturasTab";
import CatalogosTab from "@/components/portal-admin/CatalogosTab";

const TABS = [
  ["cuentas", "Cuentas", CuentasTab],
  ["publicacion", "Publicación", PublicacionTab],
  ["dropbox", "Dropbox", DropboxTab],
  ["gastos", "Facturación de gastos", FacturacionGastosTab],
  ["facturas", "Facturas", FacturasTab],
  ["emision", "Emisión", EmisionTab],
  ["catalogos", "Catálogos", CatalogosTab],
] as const;

export default function PortalClientes() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "cuentas";
  return (
    <AppLayout>
      <PageHeader title="Portal de clientes" description="Lo que ven y hacen los clientes en su portal. Todo sale de kawiil-central; nada se publica solo." icon={<Globe className="h-5 w-5" />} />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="mb-4 flex h-auto flex-wrap">
          {TABS.map(([k, label]) => <TabsTrigger key={k} value={k}>{label}</TabsTrigger>)}
        </TabsList>
        {TABS.map(([k, , C]) => <TabsContent key={k} value={k}><C /></TabsContent>)}
      </Tabs>
    </AppLayout>
  );
}
