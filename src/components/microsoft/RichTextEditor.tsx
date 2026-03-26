import { useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Bold, Italic, List, ListOrdered, Link2, Undo, Redo } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  initialHtml?: string;
  placeholder?: string;
  className?: string;
  onHtmlChange?: (html: string) => void;
}

export function RichTextEditor({ initialHtml, placeholder, className, onHtmlChange }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);

  const exec = useCallback((cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
    if (onHtmlChange && editorRef.current) {
      onHtmlChange(editorRef.current.innerHTML);
    }
  }, [onHtmlChange]);

  const handleInput = useCallback(() => {
    if (onHtmlChange && editorRef.current) {
      onHtmlChange(editorRef.current.innerHTML);
    }
  }, [onHtmlChange]);

  const insertLink = useCallback(() => {
    const url = prompt("URL del enlace:");
    if (url) exec("createLink", url);
  }, [exec]);

  const toolbarButtons = [
    { icon: Bold, cmd: "bold", title: "Negrita" },
    { icon: Italic, cmd: "italic", title: "Itálica" },
    { icon: List, cmd: "insertUnorderedList", title: "Lista" },
    { icon: ListOrdered, cmd: "insertOrderedList", title: "Lista numerada" },
    { icon: Link2, cmd: "link", title: "Enlace" },
    { icon: Undo, cmd: "undo", title: "Deshacer" },
    { icon: Redo, cmd: "redo", title: "Rehacer" },
  ];

  return (
    <div className={cn("border border-input rounded-md bg-background", className)}>
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/30 flex-wrap">
        {toolbarButtons.map(({ icon: Icon, cmd, title }) => (
          <Button
            key={cmd}
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={title}
            onMouseDown={(e) => {
              e.preventDefault();
              if (cmd === "link") insertLink();
              else exec(cmd);
            }}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        ))}
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="min-h-[120px] max-h-[300px] overflow-y-auto px-3 py-2 text-sm focus:outline-none prose prose-sm dark:prose-invert max-w-none [&_a]:text-primary"
        dangerouslySetInnerHTML={{ __html: initialHtml || "" }}
        onInput={handleInput}
        data-placeholder={placeholder}
        style={{ position: "relative" }}
      />
    </div>
  );
}
