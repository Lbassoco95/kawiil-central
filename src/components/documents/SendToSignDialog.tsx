import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { invokeEsign } from "@/lib/esign";
import { base64ToBytes, bytesToBase64, signerColor } from "@/lib/esignPdf";
import { PlaceSignaturesDialog, type PlacedField } from "@/components/esign/PlaceSignaturesDialog";
import { toast } from "sonner";
import { Loader2, PenTool, Plus, Trash2, FileText, UserRound, MapPin } from "lucide-react";

interface Signer {
  key: string;
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
  const [placing, setPlacing] = useState(false);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

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
    setPdfBytes(null);
    setFields([]);
    setActiveKey(null);
    setPlacing(false);
  };

  // Si cambia el archivo, los bytes y recuadros anteriores ya no aplican.
  useEffect(() => {
    setPdfBytes(null);
    setFields([]);
  }, [fileUrl, localFile]);

  const openPlacement = async () => {
    if (!signers.length) return toast.error("Agrega al menos un firmante primero");
    if (!fileUrl && !localFile) return toast.error("Selecciona un PDF");
    setActiveKey((k) => k ?? signers[0].key);
    if (!pdfBytes) {
      setLoadingPdf(true);
      try {
        if (localFile) {
          if (localFile.type && localFile.type !== "application/pdf") throw new Error("Solo se pueden firmar archivos PDF");
          setPdfBytes(new Uint8Array(await localFile.arrayBuffer()));
        } else {
          const r = await invokeEsign<{ file_base64: string }>({ action: "preview", file_url: fileUrl });
          setPdfBytes(base64ToBytes(r.file_base64));
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo abrir el documento");
        setLoadingPdf(false);
        return;
      }
      setLoadingPdf(false);
    }
    setPlacing(true);
  };

  const addInternal = (userId: string) => {
    const m = members.find((x) => x.user_id === userId);
    if (!m || signers.some((s) => s.user_id === userId)) return;
    setSigners((p) => [...p, { key: crypto.randomUUID(), name: m.full_name, email: m.email, user_id: m.user_id }]);
  };
  const addExternal = () => setSigners((p) => [...p, { key: crypto.randomUUID(), name: "", email: "" }]);
  const update = (i: number, patch: Partial<Signer>) => setSigners((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => {
    const key = signers[i]?.key;
    setSigners((p) => p.filter((_, idx) => idx !== i));
    setFields((f) => f.filter((x) => x.signerKey !== key));
  };

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
        ...(pdfBytes
          ? { file_base64: bytesToBase64(pdfBytes) }
          : fileUrl ? { file_url: fileUrl } : { file_base64: await fileToBase64(localFile!) }),
        signers: valid.map((s) => ({
          name: s.name.trim(),
          email: s.email.trim(),
          user_id: s.user_id,
          fields: fields
            .filter((f) => f.signerKey === s.key)
            .map(({ page, x, y, w, h }) => ({ page, x, y, w, h })),
        })),
      });
      const placed = fields.length;
      toast.success(
        placed
          ? `Enviado a firma con ${placed} recuadro${placed === 1 ? "" : "s"}. Los firmantes recibieron un correo.`
          : "Enviado a firma sin lugar definido: la firma irá en la hoja de firmas al final del PDF.",
      );
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

          <div className="space-y-1.5 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">Lugar de la firma</p>
                <p className="text-xs text-muted-foreground">
                  {fields.length
                    ? `${fields.length} recuadro${fields.length === 1 ? "" : "s"} colocado${fields.length === 1 ? "" : "s"}`
                    : "Opcional: elige en qué página firma cada persona."}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" className="gap-1 shrink-0" onClick={openPlacement} disabled={loadingPdf}>
                {loadingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                Colocar firmas
              </Button>
            </div>
            {fields.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {signers.map((sg) => {
                  const n = fields.filter((f) => f.signerKey === sg.key).length;
                  return (
                    <Badge key={sg.key} variant="outline" className="gap-1 text-[10px]" style={{ borderColor: signerColor(signers, sg.key) }}>
                      {sg.name || "Firmante"}: {n || "sin recuadro"}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={sequential} onChange={(e) => setSequential(e.target.checked)} className="rounded" />
            Firma en orden (cada firmante recibe el correo cuando el anterior firma)
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancelar</Button>
          {fields.length === 0 ? (
            <>
              <Button variant="ghost" onClick={handleSend} disabled={sending || loadingPdf}>
                Enviar sin lugar de firma
              </Button>
              <Button onClick={openPlacement} disabled={sending || loadingPdf}>
                {loadingPdf ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MapPin className="h-4 w-4 mr-2" />}
                Colocar firmas y enviar
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={openPlacement} disabled={sending || loadingPdf}>
                <MapPin className="h-4 w-4 mr-2" /> Editar recuadros
              </Button>
              <Button onClick={handleSend} disabled={sending}>
                {sending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Enviando...</> : <><PenTool className="h-4 w-4 mr-2" />Enviar a firma</>}
              </Button>
            </>
          )}
        </div>
      </DialogContent>

      <PlaceSignaturesDialog
        open={placing}
        onClose={() => setPlacing(false)}
        pdfData={pdfBytes}
        signers={signers.map((sg) => ({ key: sg.key, name: sg.name }))}
        fields={fields}
        onFieldsChange={setFields}
        activeKey={activeKey}
        onActiveKeyChange={setActiveKey}
        onSend={handleSend}
        sending={sending}
      />
    </Dialog>
  );
}
