import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, FileText, Trash2, Paperclip, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  useCandidateAttachments,
  useUploadCandidateAttachment,
  useUpdateCandidateAttachment,
  useDeleteCandidateAttachment,
  getCvSignedUrl,
} from "@/hooks/useRecruitment";
import type { Candidate, CandidateAttachment } from "@/lib/recruitment";

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Lista y gestión de archivos adjuntos del candidato (múltiples, con nombre/comentario). */
export function CandidateAttachments({ candidate, isAdmin }: { candidate: Candidate; isAdmin: boolean }) {
  const { data: attachments = [], isLoading } = useCandidateAttachments(candidate.id);
  const upload = useUploadCandidateAttachment();
  const del = useDeleteCandidateAttachment();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  async function handleOpen(att: CandidateAttachment) {
    setOpening(att.id);
    const url = await getCvSignedUrl(att.file_path);
    setOpening(null);
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("No se pudo abrir el archivo.");
  }

  function handleUpload() {
    if (!pendingFile) return;
    upload.mutate(
      { candidate, file: pendingFile, label },
      {
        onSuccess: () => {
          setPendingFile(null);
          setLabel("");
          if (fileRef.current) fileRef.current.value = "";
        },
      },
    );
  }

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5">
        <Paperclip className="h-3.5 w-3.5" /> Archivos adjuntos
      </Label>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin archivos adjuntos.</p>
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((att) => (
            <AttachmentRow
              key={att.id}
              att={att}
              isAdmin={isAdmin}
              opening={opening === att.id}
              onOpen={() => handleOpen(att)}
              onDelete={() => del.mutate({ attachment: att })}
              deleting={del.isPending}
            />
          ))}
        </ul>
      )}

      {isAdmin && (
        <div className="space-y-2 rounded-md border border-dashed p-2.5">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,image/*,application/pdf"
            className="hidden"
            onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="shrink-0">
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              {pendingFile ? "Cambiar archivo" : "Elegir archivo"}
            </Button>
            <span className="truncate text-xs text-muted-foreground">
              {pendingFile ? pendingFile.name : "PDF, imagen, Word o Excel"}
            </span>
          </div>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="¿Qué es este archivo? (ej. Identificación, Comprobante, Carta…)"
            className="h-8 text-sm"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleUpload} disabled={!pendingFile || upload.isPending}>
              {upload.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
              Agregar adjunto
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AttachmentRow({
  att,
  isAdmin,
  opening,
  onOpen,
  onDelete,
  deleting,
}: {
  att: CandidateAttachment;
  isAdmin: boolean;
  opening: boolean;
  onOpen: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const rename = useUpdateCandidateAttachment();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(att.label ?? "");
  const [confirm, setConfirm] = useState(false);

  return (
    <li className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      {editing ? (
        <div className="flex flex-1 items-center gap-1">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="h-7 text-sm" autoFocus />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            disabled={rename.isPending}
            onClick={() => rename.mutate({ attachment: att, label: draft }, { onSuccess: () => setEditing(false) })}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => { setEditing(false); setDraft(att.label ?? ""); }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left" title="Abrir archivo">
          <span className="block truncate font-medium">{att.label || att.file_name}</span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {att.file_name}
            {att.size_bytes ? ` · ${formatSize(att.size_bytes)}` : ""}
          </span>
        </button>
      )}

      {!editing && (
        <>
          {opening && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
          {isAdmin && (
            <>
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Renombrar" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {confirm ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" disabled={deleting} onClick={onDelete}>
                    {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Sí"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirm(false)}>No</Button>
                </div>
              ) : (
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-red-600 hover:text-red-600" title="Eliminar" onClick={() => setConfirm(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )}
        </>
      )}
    </li>
  );
}
