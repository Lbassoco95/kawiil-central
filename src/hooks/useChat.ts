import { useState, useCallback, useRef } from "react";
import type { ChatProgressStep } from "@/components/ai/ChatProcessingPanel";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  MAX_CHAT_ATTACHMENT_BATCH_BYTES,
  MAX_CHAT_ATTACHMENT_BYTES_PER_FILE,
  MAX_CHAT_ATTACHMENT_FILES,
  formatMb,
} from "@/lib/chatAttachmentLimits";

export interface ChatAttachmentMeta {
  bucket: string;
  path: string;
  name: string;
  mime_type: string;
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachmentMeta[];
  /** Resumen de pasos (subida, servidor, modelo) tras una respuesta exitosa */
  activityLog?: string[];
  /** Mensaje de error visible en el hilo */
  isError?: boolean;
}

export interface ChatConversation {
  id: string;
  title: string;
  folder: string | null;
  ai_project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SendMessageOptions {
  files?: File[];
  /** Tras subir cada archivo al bucket del chat, enlazarlo al proyecto (documentos de la app). */
  onAfterChatUpload?: (file: File) => Promise<void>;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

export function useChat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamProgressSteps, setStreamProgressSteps] = useState<ChatProgressStep[]>([]);
  const progressStepsRef = useRef<ChatProgressStep[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeAiProjectId, setActiveAiProjectId] = useState<string | null>(null);

  const { data: conversations, isLoading: loadingConversations } = useQuery({
    queryKey: ["chat-conversations", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_conversations" as any)
        .select("*")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as unknown as ChatConversation[];
    },
    enabled: !!user,
  });

