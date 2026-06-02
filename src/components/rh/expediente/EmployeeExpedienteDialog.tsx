import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, FileText, Check, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DOC_STATUS_LABEL,
  DOC_STATUS_STYLE,
  EXPEDIENTE_DOC_TYPES,
  type EmployeeDocument,
} from "@/lib/expediente";
import {
  useEmployeeProfile,
  useEmployeeDocuments,
  useVerifyDocument,
  getExpedienteSignedUrl,
} from "@/hooks/useExpediente";

interface Props {
  userId: string | null;
  userName: string;
  onOpenChange: (v: boolean) => void;
}

export function EmployeeExpedienteDialog({ userId, userName, onOpenChange }: Props) {
  const open = !!userId;
  const { data: profile } = useEmployeeProfile(userId);
  const { data: docs = [] } = useEmployeeDocuments(userId);
  const docByType = new Map(docs.map((d) => [d.doc_type, d]));

  const fields: { label: string; value: string | null | undefined }[] = [
    { label: "RFC", value: profile?.rfc },
    { label: "CURP", value: profile?.curp },
    { label: "NSS", value: profile?.nss },
    { label: "CLABE", value: profile?.clabe },
    { label: "Banco", value: profile?.bank_name },
    { label: "Nacimiento", value: profile?.birth_date },
    { label: "Domicilio", value: profile?.address },
    { label: "C.P.", value: profile?.postal_code },
    { label: "Contacto emergencia", value: profile?.emergency_contact_name },
    { label: "Tel. emergencia", value: profile?.emergency_contact_phone },
  ].filter((f) => f.value);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Expediente · {userName}</DialogTitle></DialogHeader>

        {/* Datos */}
        <div>
          <p className="mb-1.5 text-sm font-medium">Datos fiscales y personales</p>
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">El colaborador aún no captura sus datos.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              {fields.map((f) => (
                <div key={f.label}>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                  <dd className="break-words">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* Documentos */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Documentos</p>
          {EXPEDIENTE_DOC_TYPES.map((t) => (
            <VerifyRow key={t.key} label={t.label} doc={docByType.get(t.key)} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VerifyRow({ label, doc }: { label: string; doc?: EmployeeDocument }) {
  const verify = useVerifyDocument();
  const [opening, setOpening] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  async function view() {
    if (!doc) return;
    setOpening(true);
    const url = await getExpedienteSignedUrl(doc.file_path);
    setOpening(false);
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("No se pudo abrir el documento.");
  }

  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
        {doc ? (
          <Badge variant="outline" className={cn("text-[10px]", DOC_STATUS_STYLE[doc.status])}>
            {DOC_STATUS_LABEL[doc.status]}
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">Pendiente</Badge>
        )}
        {doc && (
          <>
            <Button size="sm" variant="outline" onClick={view} disabled={opening}>
              {opening ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1.5 h-3.5 w-3.5" />}
              Ver
            </Button>
            {doc.status !== "verified" && (
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => verify.mutate({ doc, status: "verified" })} disabled={verify.isPending}>
                <Check className="mr-1.5 h-3.5 w-3.5" /> Verificar
              </Button>
            )}
            {doc.status !== "rejected" && (
              <Button size="sm" variant="outline" className="text-red-600" onClick={() => setRejecting((v) => !v)}>
                <X className="mr-1.5 h-3.5 w-3.5" /> Rechazar
              </Button>
            )}
          </>
        )}
      </div>

      {doc?.status === "rejected" && doc.note && (
        <p className="mt-1 text-[11px] text-red-600">Motivo: {doc.note}</p>
      )}

      {rejecting && doc && (
        <div className="mt-2 flex items-center gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo del rechazo" className="h-8 text-sm" />
          <Button
            size="sm" variant="destructive" disabled={!note.trim() || verify.isPending}
            onClick={() => verify.mutate(
              { doc, status: "rejected", note: note.trim() },
              { onSuccess: () => { setRejecting(false); setNote(""); } },
            )}
          >
            Confirmar
          </Button>
        </div>
      )}
    </div>
  );
}
