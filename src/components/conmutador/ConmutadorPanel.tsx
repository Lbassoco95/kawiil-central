import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Inbox, PhoneForwarded, Settings2 } from "lucide-react";
import { CallInbox } from "./CallInbox";
import { ConfigEditor } from "./ConfigEditor";
import { ExtensionsEditor } from "./ExtensionsEditor";

const TABS = ["bandeja", "configuracion", "extensiones"];

/**
 * Conmutador — secretario IA telefónico. Dos vistas:
 *  - Bandeja: llamadas/folios con filtros por célula y urgencia; enlaces a
 *    transcripción/grabación.
 *  - Configuración: preguntas por célula, override de G4, voz y prompt.
 */
export function ConmutadorPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get("sw");
  const initial = param && TABS.includes(param) ? param : "bandeja";

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Conmutador</h1>
        <p className="text-sm text-muted-foreground">
          Bandeja de llamadas atendidas por el secretario IA y configuración por célula.
        </p>
      </div>

      <Tabs
        defaultValue={initial}
        onValueChange={(v) => {
          const next = new URLSearchParams(searchParams);
          next.set("sw", v);
          setSearchParams(next, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="bandeja">
            <Inbox className="mr-1.5 h-4 w-4" /> Bandeja
          </TabsTrigger>
          <TabsTrigger value="configuracion">
            <Settings2 className="mr-1.5 h-4 w-4" /> Configuración
          </TabsTrigger>
          <TabsTrigger value="extensiones">
            <PhoneForwarded className="mr-1.5 h-4 w-4" /> Extensiones
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bandeja" className="mt-4">
          <CallInbox />
        </TabsContent>
        <TabsContent value="configuracion" className="mt-4">
          <ConfigEditor />
        </TabsContent>
        <TabsContent value="extensiones" className="mt-4">
          <ExtensionsEditor />
        </TabsContent>
      </Tabs>
    </section>
  );
}
