import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfiles } from "@/hooks/useTasks";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "@/components/tasks/MentionTextarea";
import {
  Send, MessageSquare, Paperclip, ScanLine,
  Link2, X, Loader2, ExternalLink,
} from "lucide-react";
import { formatMX } from "@/lib/dateUtils";
import { toast } from "sonner";
import { DropboxFilePicker } from "./DropboxFilePicker";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

interface Attachment {
  type: "image" | "dropbox" | "link";
  name: string;
  url: string;
}

interface Props {
  projectId: string;
  stepKey: string;
  stepLabel: string;
}

export function StepComments({ projectId, stepKey, stepLabel }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: orgProfiles } = useProfiles();
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showDropbox, setShowDropbox] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [showLinkPopover, setShowLinkPopover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: comments = [] } = useQuery({
    queryKey: ["step-comments", projectId, stepKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_comments")
        .select("*")
        .eq("project_id", projectId)
        .eq("step_key", stepKey)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const userIds = [...new Set(data.map((c: any) => c.user_id))];
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", userIds);

      return data.map((c: any) => ({
        ...c,
        profile: profiles?.find((p) => p.user_id === c.user_id),
      }));
    },
    enabled: !!user,
  });

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 * 1024) {
          toast.error(`${file.name} excede 25MB`);
          continue;
        }
        const path = `comment-attachments/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from("documents").upload(path, file);
        if (error) throw error;
        const { data: urlData } = await supabase.storage.from("documents").createSignedUrl(path, 60 * 60 * 24 * 365);
        if (!urlData?.signedUrl) throw new Error("No se pudo generar URL");
        const isImage = file.type.startsWith("image/");
        setAttachments((prev) => [
          ...prev,
          { type: isImage ? "image" : "link", name: file.name, url: urlData.signedUrl },
        ]);
      }
    } catch (e: any) {
      toast.error("Error al subir archivo: " + e.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const addComment = useMutation({
    mutationFn: async ({
      content,
      mentionIds,
      commentAttachments,
    }: {
      content: string;
      mentionIds: string[];
      commentAttachments: Attachment[];
    }) => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id, full_name")
        .eq("user_id", user!.id)
        .single();

      const { error } = await supabase.from("project_comments").insert({
        project_id: projectId,
        user_id: user!.id,
        content,
        mentions: mentionIds,
        step_key: stepKey,
        attachments: commentAttachments,
      } as any);
      if (error) throw error;

      if (mentionIds.length > 0 && profile) {
        const notifications = mentionIds
          .filter((uid) => uid !== user!.id)
          .map((uid) => ({
            user_id: uid,
            type: "mention",
            title: `${profile.full_name} te mencionó en "${stepLabel}"`,
            body: content.substring(0, 200),
            entity_type: "project",
            entity_id: projectId,
            source_user_id: user!.id,
            organization_id: profile.organization_id,
          }));

        if (notifications.length > 0) {
          await supabase.from("notifications").insert(notifications);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["step-comments", projectId, stepKey] });
      setText("");
      setMentions([]);
      setAttachments([]);
    },
    onError: (err: Error) => toast.error("Error: " + err.message),
  });

  const handleSubmit = () => {
    if (!text.trim() && attachments.length === 0) return;
    addComment.mutate({
      content: text,
      mentionIds: mentions,
      commentAttachments: attachments,
    });
  };

  const renderContent = (content: string) => {
    const parts = content.split(/(@\w[\w\s]*\w)/g);
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        const name = part.slice(1);
        const found = orgProfiles?.find(
          (p) => p.full_name.toLowerCase() === name.toLowerCase()
        );
      if (found) {
          return (
            <span key={i} className="text-primary font-bold">
              {part}
            </span>
          );
        }
      }
      return part;
    });
  };

  const renderAttachments = (atts: Attachment[] | null | undefined) => {
    if (!atts || atts.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5 mt-1">
        {atts.map((att, i) => (
          <div key={i}>
            {att.type === "image" ? (
              <a href={att.url} target="_blank" rel="noopener noreferrer">
                <img
                  src={att.url}
                  alt={att.name}
                  className="h-16 w-auto rounded border border-border object-cover cursor-pointer hover:opacity-80 transition-opacity"
                />
              </a>
            ) : (
              <a
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] bg-muted px-2 py-1 rounded hover:bg-muted/80 transition-colors"
              >
                {att.type === "dropbox" ? (
                  <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 2l6 3.75L6 9.5 0 5.75zm12 0l6 3.75-6 3.75-6-3.75zM0 13.25L6 9.5l6 3.75L6 17zm12 0l6-3.75 6 3.75L18 17zM6 18.25l6-3.75 6 3.75L12 22z" />
                  </svg>
                ) : (
                  <Link2 className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate max-w-[120px]">{att.name}</span>
                <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-50" />
              </a>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        <MessageSquare className="h-3 w-3" /> Comentarios ({comments.length})
      </label>

      {comments.length > 0 && (
        <div className="space-y-2 max-h-[250px] overflow-y-auto rounded-md border border-border/50 p-2">
          {comments.map((c: any) => (
            <div key={c.id} className="flex gap-2">
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarFallback className="text-[10px]">
                  {c.profile?.full_name?.charAt(0) || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{c.profile?.full_name || "Usuario"}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatMX(c.created_at, "dd MMM HH:mm")}
                  </span>
                </div>
                {c.content && (
                  <p className="text-xs text-foreground whitespace-pre-wrap">
                    {renderContent(c.content)}
                  </p>
                )}
                {renderAttachments(c.attachments as Attachment[] | null)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending attachments preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-border/50 bg-muted/30">
          {attachments.map((att, i) => (
            <div key={i} className="relative group">
              {att.type === "image" ? (
                <img
                  src={att.url}
                  alt={att.name}
                  className="h-12 w-auto rounded border border-border object-cover"
                />
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] bg-background px-2 py-1 rounded border">
                  {att.type === "dropbox" ? "📦" : "🔗"} {att.name}
                </span>
              )}
              <button
                onClick={() => removeAttachment(i)}
                className="absolute -top-1 -right-1 h-4 w-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <div className="flex-1 min-w-0">
          <MentionTextarea
            value={text}
            onChange={setText}
            profiles={orgProfiles ?? []}
            placeholder="Comentario... usa @ para mencionar"
            rows={1}
            className="text-xs min-h-[32px]"
            onMentionsChange={setMentions}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleSubmit();
              }
            }}
          />
        </div>

        {/* Attachment buttons */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFileUpload(e.target.files)}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Adjuntar archivo desde equipo"
          >
            {uploading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Paperclip className="h-3 w-3" />
            )}
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setShowDropbox(true)}
            title="Seleccionar de Dropbox"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 2l6 3.75L6 9.5 0 5.75zm12 0l6 3.75-6 3.75-6-3.75zM0 13.25L6 9.5l6 3.75L6 17zm12 0l6-3.75 6 3.75L18 17zM6 18.25l6-3.75 6 3.75L12 22z" />
            </svg>
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => {
              // Try Dropbox mobile app deep link first, fallback to web
              const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
              if (isMobile) {
                window.location.href = "dbapi-8://document_scanner";
                // Fallback after a short delay if app didn't open
                setTimeout(() => {
                  window.open("https://www.dropbox.com/document-scanner", "_blank");
                }, 1500);
              } else {
                window.open("https://www.dropbox.com/document-scanner", "_blank");
              }
              toast.info("Escanea el documento con Dropbox y luego selecciónalo con el botón de Dropbox para adjuntarlo.");
            }}
            title="Escanear con Dropbox"
          >
            <ScanLine className="h-3 w-3" />
          </Button>

          <Popover open={showLinkPopover} onOpenChange={setShowLinkPopover}>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                title="Pegar enlace"
              >
                <Link2 className="h-3 w-3" />
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
                    if (e.key === "Enter" && linkInput.trim()) {
                      setAttachments((prev) => [
                        ...prev,
                        {
                          type: linkInput.includes("dropbox.com") ? "dropbox" : "link",
                          name: linkInput.split("/").pop() || "Enlace",
                          url: linkInput.trim(),
                        },
                      ]);
                      setLinkInput("");
                      setShowLinkPopover(false);
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={!linkInput.trim()}
                  onClick={() => {
                    setAttachments((prev) => [
                      ...prev,
                      {
                        type: linkInput.includes("dropbox.com") ? "dropbox" : "link",
                        name: linkInput.split("/").pop() || "Enlace",
                        url: linkInput.trim(),
                      },
                    ]);
                    setLinkInput("");
                    setShowLinkPopover(false);
                  }}
                >
                  Añadir
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 self-end"
          onClick={handleSubmit}
          disabled={addComment.isPending || (!text.trim() && attachments.length === 0)}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>

      <DropboxFilePicker
        open={showDropbox}
        onClose={() => setShowDropbox(false)}
        onSelect={(file) => {
          setAttachments((prev) => [
            ...prev,
            { type: "dropbox", name: file.name, url: file.url },
          ]);
        }}
      />
    </div>
  );
}
