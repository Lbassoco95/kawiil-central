import { useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Upload, ThumbsUp, Trash2, FileText, ExternalLink, Loader2,
} from "lucide-react";
import { FILE_KIND_OPTIONS, fileKindLabel } from "@/lib/activityTypes";
import {
  useTaskFiles, useUploadTaskFile, useDeleteActivityFile, useToggleFileVote,
} from "@/hooks/useActivityFiles";

const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.pdf";

export function TaskFilesDialog({
  activityId, taskId, taskTitle, trigger,
}: { activityId: string; taskId: string; taskTitle: string; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { data: files, isLoading } = useTaskFiles(open ? taskId : undefined);
  const uploadFile = useUploadTaskFile();
  const deleteFile = useDeleteActivityFile();
  const toggleVote = useToggleFileVote();

  const [kind, setKind] = useState("cotizacion");
  const inputRef = useRef<HTMLInputElement>(null);
  const list = files ?? [];

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    for (const file of Array.from(fileList)) {
      await uploadFile.mutateAsync({ activityId, taskId, file, kind }).catch(() => {});
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Cotizaciones y diseños — {taskTitle}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 py-2">
          <p className="text-xs text-muted-foreground">
            Sube fotos o PDFs (cotizaciones, diseños, muestras). El equipo vota por su favorita.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FILE_KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button
              size="sm" variant="outline" disabled={uploadFile.isPending}
              onClick={() => inputRef.current?.click()}
            >
              {uploadFile.isPending
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <Upload className="mr-1.5 h-3.5 w-3.5" />}
              Subir
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Cargando...</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aún no hay archivos en este pendiente.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((f) => (
              <div key={f.id} className="rounded-lg border overflow-hidden flex flex-col">
                <a
                  href={f.signedUrl ?? undefined} target="_blank" rel="noreferrer"
                  className="block bg-muted/40 aspect-video flex items-center justify-center overflow-hidden"
                >
                  {f.isImage && f.signedUrl ? (
                    <img src={f.signedUrl} alt={f.name} className="w-full h-full object-cover" />
                  ) : (
                    <FileText className="h-10 w-10 text-muted-foreground/60" />
                  )}
                </a>
                <div className="p-3 space-y-2 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium leading-tight break-all line-clamp-2">{f.name}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{fileKindLabel(f.kind)}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                    <Button
                      size="sm"
                      variant={f.votedByMe ? "default" : "outline"}
                      className="h-8 gap-1.5"
                      onClick={() => toggleVote.mutate({ file: f, votedByMe: f.votedByMe })}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      {f.voteCount}
                    </Button>
                    <div className="flex items-center gap-1">
                      {f.signedUrl && (
                        <a href={f.signedUrl} target="_blank" rel="noreferrer">
                          <Button size="icon" variant="ghost" className="h-7 w-7">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </a>
                      )}
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                        onClick={() => deleteFile.mutate({ file: f })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
