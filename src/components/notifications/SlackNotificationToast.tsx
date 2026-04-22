import type { NavigateFunction } from "react-router-dom";
import { toast as sonnerToast } from "sonner";
import { Button } from "@/components/ui/button";
import { openSlackQuickReplyDispatch } from "@/lib/openSlackQuickReply";
import { slackDeepLinkFromNotification } from "@/lib/slackDeepLink";
import { cn } from "@/lib/utils";

type NotifRow = {
  id?: string;
  title?: string;
  body?: string | null;
  type?: string;
  entity_type?: string;
  entity_id?: string | null;
  entity_ref?: string | null;
};

type Props = {
  toastId: string | number;
  row: NotifRow;
  title: string;
  bodyText: string;
  navigate: NavigateFunction;
};

export function SlackNotificationToast({ toastId, row, title, bodyText, navigate }: Props) {
  const deepLink = slackDeepLinkFromNotification({
    entity_type: row.entity_type,
    entity_ref: row.entity_ref,
    entity_id: row.entity_id,
    type: row.type,
  });

  const dismiss = () => sonnerToast.dismiss(toastId);

  return (
    <div
      className={cn(
        "flex w-full min-w-[min(100vw-1.5rem,20rem)] sm:min-w-[22rem] max-w-[min(100vw-1.5rem,28rem)]",
        "flex-col gap-2 rounded-lg border border-border/80 bg-popover p-3 text-left shadow-xl",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        {bodyText ? (
          <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground line-clamp-3">
            {bodyText}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          className="h-8 flex-1 min-w-[7.5rem] text-xs"
          onClick={() => {
            openSlackQuickReplyDispatch({
              entity_ref: row.entity_ref,
              entity_id: row.entity_id,
              entity_type: row.entity_type,
              notificationTitle: row.title,
            });
            dismiss();
          }}
        >
          Respuesta rápida
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 flex-1 min-w-[7.5rem] text-xs"
          disabled={!deepLink}
          onClick={() => {
            if (deepLink) navigate(deepLink);
            dismiss();
          }}
        >
          Comunicación
        </Button>
      </div>
    </div>
  );
}
