import { forwardRef, useImperativeHandle, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo,
  Underline,
  Undo,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import UnderlineExtension from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";

export type RichTextEditorHandle = {
  setHtml: (html: string) => void;
  focus: () => void;
  getHtml: () => string;
};

interface Props {
  initialHtml?: string;
  placeholder?: string;
  className?: string;
  onHtmlChange?: (html: string) => void;
  /** Contenido extra al final de la barra (p. ej. botón IA) */
  toolbarEndSlot?: ReactNode;
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor(
  { initialHtml, placeholder, className, onHtmlChange, toolbarEndSlot },
  ref
) {
  const FontSize = Extension.create({
    name: "fontSize",
    addGlobalAttributes() {
      return [
        {
          types: ["textStyle"],
          attributes: {
            fontSize: {
              default: null,
              parseHTML: (element) => element.style.fontSize?.replace("px", "") || null,
              renderHTML: (attributes) => {
                if (!attributes.fontSize) return {};
                return { style: `font-size: ${attributes.fontSize}px` };
              },
            },
          },
        },
      ];
    },
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TextStyle,
      FontSize,
      UnderlineExtension,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      Placeholder.configure({ placeholder: placeholder || "Escribe aquí..." }),
    ],
    content: initialHtml || "<p></p>",
    editorProps: {
      attributes: {
        class:
          "min-h-[120px] max-h-[300px] overflow-y-auto px-3 py-2 text-sm focus:outline-none prose prose-sm dark:prose-invert max-w-none [&_a]:text-primary",
        dir: "auto",
        style: "unicode-bidi: plaintext;",
      },
    },
    onUpdate: ({ editor: instance }) => {
      onHtmlChange?.(instance.getHTML());
    },
  });

  useImperativeHandle(ref, () => ({
    setHtml(html: string) {
      if (!editor) return;
      editor.commands.setContent(html || "<p></p>", false);
      onHtmlChange?.(editor.getHTML());
    },
    focus() {
      editor?.commands.focus();
    },
    getHtml() {
      return editor?.getHTML() || "";
    },
  }));

  const activeFontSize = String(editor?.getAttributes("textStyle")?.fontSize || "14");
  const setFontSize = (value: string) => {
    editor?.chain().focus().setMark("textStyle", { fontSize: value }).run();
  };

  return (
    <div className={cn("border border-input rounded-md bg-background", className)}>
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/30 flex-wrap">
        <Select
          value={activeFontSize}
          onValueChange={setFontSize}
        >
          <SelectTrigger className="h-7 w-[80px] text-xs">
            <SelectValue placeholder="Tamaño" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="12">12</SelectItem>
            <SelectItem value="14">14</SelectItem>
            <SelectItem value="16">16</SelectItem>
            <SelectItem value="18">18</SelectItem>
            <SelectItem value="24">24</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Negrita" onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run(); }}>
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Itálica" onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run(); }}>
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Subrayado" onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleUnderline().run(); }}>
          <Underline className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Lista" onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBulletList().run(); }}>
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Lista numerada" onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleOrderedList().run(); }}>
          <ListOrdered className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Alinear izquierda" onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().setTextAlign("left").run(); }}>
          <AlignLeft className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Centrar" onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().setTextAlign("center").run(); }}>
          <AlignCenter className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Alinear derecha" onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().setTextAlign("right").run(); }}>
          <AlignRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Enlace"
          onMouseDown={(e) => {
            e.preventDefault();
            const url = window.prompt("URL del enlace:");
            if (!url) return;
            editor?.chain().focus().setLink({ href: url }).run();
          }}
        >
          <Link2 className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Deshacer" onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().undo().run(); }}>
          <Undo className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Rehacer" onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().redo().run(); }}>
          <Redo className="h-3.5 w-3.5" />
        </Button>
        {toolbarEndSlot ? <div className="ml-auto flex items-center shrink-0">{toolbarEndSlot}</div> : null}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
});
