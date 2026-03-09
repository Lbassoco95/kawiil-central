import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfiles } from "@/hooks/useTasks";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "@/components/tasks/MentionTextarea";
import { Send, MessageSquare } from "lucide-react";
import { formatMX } from "@/lib/dateUtils";
import { toast } from "sonner";

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
        step_key: stepKey,
      });
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
            <span key={i} className="text-primary font-medium">
              {part}
            </span>
          );
        }
      }
      return part;
    });
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        <MessageSquare className="h-3 w-3" /> Comentarios ({comments.length})
      </label>

      {comments.length > 0 && (
        <div className="space-y-2 max-h-[200px] overflow-y-auto rounded-md border border-border/50 p-2">
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
                <p className="text-xs text-foreground whitespace-pre-wrap">
                  {renderContent(c.content)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
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
              if (text.trim()) addComment.mutate({ content: text, mentionIds: mentions });
            }
          }}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={() => addComment.mutate({ content: text, mentionIds: mentions })}
          disabled={addComment.isPending || !text.trim()}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
