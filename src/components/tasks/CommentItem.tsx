import { useRef, useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Button } from "@/components/ui/button";
import { AttachmentCard } from "@/components/shared/AttachmentCard";
import { formatMX } from "@/lib/dateUtils";
import {
  parseComment,
  attachmentsToLines,
  CommentTextBody,
} from "@/lib/commentContent";
import {
  RichCommentEditor,
  type RichCommentEditorHandle,
  type CommentProfile,
} from "@/components/tasks/RichCommentEditor";
import { useUpdateComment } from "@/hooks/useTasks";

export interface CommentItemData {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at?: string | null;
  mentions?: string[] | null;
  profile?: { full_name?: string | null; avatar_url?: string | null } | null;
}

interface Props {
  comment: CommentItemData;
  taskId: string;
  currentUserId?: string;
  profiles: CommentProfile[];
  knownNames: string[];
}

/** Un comentario ha sido editado si su updated_at supera al created_at con holgura. */
function wasEdited(comment: CommentItemData): boolean {
  if (!comment.updated_at) return false;
  const created = new Date(comment.created_at).getTime();
  const updated = new Date(comment.updated_at).getTime();
  return updated - created > 2000;
}

export function CommentItem({ comment, taskId, currentUserId, profiles, knownNames }: Props) {
  const updateComment = useUpdateComment();
  const editorRef = useRef<RichCommentEditorHandle>(null);
  const [editing, setEditing] = useState(false);
  const [editHtml, setEditHtml] = useState("");
  const [editMentions, setEditMentions] = useState<string[]>([]);

  const { body, attachments } = parseComment(comment.content);
  const isAuthor = !!currentUserId && currentUserId === comment.user_id;

  const startEdit = () => {
    setEditHtml(body);
    setEditMentions(comment.mentions ?? []);
    setEditing(true);
  };

  const saveEdit = () => {
    const html = editorRef.current?.getHtml() ?? editHtml;
    if (editorRef.current?.isEmpty()) return;
    const lines = attachmentsToLines(attachments);
    const content = lines ? `${html}\n${lines}` : html;
    updateComment.mutate(
      { commentId: comment.id, taskId, content, mentions: editMentions },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <div className="comment group">
      <UserAvatar
        name={comment.profile?.full_name}
        avatarUrl={comment.profile?.avatar_url}
        userId={comment.user_id}
        size="md"
        className="shrink-0"
      />
      <div className="body">
        <div className="head">
          <span className="who">{comment.profile?.full_name || "Usuario"}</span>
          <span className="when">{formatMX(comment.created_at, "dd MMM HH:mm")}</span>
          {wasEdited(comment) && <span className="when">· editado</span>}
          {isAuthor && !editing && (
            <button
              type="button"
              onClick={startEdit}
              className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              title="Editar comentario"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-1.5">
            <RichCommentEditor
              ref={editorRef}
              initialHtml={editHtml}
              profiles={profiles}
              autoFocus
              placeholder="Edita tu comentario... usa @ para mencionar"
              onChange={setEditHtml}
              onMentionsChange={setEditMentions}
              onSubmit={saveEdit}
            />
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={saveEdit}
                disabled={updateComment.isPending}
              >
                <Check className="h-3.5 w-3.5" /> Guardar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1"
                onClick={() => setEditing(false)}
                disabled={updateComment.isPending}
              >
                <X className="h-3.5 w-3.5" /> Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="text">
            <CommentTextBody body={body} keyPrefix={`c-${comment.id}`} knownNames={knownNames} />
            {attachments.length > 0 && (
              <div className="mt-1.5 flex flex-col gap-1.5">
                {attachments.map((a, i) => (
                  <AttachmentCard key={i} name={a.name} url={a.url} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
