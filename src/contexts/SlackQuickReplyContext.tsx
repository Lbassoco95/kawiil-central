import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  OPEN_SLACK_QUICK_REPLY_EVENT,
  type SlackQuickReplyOpenInput,
} from "@/lib/openSlackQuickReply";
import {
  parseSlackEntityRef,
  type SlackDeepLinkPartsCompat,
} from "@/lib/slackDeepLink";
import { SlackQuickReplyPanel } from "@/components/slack/SlackQuickReplyPanel";

export type { SlackQuickReplyOpenInput };

type SlackQuickReplyContextValue = {
  openSlackQuickReply: (input: SlackQuickReplyOpenInput) => void;
  closeSlackQuickReply: () => void;
  isSlackQuickReplyOpen: boolean;
};

const SlackQuickReplyContext = createContext<SlackQuickReplyContextValue | null>(null);

function resolveRefString(input: SlackQuickReplyOpenInput): string | null {
  const ref = input.entity_ref?.trim();
  if (ref) return ref;
  if (input.entity_type === "slack") {
    const legacy = input.entity_id?.trim();
    if (legacy) return legacy;
  }
  return null;
}

export function SlackQuickReplyProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<SlackDeepLinkPartsCompat | null>(null);
  const [notificationTitle, setNotificationTitle] = useState<string | null>(null);
  const closeClearTimerRef = useRef<number | null>(null);

  const closeSlackQuickReply = useCallback(() => {
    setOpen(false);
    if (closeClearTimerRef.current != null) {
      window.clearTimeout(closeClearTimerRef.current);
    }
    closeClearTimerRef.current = window.setTimeout(() => {
      closeClearTimerRef.current = null;
      setParsed(null);
      setNotificationTitle(null);
    }, 320);
  }, []);

  const openSlackQuickReply = useCallback((input: SlackQuickReplyOpenInput) => {
    if (closeClearTimerRef.current != null) {
      window.clearTimeout(closeClearTimerRef.current);
      closeClearTimerRef.current = null;
    }
    const raw = resolveRefString(input);
    const p = parseSlackEntityRef(raw);
    if (!p) {
      toast.error("Esta notificación no tiene un enlace válido a Slack.");
      return;
    }
    setParsed(p);
    setNotificationTitle(input.notificationTitle?.trim() || null);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<SlackQuickReplyOpenInput>).detail;
      if (detail) openSlackQuickReply(detail);
    };
    window.addEventListener(OPEN_SLACK_QUICK_REPLY_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SLACK_QUICK_REPLY_EVENT, onOpen);
  }, [openSlackQuickReply]);

  useEffect(
    () => () => {
      if (closeClearTimerRef.current != null) window.clearTimeout(closeClearTimerRef.current);
    },
    [],
  );

  const value = useMemo(
    () => ({
      openSlackQuickReply,
      closeSlackQuickReply,
      isSlackQuickReplyOpen: open,
    }),
    [open, openSlackQuickReply, closeSlackQuickReply],
  );

  return (
    <SlackQuickReplyContext.Provider value={value}>
      {children}
      <SlackQuickReplyPanel
        open={open && !!parsed}
        onOpenChange={(next) => {
          if (!next) closeSlackQuickReply();
        }}
        parsed={parsed}
        notificationTitle={notificationTitle}
      />
    </SlackQuickReplyContext.Provider>
  );
}

export function useSlackQuickReply(): SlackQuickReplyContextValue {
  const ctx = useContext(SlackQuickReplyContext);
  if (!ctx) {
    throw new Error("useSlackQuickReply debe usarse dentro de SlackQuickReplyProvider");
  }
  return ctx;
}
