import { useState, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CalendarView } from "@/components/microsoft/CalendarView";
import { EmailView } from "@/components/microsoft/EmailView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { Calendar, Mail, Loader2 } from "lucide-react";

const Microsoft365 = () => {
  const [tab, setTab] = useState("calendario");
  const { isConnected, isLoading, connect, isConnecting, profile } = useMicrosoftConnection();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isConnected) {
    return (
      <AppLayout>
        <MicrosoftConnectCard onConnect={connect} isConnecting={isConnecting} />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Microsoft 365</h1>
          <p className="text-sm text-muted-foreground">
            Calendario y correo de Outlook · {profile?.displayName || profile?.mail || ""}
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="calendario" className="gap-2">
              <Calendar className="h-4 w-4" /> Calendario
            </TabsTrigger>
            <TabsTrigger value="correo" className="gap-2">
              <Mail className="h-4 w-4" /> Correo
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calendario" className="mt-4">
            <CalendarView />
          </TabsContent>
          <TabsContent value="correo" className="mt-4">
            <EmailView />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default Microsoft365;
