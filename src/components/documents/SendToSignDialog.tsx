import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, PenTool, Plus, Trash2, FileText } from "lucide-react";

interface Signer {
  name: string;
  email: string;
}

interface SendToSignDialogProps {
  open: boolean;
  onClose: () => void;
  fileUrl?: string;
  fileName?: string;
  onSent?: (signatureRequestId: string) => void;
}

export function SendToSignDialog({
  open,
  onClose,
  fileUrl,
  fileName,
  onSent,
}: SendToSignDialogProps) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [signers, setSigners] = useState<Signer[]>([{ name: "", email: "" }]);
  const [sending, setSending] = useState(false);
  const [testMode, setTestMode] = useState(true);

  const addSigner = () => {
    setSigners((prev) => [...prev, { name: "", email: "" }]);
  };

  const removeSigner = (index: number) => {
    if (signers.length <= 1) return;
    setSigners((prev) => prev.filter((_, i) => i !== index));
  };

  const updateSigner = (index: number, field: keyof Signer, value: string) => {
    setSigners((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const handleSend = async () => {
    const validSigners = signers.filter((s) => s.name.trim() && s.email.trim());
    if (validSigners.length === 0) {
      toast.error("Agrega al menos un firmante con nombre y email");
      return;
    }
    if (!fileUrl) {
      toast.error("No hay archivo para enviar a firma");
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-sign", {
        body: {
          action: "send_signature_request",
          title: title.trim() || fileName || "Documento para firma",
          subject: subject.trim() || "Documento pendiente de firma",
          message: message.trim() || "Por favor revisa y firma este documento.",
          signers: validSigners.map((s, i) => ({ ...s, order: i })),
          file_urls: [fileUrl],
          test_mode: testMode,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast.success("Solicitud de firma enviada exitosamente");
      onSent?.(data.signature_request_id);
      onClose();

      // Reset form
      setTitle("");
      setSubject("");
      setMessage("");
      setSigners([{ name: "", email: "" }]);
    } catch (e: any) {
      toast.error("Error al enviar a firma: " + (e.message || "Error desconocido"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <DialogTitle className="flex items-center gap-2">
            <PenTool className="h-5 w-5" />
            Enviar a firma — Dropbox Sign
          </DialogTitle>
          <DialogDescription>
            Envía este documento para firma electrónica
          </DialogDescription>
        </div>

        {/* File info */}
        {fileName && (
          <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 border text-sm">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate font-medium">{fileName}</span>
          </div>
        )}

        <div className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-sm">Título</Label>
            <Input
              placeholder="Ej: Contrato de servicios"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <Label className="text-sm">Asunto del email</Label>
            <Input
              placeholder="Ej: Documento pendiente de firma"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <Label className="text-sm">Mensaje</Label>
            <Textarea
              placeholder="Mensaje para los firmantes..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
            />
          </div>

          {/* Signers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Firmantes</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={addSigner}
              >
                <Plus className="h-3 w-3" />
                Agregar
              </Button>
            </div>
            {signers.map((signer, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder="Nombre"
                  className="h-8 text-xs"
                  value={signer.name}
                  onChange={(e) => updateSigner(i, "name", e.target.value)}
                />
                <Input
                  placeholder="Email"
                  className="h-8 text-xs"
                  type="email"
                  value={signer.email}
                  onChange={(e) => updateSigner(i, "email", e.target.value)}
                />
                {signers.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 shrink-0"
                    onClick={() => removeSigner(i)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Test mode toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="test-mode"
              checked={testMode}
              onChange={(e) => setTestMode(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="test-mode" className="text-xs text-muted-foreground">
              Modo prueba (no se cobran firmas)
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <PenTool className="h-4 w-4 mr-2" />
                Enviar a firma
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
