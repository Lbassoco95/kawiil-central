import { useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTaskDetail, useAddComment, useProfiles } from "@/hooks/useTasks";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "@/components/tasks/MentionTextarea";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { DropboxFilePicker } from "@/components/projects/DropboxFilePicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { genericLimits } from "@/lib/fileIntake/limits";
import { formatMX } from "@/lib/dateUtils";
import { renderTextWithMentionHighlights } from "@/lib/renderMentionHighlights";
import { extractDropboxFilenameFromUrl, getDropboxLinkDisplayLabel } from "@/lib/dropboxLinkLabel";
import { sanitizeStorageFileName } from "@/lib/storageFilename";
import { Send, Link2, X, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface CommentAttachment {
  type: "image" | "dropbox" | "link";
  name: string;
  url: string;
}

const LINK_REGEX = /📎\s*\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Comentarios de una tarea con el mismo diseño y funciones del detalle:
 * menciones (@), subir archivos, adjuntar desde Dropbox y pegar enlaces.
 * Componente autónomo reutilizable (detalle y edición rápida en línea).
 */
export function TaskComments({ taskId }: { taskId: string }) {
  const { comments } = useTaskDetail(taskId);
  const addComment = useAddComment();
  const { data: orgProfiles } = useProfiles();

  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<CommentAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [showLinkPopover, setShowLinkPopover] = useState(false);
  const [showDropbox, setShowDropbox] = useState(false);

  const renderMentions = (t: string, keyOffset: number): ReactNode[] =>
    renderTextWithMentionHighlights(t, `cm-${keyOffset}`);

  const renderCommentContent = (content: string): ReactNode => {
    const elements: ReactNode[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    const rx = new RegExp(LINK_REGEX.source, "g");
    while ((m = rx.exec(content)) !== null) {
      const before = content.slice(lastIndex, m.index);
      if (before) elements.push(...renderMentions(before, elements.length));
      elements.push(
        <a
          key={`link-${m.index}`}
          href={m[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline break-all max-w-full"
        >
          📎 <span className="truncate max-w-[200px]">{m[1]}</span>
          <ExternalLink className="h-3 w-3 shrink-0 inline" />
        </a>,
      );
      lastIndex = m.index + m[0].length;
    }
    const remaining = content.slice(lastIndex);
    if (remaining) elements.push(...renderMentions(remaining, elements.length));
    return elements.length > 0 ? elements : content;
  };

  const send = () => {
    if (!text.trim() && attachments.length === 0) return;
    let finalContent = text;
    if (attachments.length > 0) {
      const lines = attachments.map((a) => `📎 [${a.name}](${a.url})`).join("\n");
      finalContent = finalContent ? `${finalContent}\n${lines}` : lines;
    }
    addComment.mutate(
      { taskId, content: finalContent, mentions },
      {
        onSuccess: () => {
          setText("");
          setMentions([]);
          setAttachments([]);
        },
      },
    );
  };

  const uploadFiles = async (files: File[]) => {
    if (!files || files.length === 0) return;
    setPendingFiles(files);
    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > 25 * 1024 * 1024) {
          toast.error(`${file.name} excede 25MB`);
          continue;
        }
        const safeName = sanitizeStorageFileName(file.name);
        const path = `comment-attachments/${Date.now()}_${safeName}`;
        const { error } = await supabase.storage.from("documents").upload(path, file);
        if (error) throw error;
        const { data: urlData } = await supabase.storage
          .from("documents")
          .createSignedUrl(path, 60 * 60 * 24 * 365);
        if (!urlData?.signedUrl) throw new Error("No se pudo generar URL");
        const isImage = file.type.startsWith("image/");
        setAttachments((prev) => [
          ...prev,
          { type: isImage ? "image" : "link", name: file.name, url: urlData.signedUrl },
        ]);
      }
    } catch (e) {
      toast.error("Error al subir archivo: " + (e instanceof Error ? e.message : ""));
    } finally {
      setUploading(false);
      setPendingFiles([]);
    }
  };

  const addLink = () => {
    const u = linkInput.trim();
    if (!u) return;
    const isDbx = u.includes("dropbox.com");
    const attName = isDbx
      ? extractDropboxFilenameFromUrl(u) ?? getDropboxLinkDisplayLabel(u)
      : u.split("/").pop() || "Enlace";
    setAttachments((prev) => [...prev, { type: isDbx ? "dropbox" : "link", name: attName, url: u }]);
    setLinkInput("");
    setShowLinkPopover(false);
  };

  return (
    <div className="space-y-3">
      {comments.length > 0 && (
        <div className="comment-list max-h-[220px] overflow-y-auto">
          {comments.map((c: any) => (
            <div key={c.id} className="comment">
              <UserAvatar
                name={c.profile?.full_name}
                avatarUrl={c.profile?.avatar_url}
                userId={c.user_id}
                size="md"
                className="shrink-0"
              />
              <div className="body">
                <div className="head">
                  <span className="who">{c.profile?.full_name || "Usuario"}</span>
                  <span className="when">{formatMX(c.created_at, "dd MMM HH:mm")}</span>
                </div>
                <div className="text">{renderCommentContent(c.content)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-border/50 bg-muted/30">
          {attachments.map((att, i) => (
            <div key={i} className="relative group">
              {att.type === "image" ? (
                <img src={att.url} alt={att.name} className="h-12 w-auto rounded border border-border object-cover" />
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] bg-background px-2 py-1 rounded border">
                  {att.type === "dropbox" ? "📦" : "🔗"} {att.name}
                </span>
              )}
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute -top-1 -right-1 h-4 w-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="comment-composer">
        <div className="flex-1 min-w-0">
          <MentionTextarea
            value={text}
            onChange={setText}
            profiles={orgProfiles ?? []}
            placeholder="Escribe un comentario... usa @ para mencionar"
            rows={2}
            onMentionsChange={setMentions}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
          />
        </div>
        <div className="flex flex-col gap-0.5 shrink-0">
          <FileDropzone
            files={pendingFiles}
            onChange={uploadFiles}
            limits={genericLimits}
            variant="button"
            disabled={uploading}
            showChips={false}
            buttonSize="icon"
            buttonVariant="ghost"
            className="shrink-0"
            enableFolderPicker
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setShowDropbox(true)}
            title="Seleccionar de Dropbox"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 2l6 3.75L6 9.5 0 5.75zm12 0l6 3.75-6 3.75-6-3.75zM0 13.25L6 9.5l6 3.75L6 17zm12 0l6-3.75 6 3.75L18 17zM6 18.25l6-3.75 6 3.75L12 22z" />
            </svg>
          </Button>
          <Popover open={showLinkPopover} onOpenChange={setShowLinkPopover}>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Pegar enlace">
                <Link2 className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="end">
              <div className="flex gap-1">
                <input
                  className="flex-1 text-xs border border-input rounded px-2 py-1 bg-background"
                  placeholder="https://..."
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && linkInput.trim()) addLink();
                  }}
                />
                <Button size="sm" className="h-7 px-2 text-xs" disabled={!linkInput.trim()} onClick={addLink}>
                  Añadir
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <Button
          size="icon"
          className="h-8 w-8 shrink-0 self-end"
          onClick={send}
          disabled={addComment.isPending || (!text.trim() && attachments.length === 0)}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      <DropboxFilePicker
        open={showDropbox}
        onClose={() => setShowDropbox(false)}
        onSelect={(file) =>
          setAttachments((prev) => [...prev, { type: "dropbox", name: file.name, url: file.url }])
        }
      />
    </div>
  );
}
