import { useState, useRef, useEffect, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/shared/UserAvatar";

interface Profile {
  user_id: string;
  full_name: string;
  email: string;
  avatar_url?: string | null;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  profiles: Profile[];
  placeholder?: string;
  rows?: number;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onMentionsChange?: (mentionedIds: string[]) => void;
}

export function MentionTextarea({
  value,
  onChange,
  profiles,
  placeholder,
  rows = 2,
  className,
  onKeyDown,
  onMentionsChange,
}: Props) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredProfiles = profiles.filter((p) =>
    p.full_name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  const extractMentionIds = useCallback(
    (text: string): string[] => {
      const mentionRegex = /@([a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\w][a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\w\s]*[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\w])/g;
      const ids: string[] = [];
      let match;
      while ((match = mentionRegex.exec(text)) !== null) {
        const name = match[1];
        const profile = profiles.find(
          (p) => p.full_name.toLowerCase() === name.toLowerCase()
        );
        if (profile) ids.push(profile.user_id);
      }
      return [...new Set(ids)];
    },
    [profiles]
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;
    onChange(newValue);

    // Check if we're in a mention context
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex >= 0) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Only show dropdown if @ is at start or preceded by space, and no space break in query
      const charBeforeAt = lastAtIndex > 0 ? newValue[lastAtIndex - 1] : " ";
      if ((charBeforeAt === " " || charBeforeAt === "\n" || lastAtIndex === 0) && !textAfterAt.includes("\n")) {
        setMentionQuery(textAfterAt);
        setMentionStart(lastAtIndex);
        setShowDropdown(true);
        setSelectedIndex(0);
        return;
      }
    }

    setShowDropdown(false);
  };

  const insertMention = (profile: Profile) => {
    const before = value.slice(0, mentionStart);
    const after = value.slice(
      textareaRef.current?.selectionStart ?? mentionStart + mentionQuery.length + 1
    );
    const newValue = `${before}@${profile.full_name} ${after}`;
    onChange(newValue);
    setShowDropdown(false);

    // Update mentions
    const ids = extractMentionIds(newValue);
    onMentionsChange?.(ids);

    // Focus back
    setTimeout(() => {
      const pos = mentionStart + profile.full_name.length + 2;
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
    }, 0);
  };

  const handleKeyDownInternal = (e: React.KeyboardEvent) => {
    if (showDropdown && filteredProfiles.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredProfiles.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredProfiles[selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowDropdown(false);
        return;
      }
    }
    onKeyDown?.(e);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative flex-1">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDownInternal}
        placeholder={placeholder}
        rows={rows}
        className={className}
      />
      {showDropdown && filteredProfiles.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full left-0 mb-1 w-64 max-h-48 overflow-y-auto bg-popover border rounded-md shadow-md z-50"
        >
          {filteredProfiles.map((p, i) => (
            <button
              key={p.user_id}
              type="button"
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent transition-colors ${
                i === selectedIndex ? "bg-accent" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(p);
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
}
