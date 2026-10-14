import { useMemo, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComposeEmailDialog } from "@/components/microsoft/ComposeEmailDialog";
import { useClientTaxProfiles } from "@/hooks/useClientTaxProfiles";
import { collectClientEmails } from "@/lib/clientEmails";

interface Props {
  client: { id: string; name: string; email: string | null };
  size?: "sm" | "default";
}

/**
 * Abre el redactor de correo con los correos registrados del cliente (ficha +
 * perfiles fiscales) ya cargados en "Para", para no salir del módulo de clientes.
 */
export function ClientEmailButton({ client, size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  const { data: taxProfiles = [] } = useClientTaxProfiles(client.id);

  const emails = useMemo(
    () => collectClientEmails(client.email, taxProfiles.map((p) => p.email_recepcion)),
    [client.email, taxProfiles],
  );

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
      />
    </>
  );
}
