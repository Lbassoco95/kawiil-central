import { useState } from "react";
import { Copy, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOutlookAdminConsentPrompt, useOutlookConnection } from "@/hooks/useLinkedAccounts";
import {
  ADMIN_CONSENT_DIALOG_BODY,
  ADMIN_CONSENT_DIALOG_TITLE,
  buildAdminConsentMessage,
  KAWIIL_ACCESS_NOTE,
  OUTLOOK_PERMISSIONS_PLAIN,
} from "@/lib/microsoftAdminConsent";

export function OutlookAdminConsentDialog() {
  const prompt = useOutlookAdminConsentPrompt();
  const { connect, isConnecting } = useOutlookConnection();
  const [email, setEmail] = useState("");
  const [consentUrl, setConsentUrl] = useState<{ key: string; url: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const key = `${email.trim().toLowerCase()}|${prompt.tenant || ""}`;

  const getConsentUrl = async (): Promise<string> => {
    if (consentUrl?.key === key) return consentUrl.url;
    const { data, error } = await supabase.functions.invoke("outlook-account-auth", {
      body: { action: "admin-consent-url", email: email.trim(), tenant: prompt.tenant },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (!data?.url) throw new Error("No se recibió el enlace de aprobación");
    setConsentUrl({ key, url: data.url as string });
    return data.url as string;
  };

  const copy = async (kind: "link" | "message") => {
    setLoading(true);
    try {
      const url = await getConsentUrl();
      await navigator.clipboard.writeText(kind === "link" ? url : buildAdminConsentMessage(url));
      toast.success(kind === "link" ? "Enlace copiado" : "Mensaje copiado");
    } catch (err) {
      toast.error("No se pudo copiar: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  const retry = () => {
    prompt.close();
    connect();
  };

  return (
    <Dialog open={prompt.open} onOpenChange={(open) => !open && prompt.close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{ADMIN_CONSENT_DIALOG_TITLE}</DialogTitle>
          <DialogDescription>{ADMIN_CONSENT_DIALOG_BODY}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="outlook-admin-consent-email">Correo de la cuenta que intentaste conectar</Label>
          <Input
            id="outlook-admin-consent-email"
            type="email"
            placeholder="nombre@tuempresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {consentUrl?.key === key && (
            <Input readOnly value={consentUrl.url} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-start">
          <Button variant="default" onClick={() => copy("link")} disabled={loading}>
            <Copy className="mr-2 h-4 w-4" />
            Copiar enlace
          </Button>
          <Button variant="outline" onClick={() => copy("message")} disabled={loading}>
            <Mail className="mr-2 h-4 w-4" />
            Copiar mensaje para el administrador
          </Button>
          <Button variant="ghost" onClick={retry} disabled={isConnecting}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reintentar
          </Button>
        </DialogFooter>

        <div className="space-y-2 border-t pt-4 text-sm">
          <p className="font-medium">Permisos que solicita Kawiil:</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {OUTLOOK_PERMISSIONS_PLAIN.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">{KAWIIL_ACCESS_NOTE}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
