import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Link2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfiles } from "@/hooks/useTasks";
import { formatMX } from "@/lib/dateUtils";
import {
  combineBodyAndAttachments,
  commentPlainText,
  parseComment,
  richTextIsEmpty,
} from "@/lib/commentContent";
import { extractDropboxFilenameFromUrl, getDropboxLinkDisplayLabel } from "@/lib/dropboxLinkLabel";
import { sanitizeStorageFileName } from "@/lib/storageFilename";
import { genericLimits } from "@/lib/fileIntake/limits";
import { sendSlackNotification } from "@/lib/slackNotifications";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { AttachmentCard } from "@/components/shared/AttachmentCard";
import { DropboxFilePicker } from "@/components/projects/DropboxFilePicker";
import { CommentItem, type CommentSaver } from "@/components/tasks/CommentItem";
import { RichCommentEditor, type RichCommentEditorHandle } from "@/components/tasks/RichCommentEditor";
import type { Database } from "@/integrations/supabase/types";

type LawsuitRow = Database["public"]["Tables"]["project_lawsuits"]["Row"];
type CommentRow = Database["public"]["Tables"]["project_lawsuit_comments"]["Row"];

interface Attachment {
  type: "image" | "dropbox" | "link";
  name: string;
  url: string;
}

interface Props {
  lawsuit: LawsuitRow;
  /** Carpeta de Dropbox donde abre el selector (la del cliente / juicios). */
  dropboxPath?: string;
  lockDropboxToPath?: boolean;
  /** "comments": conversación; "documents": solo archivos y enlaces de la conversación. */
  mode: "comments" | "documents";
}

