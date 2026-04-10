import { FormEvent, KeyboardEvent, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, SendHorizontal } from "lucide-react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  sending: boolean;
};

export function SlackComposer({ value, onChange, onSend, disabled, sending }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const submit = () => {
    const t = value.trim();
    if (!t || sending || disabled) return;
    onSend();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onSubmitForm = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  return (
    <form
      onSubmit={onSubmitForm}
      className="shrink-0 p-3 border-t border-border/80 bg-muted/20"
    >
      <div className="max-w-4xl mx-auto flex gap-2 items-end rounded-xl border border-border/80 bg-background shadow-sm px-2 py-2 focus-within:ring-1 focus-within:ring-primary/25">
        <Textarea
          ref={ta}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter salto de línea)"
          disabled={disabled || sending}
          rows={1}
          className="min-h-[40px] max-h-[160px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm py-2.5"
        />
        <Button
          type="submit"
          size="icon"
          className="shrink-0 h-10 w-10 rounded-lg"
          disabled={sending || disabled || !value.trim()}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
        </Button>
      </div>
    </form>
  );
}
