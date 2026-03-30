import { useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
const MAX_CHAT_FILES = 5;
const MAX_CHAT_FILE_BYTES = 15 * 1024 * 1024;

export function useChat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
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

      const { data: msgData } = await supabase
        .from("chat_messages" as any)
        .insert(payload as any)
        .select("id")
        .single();

      await supabase
        .from("chat_conversations" as any)
        .update({ updated_at: new Date().toISOString() } as any)
        .eq("id", conversationId);

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
      const files = (opts?.files ?? []).slice(0, MAX_CHAT_FILES);
      const text = input.trim() || (files.length ? "(Archivos adjuntos)" : "");
      if ((!text && !files.length) || isStreaming) return;

      let convId = activeConversationId;
      if (!convId) {
        const title = text.length > 50 ? text.substring(0, 50) + "..." : text;
        convId = await createConversation(title);
        setActiveConversationId(convId);
      }

      const orgRes = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const orgId = orgRes.data as string;

      const savedMeta: ChatAttachmentMeta[] = [];
      const attachmentRefs: ChatAttachmentMeta[] = [];

      for (const file of files) {
        if (file.size > MAX_CHAT_FILE_BYTES) {
          toast.error(`${file.name} supera 15MB`);
          continue;
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
        attachmentRefs.push(meta);
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
        return;
      }

      const userMsg: ChatMessage = {
        role: "user",
        content: text,
        attachments: savedMeta.length ? savedMeta : undefined,
      };
      const allMessages = [...messages, userMsg];
      setMessages(allMessages);
      setIsStreaming(true);

      await saveMessage(convId, "user", text, savedMeta.length ? savedMeta : null);

      let assistantContent = "";

      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;

        const resp = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
            conversationId: convId,
            ai_project_id: activeAiProjectId || undefined,
            attachmentRefs: attachmentRefs.length ? attachmentRefs : undefined,
          }),
        });

        if (!resp.ok) {
          const errorData = await resp.json().catch(() => ({}));
          throw new Error((errorData as any).error || `Error ${resp.status}`);
        }

        if (!resp.body) throw new Error("No stream body");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";
        let streamDone = false;

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
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (content) {
                assistantContent += content;
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
              const parsed = JSON.parse(jsonStr);
              const c = parsed.choices?.[0]?.delta?.content;
              if (c) assistantContent += c;
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

        if (assistantContent) {
          await saveMessage(convId, "assistant", assistantContent, null);
          qc.invalidateQueries({ queryKey: ["chat-conversations"] });
        }
      } catch (e: any) {
        console.error("Chat error:", e);
        toast.error(e.message || "Error al enviar mensaje");
      } finally {
        setIsStreaming(false);
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
  };
}
