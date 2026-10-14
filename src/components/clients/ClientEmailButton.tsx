import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComposeEmailDialog, type SentEmailInfo } from "@/components/microsoft/ComposeEmailDialog";
import { useClientTaxProfiles } from "@/hooks/useClientTaxProfiles";
import { useAuth } from "@/contexts/AuthContext";
import { collectClientEmails } from "@/lib/clientEmails";
import { logEntityActivity } from "@/lib/activityLog";
import {
  CLIENT_EMAIL_SCHEDULED_ACTION,
  CLIENT_EMAIL_SENT_ACTION,
  clientEmailHistoryKey,
} from "@/hooks/useClientEmailHistory";

interface Props {
  client: { id: string; name: string; email: string | null; organization_id: string };
  size?: "sm" | "default";
}

/**
 * Abre el redactor de correo con los correos registrados del cliente (ficha +
 * perfiles fiscales) ya cargados en "Para", para no salir del módulo de clientes.
 * Cada envío (y cada envío programado) queda en el historial del cliente (activity_log).
 */
export function ClientEmailButton({ client, size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: taxProfiles = [] } = useClientTaxProfiles(client.id);

  const emails = useMemo(
    () => collectClientEmails(client.email, taxProfiles.map((p) => p.email_recepcion)),
    [client.email, taxProfiles],
  );

  const handleSent = (info: SentEmailInfo) => {
    if (!user) return;
    void logEntityActivity(user.id, client.organization_id, {
      entityType: "client",
      entityId: client.id,
      action: info.scheduledAt ? CLIENT_EMAIL_SCHEDULED_ACTION : CLIENT_EMAIL_SENT_ACTION,
      details: {
        subject: info.subject,
        to: info.to,
        cc: info.cc,
        attachments: info.attachmentNames,
        from: info.fromEmail,
        ...(info.scheduledAt ? { scheduled_at: info.scheduledAt } : {}),
      },
    }).then(() => qc.invalidateQueries({ queryKey: clientEmailHistoryKey(client.id) }));
  };

  return (
    <>
      <Button
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        disabled={emails.length === 0}
        title={emails.length === 0 ? "El cliente no tiene correo registrado" : `Enviar a: ${emails.join(", ")}`}
      >
        <Mail className="mr-1.5 h-3.5 w-3.5" />
        Enviar correo
      </Button>
      <ComposeEmailDialog
        open={open}
        onOpenChange={setOpen}
        initialTo={emails.join(", ")}
        defaultTemplateContext={{ razon_social: client.name, clientId: client.id }}
        onSent={handleSent}
      />
    </>
  );
}
