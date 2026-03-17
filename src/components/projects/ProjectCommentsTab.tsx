import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfiles } from "@/hooks/useTasks";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MentionTextarea } from "@/components/tasks/MentionTextarea";
import { Send, MessageSquare } from "lucide-react";
import { formatMX } from "@/lib/dateUtils";
import { toast } from "sonner";

interface Props {
  projectId: string;
  projectName?: string;
}

export function ProjectCommentsTab({ projectId, projectName = "un proyecto" }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: orgProfiles } = useProfiles();
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);

  const { data: comments = [] } = useQuery({
    queryKey: ["project-comments", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_comments")
        .select("*")
        .eq("project_id", projectId)
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

  const addComment = useMutation({
    mutationFn: async ({ content, mentionIds }: { content: string; mentionIds: string[] }) => {
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
      });
      if (error) throw error;

      // Create notifications for mentioned users
      if (mentionIds.length > 0 && profile) {
        const notifications = mentionIds
          .filter((uid) => uid !== user!.id)
          .map((uid) => ({
            user_id: uid,
            type: "mention",
            title: `${profile.full_name} te mencionó en el proyecto "${projectName}"`,
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
      queryClient.invalidateQueries({ queryKey: ["project-comments", projectId] });
      queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notifications-count"] });
      setText("");
      setMentions([]);
      toast.success("Comentario guardado");
    },
    onError: (err: Error) => toast.error("Error: " + err.message),
  });

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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          Comentarios del proyecto ({comments.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {comments.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Sin comentarios aún. Usa @ para mencionar a alguien del equipo.
            </p>
          )}
          {comments.map((c: any) => (
            <div key={c.id} className="flex gap-3">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="text-xs">
                  {c.profile?.full_name?.charAt(0) || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.profile?.full_name || "Usuario"}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatMX(c.created_at, "dd MMM HH:mm")}
                  </span>
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {renderContent(c.content)}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <MentionTextarea
            value={text}
            onChange={setText}
            profiles={orgProfiles ?? []}
            placeholder="Escribe un comentario... usa @ para mencionar"
            rows={2}
            onMentionsChange={setMentions}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                if (text.trim()) addComment.mutate({ content: text, mentionIds: mentions });
              }
            }}
          />
          <Button
            size="icon"
            onClick={() => addComment.mutate({ content: text, mentionIds: mentions })}
            disabled={addComment.isPending || !text.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
