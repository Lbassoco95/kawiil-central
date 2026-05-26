import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ReplyForwardAction } from "@/components/microsoft/ReplyForwardDialog";
import {
  useCreateForwardDraft,
  useCreateReplyDraft,
  useForwardEmail,
  useReplyEmail,
  useSendDraft,
} from "@/hooks/useMicrosoft";
import {
  emailsToGraphRecipients,
  fallbackReplyRecipientsFromDetail,
  filesToComposerAttachments,
  graphRecipientsToInputString,
  parseRecipients,
  validateRecipientGroups,
  type ComposerAttachment,
} from "@/lib/emailComposer";
import { buildThreadContextForAi } from "@/lib/emailThreadContext";

export type EmailAction = ReplyForwardAction | null;

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function useReplyForwardCompose(options: {
  messageId: string | null;
  emailDetail: Record<string, unknown> | null | undefined;
  threadEmails?: Record<string, unknown>[];
  onSuccess?: () => void;
}) {
  const { messageId, emailDetail, threadEmails = [], onSuccess } = options;

  const [emailAction, setEmailAction] = useState<EmailAction>(null);
  const [forwardTo, setForwardTo] = useState("");
  const [forwardCc, setForwardCc] = useState("");
  const [forwardBcc, setForwardBcc] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [replyCc, setReplyCc] = useState("");
  const [replyBcc, setReplyBcc] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftHtml, setDraftHtml] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [requestDeliveryReceipt, setRequestDeliveryReceipt] = useState(false);
  const [requestReadReceipt, setRequestReadReceipt] = useState(false);

  const createReplyDraft = useCreateReplyDraft();
  const createForwardDraft = useCreateForwardDraft();
  const sendDraft = useSendDraft();
  const replyEmail = useReplyEmail();
  const forwardEmail = useForwardEmail();

  const resetAction = useCallback(() => {
    setEmailAction(null);
    setDraftHtml("");
    setDraftId(null);
    setForwardTo("");
    setForwardCc("");
    setForwardBcc("");
    setReplyTo("");
    setReplyCc("");
    setReplyBcc("");
    setReplyFiles([]);
    setRequestDeliveryReceipt(false);
    setRequestReadReceipt(false);
  }, []);

  useEffect(() => {
    resetAction();
  }, [messageId, resetAction]);

  const threadContextForAi = useMemo(() => {
    if (!messageId) return "";
    return buildThreadContextForAi(emailDetail, threadEmails, messageId);
  }, [emailDetail, messageId, threadEmails]);

  const startReply = useCallback(
    async (action: ReplyForwardAction) => {
      if (!messageId) return;
      setEmailAction(action);
      setRequestDeliveryReceipt(false);
      setRequestReadReceipt(false);
      setDraftId(null);
      setDraftHtml("");
      setReplyFiles([]);
      setReplyTo("");
      setReplyCc("");
      setReplyBcc("");
      setForwardTo("");
      setForwardCc("");
      setForwardBcc("");

      if (action === "forward") {
        try {
          const draft = await createForwardDraft.mutateAsync({ messageId });
          if (draft?.id) {
            setDraftId(draft.id);
            setDraftHtml(draft.body?.content || "");
            const fd = draft as {
              toRecipients?: unknown;
              ccRecipients?: unknown;
              bccRecipients?: unknown;
            };
            setForwardTo(graphRecipientsToInputString(fd.toRecipients));
            setForwardCc(graphRecipientsToInputString(fd.ccRecipients));
            setForwardBcc(graphRecipientsToInputString(fd.bccRecipients));
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "No se pudo preparar el reenvío con firma");
          setEmailAction(null);
        }
        return;
      }

      try {
        const draft = await createReplyDraft.mutateAsync({
          messageId,
          replyAll: action === "reply-all",
        });
        if (draft && "unsupported" in draft && draft.unsupported) {
          toast.warning(String((draft as { message?: unknown }).message ?? "No soportado"));
          return;
        }
        const d = draft as {
          id?: string;
          body?: { content?: string };
          toRecipients?: unknown;
          ccRecipients?: unknown;
          bccRecipients?: unknown;
        };
        if (d?.id) {
          setDraftId(d.id);
          setDraftHtml(d.body?.content || "");
          let to = graphRecipientsToInputString(d.toRecipients);
          let cc = graphRecipientsToInputString(d.ccRecipients);
          let bcc = graphRecipientsToInputString(d.bccRecipients);
          if ((!to || (!cc && action === "reply-all")) && emailDetail) {
            const fb = fallbackReplyRecipientsFromDetail(
              emailDetail,
              action === "reply-all",
            );
            if (!to) to = fb.to;
            if (!cc) cc = fb.cc;
            if (!bcc) bcc = fb.bcc;
          }
          setReplyTo(to);
          setReplyCc(cc);
          setReplyBcc(bcc);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo preparar la respuesta");
        setEmailAction(null);
      }
    },
    [messageId, emailDetail, createForwardDraft, createReplyDraft],
  );

  const handleSendReply = useCallback(async () => {
    if (!messageId || !emailAction) return;

    const onSent = () => {
      resetAction();
      onSuccess?.();
    };

    if (emailAction === "forward") {
      const forwardToList = parseRecipients(forwardTo);
      const forwardCcList = parseRecipients(forwardCc);
      const forwardBccList = parseRecipients(forwardBcc);
      const error = validateRecipientGroups({
        to: forwardToList,
        cc: forwardCcList,
        bcc: forwardBccList,
      });
      if (error) {
        toast.error(error);
        return;
      }
      let attachments: ComposerAttachment[] = [];
      if (replyFiles.length > 0) {
        try {
          attachments = await filesToComposerAttachments(replyFiles);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "No se pudieron adjuntar archivos");
          return;
        }
      }
      if (draftId) {
        sendDraft.mutate(
          {
            draftId,
            body: { contentType: "HTML", content: draftHtml },
            attachments,
            toRecipients: emailsToGraphRecipients(forwardToList),
            ccRecipients: emailsToGraphRecipients(forwardCcList),
            bccRecipients: emailsToGraphRecipients(forwardBccList),
            requestDeliveryReceipt,
            requestReadReceipt,
          },
          { onSuccess: onSent },
        );
      } else {
        if (forwardCcList.length > 0 || forwardBccList.length > 0) {
          toast.error(
            "CC y CCO solo aplican con el borrador de Outlook. Cierra y vuelve a abrir el reenvío o comprueba la conexión con Microsoft.",
          );
          return;
        }
        forwardEmail.mutate(
          {
            messageId,
            comment: stripTags(draftHtml),
            toRecipients: forwardToList,
            attachments,
          },
          { onSuccess: onSent },
        );
      }
      return;
    }

    if (draftId) {
      const replyToList = parseRecipients(replyTo);
      const replyCcList = parseRecipients(replyCc);
      const replyBccList = parseRecipients(replyBcc);
      const recErr = validateRecipientGroups({
        to: replyToList,
        cc: replyCcList,
        bcc: replyBccList,
      });
      if (recErr) {
        toast.error(recErr);
        return;
      }
      let attachments: ComposerAttachment[] = [];
      if (replyFiles.length > 0) {
        try {
          attachments = await filesToComposerAttachments(replyFiles);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "No se pudieron adjuntar archivos");
          return;
        }
      }
      sendDraft.mutate(
        {
          draftId,
          body: { contentType: "HTML", content: draftHtml },
          attachments,
          toRecipients: emailsToGraphRecipients(replyToList),
          ccRecipients: emailsToGraphRecipients(replyCcList),
          bccRecipients: emailsToGraphRecipients(replyBccList),
          requestDeliveryReceipt,
          requestReadReceipt,
        },
        { onSuccess: onSent },
      );
    } else {
      replyEmail.mutate(
        {
          messageId,
          comment: stripTags(draftHtml),
          replyAll: emailAction === "reply-all",
        },
        { onSuccess: onSent },
      );
    }
  }, [
    messageId,
    emailAction,
    forwardTo,
    forwardCc,
    forwardBcc,
    replyTo,
    replyCc,
    replyBcc,
    draftId,
    draftHtml,
    replyFiles,
    requestDeliveryReceipt,
    requestReadReceipt,
    sendDraft,
    forwardEmail,
    replyEmail,
    resetAction,
    onSuccess,
  ]);

  const toggleReply = useCallback(
    (action: ReplyForwardAction) => {
      if (emailAction === action) {
        resetAction();
        return;
      }
      void startReply(action);
    },
    [emailAction, resetAction, startReply],
  );

  return {
    emailAction,
    resetAction,
    startReply,
    toggleReply,
    handleSendReply,
    threadContextForAi,
    draftId,
    draftHtml,
    setDraftHtml,
    forwardTo,
    setForwardTo,
    forwardCc,
    setForwardCc,
    forwardBcc,
    setForwardBcc,
    replyTo,
    setReplyTo,
    replyCc,
    setReplyCc,
    replyBcc,
    setReplyBcc,
    replyFiles,
    setReplyFiles,
    requestDeliveryReceipt,
    setRequestDeliveryReceipt,
    requestReadReceipt,
    setRequestReadReceipt,
    createReplyDraftPending: createReplyDraft.isPending,
    createForwardDraftPending: createForwardDraft.isPending,
    isSending: sendDraft.isPending || replyEmail.isPending || forwardEmail.isPending,
  };
}
