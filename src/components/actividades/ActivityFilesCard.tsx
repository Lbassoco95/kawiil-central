import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Upload, ThumbsUp, Trash2, FileText, ExternalLink, Loader2, Images,
} from "lucide-react";
import { FILE_KIND_OPTIONS, fileKindLabel } from "@/lib/activityTypes";
import {
  useActivityFiles, useUploadActivityFile, useDeleteActivityFile, useToggleFileVote,
} from "@/hooks/useActivityFiles";

const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.pdf";

export function ActivityFilesCard({ activityId }: { activityId: string }) {
  const { data: files, isLoading } = useActivityFiles(activityId);
  const uploadFile = useUploadActivityFile();
  const deleteFile = useDeleteActivityFile();
  const toggleVote = useToggleFileVote();

  const [kind, setKind] = useState("cotizacion");
  const inputRef = useRef<HTMLInputElement>(null);

  const list = files ?? [];

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    for (const file of Array.from(fileList)) {
      await uploadFile.mutateAsync({ activityId, file, kind }).catch(() => {});
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Images className="h-4 w-4" />
          Cotizaciones, diseños y muestras
          {list.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">{list.length}</span>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
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
            size="sm" variant="outline"
            disabled={uploadFile.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {uploadFile.isPending
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            Subir
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Cargando...</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Aún no hay archivos. Sube fotos o PDFs de cotizaciones, diseños o muestras;
            el equipo puede votar por su favorita.
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
      </CardContent>
    </Card>
  );
}
