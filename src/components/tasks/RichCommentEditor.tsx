import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import { Bold, Italic, List, ListOrdered, Link2, Underline as UnderlineIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { cn } from "@/lib/utils";

export interface CommentProfile {
  user_id: string;
  full_name: string;
  email: string;
  avatar_url?: string | null;
}

export type RichCommentEditorHandle = {
  focus: () => void;
  clear: () => void;
  getHtml: () => string;
  setHtml: (html: string) => void;
  isEmpty: () => boolean;
};

interface Props {
  initialHtml?: string;
  profiles: CommentProfile[];
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onChange?: (html: string) => void;
  onMentionsChange?: (ids: string[]) => void;
  /** Se dispara con ⌘/Ctrl+Enter para enviar. */
  onSubmit?: () => void;
}

type MentionMenu = {
  items: CommentProfile[];
  command: (attrs: { id: string; label: string }) => void;
  rect: DOMRect | null;
  index: number;
};

function collectMentionIds(editor: Editor): string[] {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "mention" && node.attrs.id) ids.add(String(node.attrs.id));
  });
  return [...ids];
}

export const RichCommentEditor = forwardRef<RichCommentEditorHandle, Props>(
  function RichCommentEditor(
    { initialHtml, profiles, placeholder, className, autoFocus, onChange, onMentionsChange, onSubmit },
    ref,
  ) {
    const profilesRef = useRef(profiles);
    profilesRef.current = profiles;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onMentionsChangeRef = useRef(onMentionsChange);
    onMentionsChangeRef.current = onMentionsChange;
    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;

    const [menu, setMenu] = useState<MentionMenu | null>(null);
    const menuRef = useRef<MentionMenu | null>(null);
    menuRef.current = menu;

    // Extensión de mención creada una sola vez: el dropdown de TipTap se puentea
    // a estado de React leyendo `profilesRef`/`menuRef` (estables) desde los handlers.
    const mentionExtension = useMemo(
      () =>
        Mention.configure({
          HTMLAttributes: { class: "mention" },
          suggestion: {
            items: ({ query }) =>
              profilesRef.current
                .filter((p) => p.full_name.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 8),
            render: () => {
              const toMenu = (props: {
                items: CommentProfile[];
                command: (attrs: { id: string; label: string }) => void;
                clientRect?: (() => DOMRect | null) | null;
              }): MentionMenu => ({
                items: props.items,
                command: props.command,
                rect: props.clientRect?.() ?? null,
                index: 0,
              });
              return {
                onStart: (props) => setMenu(toMenu(props)),
                onUpdate: (props) => setMenu(toMenu(props)),
                onKeyDown: ({ event }) => {
                  const m = menuRef.current;
                  if (!m || m.items.length === 0) return false;
                  if (event.key === "ArrowDown") {
                    setMenu({ ...m, index: (m.index + 1) % m.items.length });
                    return true;
                  }
                  if (event.key === "ArrowUp") {
                    setMenu({ ...m, index: (m.index - 1 + m.items.length) % m.items.length });
                    return true;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    const chosen = m.items[m.index];
                    if (chosen) m.command({ id: chosen.user_id, label: chosen.full_name });
                    setMenu(null);
                    return true;
                  }
                  if (event.key === "Escape") {
                    setMenu(null);
                    return true;
                  }
                  return false;
                },
                onExit: () => setMenu(null),
              };
            },
          },
        }),
      [],
    );

    const editor = useEditor(
      {
        immediatelyRender: false,
        extensions: [
          // StarterKit v3 ya trae bold, italic, underline, listas y link:
          // se configuran aquí (heading fuera para mantener el comentario simple)
          // en vez de re-agregar extensiones y provocar duplicados.
          StarterKit.configure({
            heading: false,
            link: { openOnClick: false, autolink: true, linkOnPaste: true },
          }),
          Placeholder.configure({
            placeholder: placeholder || "Escribe un comentario... usa @ para mencionar",
          }),
          mentionExtension,
        ],
        content: initialHtml || "",
        editorProps: {
          attributes: {
            class:
              "comment-editor-content min-h-[56px] max-h-[220px] overflow-y-auto px-3 py-2 text-sm focus:outline-none prose prose-sm dark:prose-invert max-w-none",
          },
          handleKeyDown(_view, event) {
            // ⌘/Ctrl+Enter envía (salvo que el menú de menciones esté capturando Enter).
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onSubmitRef.current?.();
              return true;
            }
            return false;
          },
        },
        onUpdate: ({ editor: ed }) => {
          onChangeRef.current?.(ed.getHTML());
          onMentionsChangeRef.current?.(collectMentionIds(ed));
        },
      },
      [mentionExtension],
    );

    useEffect(() => {
      if (autoFocus && editor) editor.commands.focus("end");
    }, [autoFocus, editor]);

    // Cierra el menú si se hace clic fuera del editor.
    useEffect(() => {
      if (!menu) return;
      const handler = () => setMenu(null);
      window.addEventListener("scroll", handler, true);
      return () => window.removeEventListener("scroll", handler, true);
    }, [menu]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editor?.commands.focus("end"),
        clear: () => {
          editor?.commands.clearContent(true);
          onChangeRef.current?.(editor?.getHTML() || "");
          onMentionsChangeRef.current?.([]);
        },
        getHtml: () => editor?.getHTML() || "",
        setHtml: (html) => editor?.commands.setContent(html || ""),
        isEmpty: () => editor?.isEmpty ?? true,
      }),
      [editor],
    );

    const tbBtn = (
      title: string,
      active: boolean,
      onClick: () => void,
      Icon: typeof Bold,
    ) => (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", active && "bg-accent text-accent-foreground")}
        title={title}
        onMouseDown={(e) => {
          e.preventDefault();
          onClick();
        }}
      >
        <Icon className="h-3.5 w-3.5" />
      </Button>
    );

    return (
      <div className={cn("border border-input rounded-md bg-background", className)}>
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border bg-muted/30 flex-wrap">
          {tbBtn("Negrita", !!editor?.isActive("bold"), () => editor?.chain().focus().toggleBold().run(), Bold)}
          {tbBtn("Itálica", !!editor?.isActive("italic"), () => editor?.chain().focus().toggleItalic().run(), Italic)}
          {tbBtn("Subrayado", !!editor?.isActive("underline"), () => editor?.chain().focus().toggleUnderline().run(), UnderlineIcon)}
          {tbBtn("Lista", !!editor?.isActive("bulletList"), () => editor?.chain().focus().toggleBulletList().run(), List)}
          {tbBtn("Lista numerada", !!editor?.isActive("orderedList"), () => editor?.chain().focus().toggleOrderedList().run(), ListOrdered)}
          {tbBtn(
            "Enlace",
            !!editor?.isActive("link"),
            () => {
              if (editor?.isActive("link")) {
                editor.chain().focus().unsetLink().run();
                return;
              }
              const url = window.prompt("URL del enlace:");
              if (url) editor?.chain().focus().setLink({ href: url }).run();
            },
            Link2,
          )}
        </div>
        <EditorContent editor={editor} />
        {menu && menu.items.length > 0 && menu.rect && (
          <div
            style={{
              position: "fixed",
              top: menu.rect.bottom + 4,
              left: menu.rect.left,
              zIndex: 70,
            }}
            className="w-64 max-h-48 overflow-y-auto bg-popover border rounded-md shadow-md"
          >
            {menu.items.map((p, i) => (
              <button
                key={p.user_id}
                type="button"
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent transition-colors",
                  i === menu.index && "bg-accent",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  menu.command({ id: p.user_id, label: p.full_name });
                  setMenu(null);
                }}
              >
                <UserAvatar
                  name={p.full_name}
                  email={p.email}
                  avatarUrl={p.avatar_url}
                  userId={p.user_id}
                  size="sm"
                  showTooltip={false}
                />
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.full_name}</div>
                  <div className="text-xs text-muted-foreground truncate">{p.email}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