  const loadConversation = useCallback(async (conversationId: string) => {
    const { data, error } = await supabase
      .from("chat_messages" as any)
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Error al cargar mensajes");
      return;
    }
    const rows = (data as any[]) || [];
    setMessages(
      rows.map((r) => ({
        id: r.id,
        role: r.role as "user" | "assistant",
        content: r.content,
        attachments: Array.isArray(r.attachments) && r.attachments.length ? r.attachments : undefined,
      }))
    );
    setActiveConversationId(conversationId);

    const { data: conv } = await supabase
      .from("chat_conversations" as any)
      .select("ai_project_id")
      .eq("id", conversationId)
      .single();
    if (conv) {
      setActiveAiProjectId((conv as any).ai_project_id || null);
    }
  }, []);

  const createConversation = useCallback(
    async (title: string, folder?: string) => {
      const orgRes = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const { data, error } = await supabase
        .from("chat_conversations" as any)
        .insert({
          user_id: user!.id,
          organization_id: orgRes.data,
          title,
          folder: folder || null,
          ai_project_id: activeAiProjectId || null,
        } as any)
        .select()
        .single();
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
      return (data as any).id as string;
    },
    [user, qc, activeAiProjectId]
  );

  const updateConversationFolder = useCallback(
    async (conversationId: string, folder: string | null) => {
      await supabase.from("chat_conversations" as any).update({ folder } as any).eq("id", conversationId);
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
    },
    [qc]
  );

  const renameConversation = useCallback(
    async (conversationId: string, title: string) => {
      await supabase.from("chat_conversations" as any).update({ title } as any).eq("id", conversationId);
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
    },
    [qc]
  );

  const saveMessage = useCallback(
    async (
      conversationId: string,
      role: string,
      content: string,
      attachments?: ChatAttachmentMeta[] | null
    ) => {
      const payload: Record<string, unknown> = {
        conversation_id: conversationId,
        role,
        content,
      };
      if (attachments && attachments.length) {
        payload.attachments = attachments;
      }

      const { data: msgData, error: insertErr } = await supabase
        .from("chat_messages" as any)
        .insert(payload as any)
        .select("id")
        .single();
      if (insertErr) throw insertErr;

      const { error: convErr } = await supabase
        .from("chat_conversations" as any)
        .update({ updated_at: new Date().toISOString() } as any)
        .eq("id", conversationId);
      if (convErr) throw convErr;

      const embedText =
        content +
        (attachments?.length
          ? ` [adjuntos: ${attachments.map((a) => a.name).join(", ")}]`
          : "");
      if (msgData && embedText.length > 30) {
        const orgRes = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
        supabase.functions
          .invoke("generate-embeddings", {
            body: {
              texts: [`[${role}] ${embedText}`],
              source_type: "chat_message",
              source_id: (msgData as any).id,
              organization_id: orgRes.data,
              auto_chunk: false,
            },
          })
          .catch(() => {});
      }
    },
    [user]
  );

  const deleteConversation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("chat_conversations" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }
      toast.success("Conversación eliminada");
    },
  });

  const sendMessage = useCallback(
    async (input: string, opts?: SendMessageOptions) => {
      const files = (opts?.files ?? []).slice(0, MAX_CHAT_ATTACHMENT_FILES);
      const text = input.trim() || (files.length ? "(Archivos adjuntos)" : "");
      if ((!text && !files.length) || isStreaming) return;

      progressStepsRef.current = [];
      const pushProgress = (phase: string, message: string) => {
        const step: ChatProgressStep = { phase, message };
        progressStepsRef.current = [...progressStepsRef.current, step];
        setStreamProgressSteps([...progressStepsRef.current]);
      };

      let convId = activeConversationId;
      if (!convId) {
        const title = text.length > 50 ? text.substring(0, 50) + "..." : text;
        convId = await createConversation(title);
        setActiveConversationId(convId);
      }

      const orgRes = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      if (orgRes.error) {
        toast.error(orgRes.error.message || "No se pudo obtener la organización");
        return;
      }
      const orgId = orgRes.data as string | null;
      if (files.length > 0 && !orgId) {
        toast.error("Tu cuenta no tiene organización; no se pueden subir adjuntos.");
        return;
      }

      if (files.length) {
        pushProgress("upload", `Subiendo ${files.length} archivo(s) al almacenamiento seguro…`);
      } else {
        pushProgress("send", "Preparando tu mensaje…");
      }

      const savedMeta: ChatAttachmentMeta[] = [];
      let uploadedBatchBytes = 0;

      for (const file of files) {
        if (file.size > MAX_CHAT_ATTACHMENT_BYTES_PER_FILE) {
          toast.error(`${file.name} supera ${formatMb(MAX_CHAT_ATTACHMENT_BYTES_PER_FILE)} MB por archivo`);
          continue;
        }
        if (uploadedBatchBytes + file.size > MAX_CHAT_ATTACHMENT_BATCH_BYTES) {
          toast.error(`Límite de ${formatMb(MAX_CHAT_ATTACHMENT_BATCH_BYTES)} MB total por mensaje`);
          break;
        }
        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        const objectPath = `${orgId}/${user!.id}/${crypto.randomUUID()}_${safe}`;
        const { error: upErr } = await supabase.storage.from("chat-uploads").upload(objectPath, file);
        if (upErr) {
          toast.error(`No se pudo subir ${file.name}`);
          continue;
        }
        const meta: ChatAttachmentMeta = {
          bucket: "chat-uploads",
          path: objectPath,
          name: file.name,
          mime_type: file.type || "application/octet-stream",
        };
        savedMeta.push(meta);
        uploadedBatchBytes += file.size;
        if (opts?.onAfterChatUpload) {
          try {
            await opts.onAfterChatUpload(file);
          } catch {
            /* no bloquear el chat */
          }
        }
      }

      if (!text.trim() && files.length && savedMeta.length === 0) {
        toast.error("No se pudo subir ningún archivo");
        setStreamProgressSteps([]);
        progressStepsRef.current = [];
        return;
      }

      if (savedMeta.length > 0) {
        pushProgress("upload_ok", `${savedMeta.length} archivo(s) listo(s) en el chat.`);
      }

      const userMsg: ChatMessage = {
        role: "user",
        content: text,
        attachments: savedMeta.length ? savedMeta : undefined,
      };
      const allMessages = [...messages, userMsg];
      setMessages(allMessages);
      setIsStreaming(true);

      pushProgress("persist", "Guardando el mensaje en tu conversación…");

      try {
        await saveMessage(convId, "user", text, savedMeta.length ? savedMeta : null);
      } catch (persistErr: any) {
        console.error(persistErr);
        toast.error(persistErr?.message || "No se pudo guardar el mensaje");
        setIsStreaming(false);
        setStreamProgressSteps([]);
        progressStepsRef.current = [];
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      let refsForAiChat: ChatAttachmentMeta[] = [...savedMeta];
      const indexedNames: string[] = [];

      const isPdfAttachment = (m: ChatAttachmentMeta) =>
        m.mime_type === "application/pdf" || m.name.toLowerCase().endsWith(".pdf");

      for (const meta of savedMeta) {
        if (!isPdfAttachment(meta)) continue;

        let pageStart = 1;
        let indexId: string | null = null;
        let iterations = 0;
        pushProgress("index_pdf", `Indexando «${meta.name}» para búsqueda en todo el documento…`);

        try {
          while (iterations < 60) {
            iterations += 1;
            const { data, error: fnErr } = await supabase.functions.invoke("index-chat-attachment", {
              body: {
                bucket: meta.bucket,
                path: meta.path,
                name: meta.name,
                mime_type: meta.mime_type,
                page_start: pageStart,
                attachment_index_id: indexId,
              },
            });
            if (fnErr) throw fnErr;
            const d = data as {
              error?: string;
              attachment_index_id?: string;
              pages_done?: number;
              total_pages?: number;
              done?: boolean;
              next_page?: number | null;
            };
            if (d?.error) throw new Error(d.error);
            if (!d || typeof d.attachment_index_id !== "string") {
              throw new Error("Respuesta inválida de index-chat-attachment");
            }

            indexId = d.attachment_index_id;
            const donePg = d.pages_done ?? 0;
            const totalPg = d.total_pages ?? 0;
            pushProgress("index_pdf", `Indexando «${meta.name}»… ${donePg}/${totalPg} páginas`);

            if (d.done) break;
            if (d.next_page == null) break;
            pageStart = d.next_page;
          }
          indexedNames.push(meta.name);
          refsForAiChat = refsForAiChat.filter((r) => r.path !== meta.path);
        } catch (e) {
          console.error("index-chat-attachment", e);
          toast.error(
            `No se indexó «${meta.name}» para búsqueda semántica. Se enviará el PDF al modelo de forma directa (documentos muy largos pueden fallar).`,
          );
        }
      }

      pushProgress("ai_connect", "Conectando con Kawiil AI y procesando contexto…");

      let assistantContent = "";

      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;

        const chatBody = JSON.stringify({
          messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
          conversationId: convId,
          ai_project_id: activeAiProjectId || undefined,
          attachmentRefs: refsForAiChat.length ? refsForAiChat : undefined,
          ...(indexedNames.length ? { indexed_attachment_names: indexedNames } : {}),
        });

        const chatFetch = () =>
          fetch(CHAT_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: chatBody,
          });

        let resp = await chatFetch();
        for (let r429 = 0; r429 < 2 && resp.status === 429; r429++) {
          let waitMs = 3500 * (r429 + 1);
          try {
            const errRaw = await resp.text();
            const j = JSON.parse(errRaw) as { retry_after?: number; message?: string; error?: string };
            if (typeof j.retry_after === "number" && j.retry_after > 0) {
              waitMs = Math.min(60_000, j.retry_after * 1000);
            }
          } catch {
            /* ignore */
          }
          pushProgress("rate_limit", "Límite temporal del proveedor de IA. Reintentando en unos segundos…");
          await new Promise((r) => setTimeout(r, waitMs));
          resp = await chatFetch();
        }

        const ct = resp.headers.get("content-type") || "";

        if (!resp.ok) {
          const errRaw = await resp.text();
          let errMsg = `Error ${resp.status}`;
          if (resp.status === 546) {
            errMsg =
              "Límite de recursos en Supabase (código 546: memoria o tiempo de CPU del Edge Function). " +
              "Suele ocurrir con PDFs de muchas páginas, Excel muy grandes o varios adjuntos a la vez. " +
              "Prueba un PDF más corto (o las páginas que necesites), exporta solo una hoja a CSV, imágenes bajo ~2 MB, o envía los archivos en mensajes separados.";
          } else {
            try {
              const j = JSON.parse(errRaw) as { error?: string; message?: string };
              errMsg = j.message || j.error || errMsg;
            } catch {
              if (errRaw && errRaw.length < 500) errMsg = errRaw;
            }
          }
          throw new Error(errMsg);
        }

        if (ct.includes("application/json") && !ct.includes("event-stream")) {
          const j = await resp.json().catch(() => ({}));
          if ((j as any).error) throw new Error(String((j as any).error));
          const plain = typeof (j as any).content === "string" ? (j as any).content : "";
          if (plain) {
            assistantContent = plain;
            const log = progressStepsRef.current.map((s) => s.message);
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: plain, activityLog: log.length ? log : undefined },
            ]);
            await saveMessage(convId, "assistant", assistantContent, null);
            qc.invalidateQueries({ queryKey: ["chat-conversations"] });
          } else {
            throw new Error("El servidor respondió sin contenido de texto.");
          }
          return;
        }

        if (!resp.body) throw new Error("El servidor no devolvió datos (stream vacío). Revisa la función ai-chat.");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";
        let streamDone = false;

        const handleParsedLine = (parsed: Record<string, unknown>) => {
          if (parsed.type === "kawiil_progress") {
            const phase = String(parsed.phase || "step");
            const message = String(parsed.message || "");
            if (message) pushProgress(phase, message);
            return;
          }
          const content = (parsed as any).choices?.[0]?.delta?.content as string | undefined;
          if (content) {
            assistantContent += content;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, content: assistantContent, isError: false } : m
                );
              }
              return [...prev, { role: "assistant", content: assistantContent }];
            });
          }
        };

        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) break;
          textBuffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
            let line = textBuffer.slice(0, newlineIndex);
            textBuffer = textBuffer.slice(newlineIndex + 1);

            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") continue;
            if (!line.startsWith("data: ")) continue;

            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") {
              streamDone = true;
              break;
            }

            try {
              const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
              handleParsedLine(parsed);
            } catch {
              textBuffer = line + "\n" + textBuffer;
              break;
            }
          }
        }

        if (textBuffer.trim()) {
          for (let raw of textBuffer.split("\n")) {
            if (!raw) continue;
            if (raw.endsWith("\r")) raw = raw.slice(0, -1);
            if (!raw.startsWith("data: ")) continue;
            const jsonStr = raw.slice(6).trim();
            if (jsonStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
              handleParsedLine(parsed);
            } catch {
              /* ignore */
            }
          }
          if (assistantContent) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, content: assistantContent } : m
                );
              }
              return [...prev, { role: "assistant", content: assistantContent }];
            });
          }
        }

        const trimmed = assistantContent.trim();
        if (trimmed) {
          const log = progressStepsRef.current.map((s) => s.message);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && log.length) {
              return prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, activityLog: log } : m
              );
            }
            return prev;
          });
          await saveMessage(convId, "assistant", assistantContent, null);
          qc.invalidateQueries({ queryKey: ["chat-conversations"] });
        } else {
          const errText =
            "**No se recibió respuesta del modelo.** Suele ocurrir si los adjuntos son demasiado pesados para el proveedor de IA, si hubo un corte de red o un fallo temporal. Prueba con menos archivos, archivos más livianos o reintenta en unos minutos.";
          pushProgress("error", "Sin texto en la respuesta del servidor");
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: errText, isError: true },
          ]);
          toast.error("La IA no devolvió texto. Revisa adjuntos y conexión.");
        }
      } catch (e: any) {
        console.error("Chat error:", e);
        const msg = e?.message || "Error al enviar mensaje";
        pushProgress("error", msg);
        toast.error(msg);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `**No se pudo completar la respuesta.**\n\n${msg}\n\nSi el problema continúa, revisa que la función **ai-chat** esté desplegada y que haya créditos del proveedor de IA.`,
            isError: true,
          },
        ]);
      } finally {
        setIsStreaming(false);
        setStreamProgressSteps([]);
        progressStepsRef.current = [];
      }
    },
    [messages, isStreaming, activeConversationId, activeAiProjectId, createConversation, saveMessage, qc, user]
  );

  const startNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
  }, []);

  const setAiProject = useCallback((projectId: string | null) => {
    setActiveAiProjectId(projectId);
    setActiveConversationId(null);
    setMessages([]);
  }, []);

  return {
    messages,
    isStreaming,
    conversations: conversations ?? [],
    loadingConversations,
    activeConversationId,
    activeAiProjectId,
    sendMessage,
    loadConversation,
    startNewChat,
    deleteConversation: deleteConversation.mutate,
    updateConversationFolder,
    renameConversation,
    setAiProject,
    streamProgressSteps,
  };
}
