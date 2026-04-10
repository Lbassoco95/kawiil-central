import { FormEvent, KeyboardEvent, useRef, useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, SendHorizontal, Smile, AtSign } from "lucide-react";
import { SLACK_EMOJI } from "@/lib/slackFormatting";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { slackUserDisplayName } from "./slackGrouping";
import { cn } from "@/lib/utils";

const EMOJI_PICKER_KEYS = Object.keys(SLACK_EMOJI).slice(0, 48);

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  sending: boolean;
  channelLabel?: string;
  mentionUserIds?: string[];
  userMap?: Record<string, SlackUserProfile | undefined>;
  compact?: boolean;
};

export function SlackComposer({
  value,
  onChange,
  onSend,
  disabled,
  sending,
  channelLabel,
  mentionUserIds = [],
  userMap = {},
  compact,
}: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, compact ? 120 : 160)}px`;
  }, [value, compact]);

  const submit = () => {
    const t = value.trim();
    if (!t || sending || disabled) return;
    onSend();
  };

  const insertAtCursor = (snippet: string) => {
    const el = ta.current;
    if (!el) {
      onChange(value + snippet);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const filteredMentions = useMemo(() => {
    const q = mentionFilter.toLowerCase();
    return mentionUserIds
      .filter((id) => {
        const name = slackUserDisplayName(id, userMap).toLowerCase();
        return !q || name.includes(q) || id.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [mentionUserIds, mentionFilter, userMap]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onChangeTextarea = (v: string) => {
    onChange(v);
    const el = ta.current;
    if (!el) return;
    const pos = el.selectionStart;
    const before = v.slice(0, pos);
    const at = before.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /[\s\n]/.test(before[at - 1]))) {
      const frag = before.slice(at + 1);
      if (!frag.includes(" ") && frag.length <= 40) {
        setMentionFilter(frag);
        setMentionOpen(true);
        return;
      }
    }
    setMentionOpen(false);
  };

  const pickMention = (id: string) => {
    const el = ta.current;
    if (!el) return;
    const pos = el.selectionStart;
    const before = value.slice(0, pos);
    const at = before.lastIndexOf("@");
    if (at < 0) return;
    const next = value.slice(0, at) + `<@${id}> ` + value.slice(pos);
    onChange(next);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const p = at + id.length + 4;
      el.setSelectionRange(p, p);
    });
  };

  const onSubmitForm = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const placeholder = channelLabel
    ? `Escribe un mensaje en ${channelLabel.includes("#") || channelLabel.length < 2 ? channelLabel : `«${channelLabel}»`}…`
    : "Escribe un mensaje…";

  return (
    <form
      onSubmit={onSubmitForm}
      className={cn("shrink-0 border-t border-border/80 bg-muted/20", compact ? "p-2" : "p-3")}
    >
      <div
        className={cn(
          "mx-auto flex gap-2 items-end rounded-xl border border-border/80 bg-background shadow-sm px-2 py-2 focus-within:ring-1 focus-within:ring-primary/25",
          compact ? "max-w-none" : "max-w-4xl",
        )}
      >
        <Popover open={mentionOpen} onOpenChange={setMentionOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-lg"
              disabled={disabled || sending}
              onClick={() => {
                insertAtCursor("@");
                setMentionFilter("");
                setMentionOpen(true);
              }}
            >
              <AtSign className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1" align="start" side="top">
            <p className="text-[10px] text-muted-foreground px-2 py-1">Mencionar</p>
            <ul className="max-h-48 overflow-y-auto">
              {filteredMentions.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted"
                    onClick={() => pickMention(id)}
                  >
                    {slackUserDisplayName(id, userMap)}
                  </button>
                </li>
              ))}
              {filteredMentions.length === 0 && (
                <li className="text-xs text-muted-foreground px-2 py-2">Sin coincidencias</li>
              )}
            </ul>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-lg" disabled={disabled || sending}>
              <Smile className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="start" side="top">
            <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
              {EMOJI_PICKER_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="text-lg p-1 rounded hover:bg-muted"
                  title={`:${k}:`}
                  onClick={() => insertAtCursor(`:${k}:`)}
                >
                  {SLACK_EMOJI[k]}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Textarea
          ref={ta}
          value={value}
          onChange={(e) => onChangeTextarea(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`${placeholder} (Enter envía, Shift+Enter nueva línea)`}
          disabled={disabled || sending}
          rows={1}
          className={cn(
            "min-h-[40px] max-h-[160px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm py-2.5",
            compact && "min-h-[36px] max-h-[120px]",
          )}
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
