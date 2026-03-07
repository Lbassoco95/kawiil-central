import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { CalendarView } from "@/components/microsoft/CalendarView";
import { EmailView } from "@/components/microsoft/EmailView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { Calendar, Mail, Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const Microsoft365 = () => {
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
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Microsoft 365</h1>
          <p className="text-sm text-muted-foreground">
            Calendario y correo de Outlook · {profile?.displayName || profile?.mail || ""}
          </p>
        </div>

        {/* Calendar Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Calendario</h2>
          </div>
          <CalendarView />
        </section>

        <Separator />

        {/* Email Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Mail className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Correo</h2>
          </div>
          <EmailView />
        </section>
      </div>
    </AppLayout>
  );
};

export default Microsoft365;
