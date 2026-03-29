import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/microsoft/RichTextEditor";
import { useSendNewEmail } from "@/hooks/useMicrosoft";
import { Loader2, Send, ChevronDown, ChevronUp } from "lucide-react";

interface ComposeEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ComposeEmailDialog({ open, onOpenChange }: ComposeEmailDialogProps) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [showCc, setShowCc] = useState(false);
  const bodyRef = useRef("");
  const sendEmail = useSendNewEmail();

  const handleSend = async () => {
    const toList = to.split(",").map((e) => e.trim()).filter(Boolean);
    if (!toList.length) return;

    const ccList = cc ? cc.split(",").map((e) => e.trim()).filter(Boolean) : [];

    await sendEmail.mutateAsync({
      to: toList,
      cc: ccList.length ? ccList : undefined,
      subject: subject || "(Sin asunto)",
      bodyHtml: bodyRef.current || "<p></p>",
    });

    setTo("");
    setCc("");
    setSubject("");
    bodyRef.current = "";
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo correo</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label className="w-12 text-right text-sm text-muted-foreground shrink-0">Para</Label>
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="destinatario@ejemplo.com, otro@ejemplo.com"
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => setShowCc(!showCc)}
              >
                CC {showCc ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
              </Button>
            </div>
            {showCc && (
              <div className="flex items-center gap-2 animate-fade-in">
                <Label className="w-12 text-right text-sm text-muted-foreground shrink-0">CC</Label>
                <Input
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="copia@ejemplo.com"
                  className="flex-1"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Label className="w-12 text-right text-sm text-muted-foreground shrink-0">Asunto</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Asunto del correo"
              className="flex-1"
            />
          </div>

          <RichTextEditor
            placeholder="Escribe tu mensaje..."
            onHtmlChange={(html) => { bodyRef.current = html; }}
            className="min-h-[200px]"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSend} disabled={sendEmail.isPending || !to.trim()}>
              {sendEmail.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1.5" />
              )}
              Enviar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
