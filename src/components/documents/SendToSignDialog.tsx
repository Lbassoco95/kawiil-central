import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { invokeEsign } from "@/lib/esign";
import { toast } from "sonner";
import { Loader2, PenTool, Plus, Trash2, FileText, UserRound } from "lucide-react";

interface Signer {
  name: string;
  email: string;
  user_id?: string;
}

interface Member {
  user_id: string;
  full_name: string;
  email: string;
}

interface SendToSignDialogProps {
  open: boolean;
  onClose: () => void;
  /** URL de Dropbox/Supabase con el PDF. Si se omite, se pide subir un PDF. */
  fileUrl?: string;
  fileName?: string;
  clientId?: string | null;
  projectId?: string | null;
  onSent?: (requestId: string) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Firma electrónica SIMPLE (interna / cartas). Contratos van por WeTrust. */
export function SendToSignDialog({ open, onClose, fileUrl, fileName, clientId, projectId, onSent }: SendToSignDialogProps) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [signers, setSigners] = useState<Signer[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [sequential, setSequential] = useState(false);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    void supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .eq("is_active", true)
      .order("full_name")
      .then(({ data }) => setMembers((data ?? []) as Member[]));
  }, [open]);

  const reset = () => {
    setTitle("");
    setMessage("");
    setSigners([]);
    setSequential(false);
    setLocalFile(null);
  };

  const addInternal = (userId: string) => {
    const m = members.find((x) => x.user_id === userId);
    if (!m || signers.some((s) => s.user_id === userId)) return;
    setSigners((p) => [...p, { name: m.full_name, email: m.email, user_id: m.user_id }]);
  };
  const addExternal = () => setSigners((p) => [...p, { name: "", email: "" }]);
  const update = (i: number, patch: Partial<Signer>) => setSigners((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => setSigners((p) => p.filter((_, idx) => idx !== i));

  const handleSend = async () => {
    const valid = signers.filter((s) => s.user_id || (s.name.trim() && s.email.trim()));
    if (!valid.length) return toast.error("Agrega al menos un firmante");
    if (!fileUrl && !localFile) return toast.error("Selecciona un PDF");
    setSending(true);
    try {
      const res = await invokeEsign<{ request_id: string }>({
        action: "create",
        title: title.trim() || fileName || localFile?.name || "Documento para firma",
        message: message.trim() || undefined,
        sequential,
        client_id: clientId ?? undefined,
        project_id: projectId ?? undefined,
        file_name: fileName || localFile?.name,
        ...(fileUrl ? { file_url: fileUrl } : { file_base64: await fileToBase64(localFile!) }),
        signers: valid.map((s) => ({ name: s.name.trim(), email: s.email.trim(), user_id: s.user_id })),
      });
      toast.success("Enviado a firma. Los firmantes recibieron un correo.");
      onSent?.(res.request_id);
      reset();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al enviar a firma");
    } finally {
      setSending(false);
    }
  };

  const shownName = fileName || localFile?.name;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <DialogTitle className="flex items-center gap-2">
            <PenTool className="h-5 w-5" /> Enviar a firma
          </DialogTitle>
          <DialogDescription>
            Firma electrónica simple (cartas e documentos internos). Para contratos usa WeTrust.
          </DialogDescription>
        </div>

        {fileUrl || localFile ? (
          <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 border text-sm">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate font-medium">{shownName}</span>
            {!fileUrl && (
              <Button variant="ghost" size="sm" className="ml-auto h-6" onClick={() => setLocalFile(null)}>
                Quitar
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-sm">PDF a firmar</Label>
            <Input type="file" accept="application/pdf" onChange={(e) => setLocalFile(e.target.files?.[0] ?? null)} />
          </div>
        )}
        {fileUrl && <p className="text-xs text-muted-foreground -mt-2">Solo se pueden firmar PDF.</p>}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Título</Label>
            <Input placeholder="Ej: Carta instrucción agente aduanal" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Mensaje (opcional)</Label>
            <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-sm">Firmantes</Label>
              <div className="flex items-center gap-1">
                <select
                  className="h-7 rounded-md border bg-background px-2 text-xs"
                  value=""
                  onChange={(e) => addInternal(e.target.value)}
                >
                  <option value="">+ Equipo Kawiil…</option>
                  {members.filter((m) => !signers.some((s) => s.user_id === m.user_id)).map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.full_name}</option>
                  ))}
                </select>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={addExternal}>
                  <Plus className="h-3 w-3" /> Externo
                </Button>
              </div>
            </div>
            {signers.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-5 text-xs text-muted-foreground">{sequential ? `${i + 1}.` : ""}</span>
                {s.user_id ? (
                  <div className="flex flex-1 items-center gap-2 rounded-md border px-2 h-8 text-xs">
                    <UserRound className="h-3 w-3 text-muted-foreground" />
                    <span className="truncate">{s.name}</span>
                    <Badge variant="secondary" className="ml-auto text-[10px]">Interno</Badge>
                  </div>
                ) : (
                  <>
                    <Input placeholder="Nombre" className="h-8 text-xs" value={s.name} onChange={(e) => update(i, { name: e.target.value })} />
                    <Input placeholder="Email" type="email" className="h-8 text-xs" value={s.email} onChange={(e) => update(i, { email: e.target.value })} />
                  </>
                )}
                <Button variant="ghost" size="sm" className="h-8 px-2 shrink-0" onClick={() => remove(i)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            ))}
            {signers.length === 0 && <p className="text-xs text-muted-foreground">Agrega firmantes internos o externos (clientes, agentes aduanales).</p>}
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={sequential} onChange={(e) => setSequential(e.target.checked)} className="rounded" />
            Firma en orden (cada firmante recibe el correo cuando el anterior firma)
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancelar</Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Enviando...</> : <><PenTool className="h-4 w-4 mr-2" />Enviar a firma</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