/** Comentarios del juicio: misma experiencia que en tareas (menciones, archivos, Dropbox, enlaces). */
export function LawsuitCommentsPanel({ lawsuit, dropboxPath, lockDropboxToPath, mode }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: orgProfiles } = useProfiles();
  const editorRef = useRef<RichCommentEditorHandle>(null);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [showLinkPopover, setShowLinkPopover] = useState(false);
  const [showDropbox, setShowDropbox] = useState(false);

  const queryKey = ["lawsuit-comments", lawsuit.id];
  const profiles = useMemo(() => orgProfiles ?? [], [orgProfiles]);
  const knownNames = profiles.map((p) => p.full_name).filter(Boolean) as string[];
  const bodyEmpty = richTextIsEmpty(text);

  const { data: rows = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_lawsuit_comments")
        .select("*")
        .eq("lawsuit_id", lawsuit.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as CommentRow[];
    },
  });

  const comments = useMemo(
    () =>
      rows.map((r) => {
        const p = profiles.find((x) => x.user_id === r.user_id);
        return { ...r, profile: p ? { full_name: p.full_name, avatar_url: p.avatar_url } : null };
      }),
    [rows, profiles],
  );

  const notifyMentions = async (content: string, ids: string[]) => {
    const targets = ids.filter((id) => id !== user?.id);
    if (targets.length === 0) return;
    const preview = commentPlainText(content);
    sendSlackNotification("comment_mention", {
      task_title: `Juicio ${lawsuit.name}`,
      comment_preview: preview.substring(0, 100),
      mentioned_ids: targets,
    });
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", user!.id)
        .single();
      await supabase.from("notifications").insert(
        targets.map((uid) => ({
          user_id: uid,
          type: "mention" as const,
          title: `${profile?.full_name ?? "Alguien"} te mencionó en el juicio ${lawsuit.name}`,
          body: preview.substring(0, 200),
          entity_type: "project",
          entity_id: lawsuit.project_id,
          source_user_id: user!.id,
          organization_id: lawsuit.organization_id,
        })),
      );
      queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notifications-count"] });
    } catch {
      // No crítico: el comentario ya se guardó.
    }
  };

  const post = useMutation({
    mutationFn: async (input: { content: string; mentions: string[] }) => {
      const { error } = await supabase.from("project_lawsuit_comments").insert({
        lawsuit_id: lawsuit.id,
        organization_id: lawsuit.organization_id,
        user_id: user!.id,
        content: input.content,
        mentions: input.mentions,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey });
      void notifyMentions(vars.content, vars.mentions);
    },
    onError: (e: Error) => toast.error("No se pudo guardar el comentario: " + e.message),
  });

  const update = useMutation({
    mutationFn: async (v: { commentId: string; content: string; mentions: string[]; previousMentions: string[] }) => {
      const { error } = await supabase
        .from("project_lawsuit_comments")
        .update({ content: v.content, mentions: v.mentions })
        .eq("id", v.commentId)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: (_, v) => {
      queryClient.invalidateQueries({ queryKey });
      const prev = new Set(v.previousMentions);
      void notifyMentions(
        v.content,
        v.mentions.filter((id) => !prev.has(id)),
      );
    },
    onError: (e: Error) => toast.error("No se pudo actualizar el comentario: " + e.message),
  });
  const saver: CommentSaver = {
    mutate: (vars, opts) => update.mutate(vars, opts),
    isPending: update.isPending,
  };

  const send = () => {
    if (bodyEmpty && attachments.length === 0) return;
    const html = editorRef.current?.getHtml() ?? text;
    const content = combineBodyAndAttachments(bodyEmpty ? "" : html, attachments);
    post.mutate(
      { content, mentions },
      {
        onSuccess: () => {
          editorRef.current?.clear();
          setText("");
          setMentions([]);
          setAttachments([]);
        },
      },
    );
  };

  /** En la pestaña Documentos cada archivo/enlace se publica de inmediato como adjunto. */
  const addAttachment = (att: Attachment) => {
    if (mode === "documents") {
      post.mutate({ content: combineBodyAndAttachments("", [att]), mentions: [] });
    } else {
      setAttachments((prev) => [...prev, att]);
    }
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
        const path = `comment-attachments/${Date.now()}_${sanitizeStorageFileName(file.name)}`;
        const { error } = await supabase.storage.from("documents").upload(path, file);
        if (error) throw error;
        const { data: urlData } = await supabase.storage
          .from("documents")
          .createSignedUrl(path, 60 * 60 * 24 * 365);
        if (!urlData?.signedUrl) throw new Error("No se pudo generar URL");
        addAttachment({
          type: file.type.startsWith("image/") ? "image" : "link",
          name: file.name,
          url: urlData.signedUrl,
        });
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
    const name = isDbx
      ? extractDropboxFilenameFromUrl(u) ?? getDropboxLinkDisplayLabel(u)
      : u.split("/").pop() || "Enlace";
    addAttachment({ type: isDbx ? "dropbox" : "link", name, url: u });
    setLinkInput("");
    setShowLinkPopover(false);
  };

  const toolbar = (
    <>
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
              onKeyDown={(e) => e.key === "Enter" && linkInput.trim() && addLink()}
            />
            <Button size="sm" className="h-7 px-2 text-xs" disabled={!linkInput.trim()} onClick={addLink}>
              Añadir
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );

  const dropboxPicker = (
    <DropboxFilePicker
      open={showDropbox}
      onClose={() => setShowDropbox(false)}
      initialPath={dropboxPath}
      lockToInitialPath={lockDropboxToPath}
      onSelect={(file) => addAttachment({ type: "dropbox", name: file.name, url: file.url })}
    />
  );

  if (mode === "documents") {
    const docs = comments
      .flatMap((c) =>
        parseComment(c.content).attachments.map((a, i) => ({
          key: `${c.id}-${i}`,
          ...a,
          at: c.created_at,
          who: c.profile?.full_name ?? "Usuario",
        })),
      )
      .reverse();

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {docs.length === 0
              ? "Sin documentos"
              : `${docs.length} documento${docs.length === 1 ? "" : "s"} · incluye los adjuntos de Comentarios`}
          </p>
          <div className="flex items-center gap-0.5">
            {toolbar}
            <Button size="sm" variant="outline" className="ml-1 h-7 text-xs" onClick={() => setShowDropbox(true)}>
              <FolderOpen className="h-3.5 w-3.5 mr-1" /> Explorar Dropbox
            </Button>
          </div>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : docs.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Sube PDFs y archivos, o elige documentos de Dropbox para consultarlos aquí.
          </div>
        ) : (
          <ul className="space-y-2">
            {docs.map((d) => (
              <li key={d.key} className="space-y-1">
                <AttachmentCard name={d.name} url={d.url} />
                <p className="text-[11px] text-muted-foreground px-1">
                  {d.who} · {formatMX(d.at, "dd MMM yyyy HH:mm")}
                </p>
              </li>
            ))}
          </ul>
        )}
        {dropboxPicker}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Aún no hay comentarios. Inicia la conversación de este juicio.
        </p>
      ) : (
        <div className="comment-list">
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              saveComment={saver}
              currentUserId={user?.id}
              profiles={profiles}
              knownNames={knownNames}
            />
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
          <RichCommentEditor
            ref={editorRef}
            profiles={profiles}
            placeholder="Escribe un comentario... usa @ para mencionar"
            onChange={setText}
            onMentionsChange={setMentions}
            onSubmit={send}
          />
        </div>
        <div className="flex flex-col gap-0.5 shrink-0">{toolbar}</div>
        <Button
          size="icon"
          className="h-8 w-8 shrink-0 self-end"
          onClick={send}
          disabled={post.isPending || (bodyEmpty && attachments.length === 0)}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      {dropboxPicker}
    </div>
  );
}
