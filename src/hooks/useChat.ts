import { useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  folder: string | null;
  created_at: string;
  updated_at: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

export function useChat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // List conversations
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

  // Load conversation messages
  const loadConversation = useCallback(async (conversationId: string) => {
    const { data, error } = await supabase
      .from("chat_messages" as any)
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (error) { toast.error("Error al cargar mensajes"); return; }
    setMessages((data as unknown as ChatMessage[]) || []);
    setActiveConversationId(conversationId);
  }, []);

  // Create new conversation
  const createConversation = useCallback(async (title: string, folder?: string) => {
    const orgRes = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
    const { data, error } = await supabase
      .from("chat_conversations" as any)
      .insert({ user_id: user!.id, organization_id: orgRes.data, title, folder: folder || null } as any)
      .select()
      .single();
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["chat-conversations"] });
    return (data as any).id as string;
  }, [user, qc]);

  // Update conversation folder
  const updateConversationFolder = useCallback(async (conversationId: string, folder: string | null) => {
    await supabase.from("chat_conversations" as any)
      .update({ folder } as any)
      .eq("id", conversationId);
    qc.invalidateQueries({ queryKey: ["chat-conversations"] });
  }, [qc]);

  // Rename conversation
  const renameConversation = useCallback(async (conversationId: string, title: string) => {
    await supabase.from("chat_conversations" as any)
      .update({ title } as any)
      .eq("id", conversationId);
    qc.invalidateQueries({ queryKey: ["chat-conversations"] });
  }, [qc]);

  // Save message to DB and trigger background embedding
  const saveMessage = useCallback(async (conversationId: string, role: string, content: string) => {
    const { data: msgData } = await supabase.from("chat_messages" as any).insert({
      conversation_id: conversationId,
      role,
      content,
    } as any).select("id").single();

    await supabase.from("chat_conversations" as any)
      .update({ updated_at: new Date().toISOString() } as any)
      .eq("id", conversationId);

    // Background: generate embedding for this message (non-blocking)
    if (msgData && content.length > 30) {
      const orgRes = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      supabase.functions.invoke("generate-embeddings", {
        body: {
          texts: [`[${role}] ${content}`],
          source_type: "chat_message",
          source_id: (msgData as any).id,
          organization_id: orgRes.data,
          auto_chunk: false,
        },
      }).catch(() => { /* embedding failure is non-critical */ });
    }
  }, [user]);

  // Delete conversation
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

  // Send message with streaming
  const sendMessage = useCallback(async (input: string) => {
    if (!input.trim() || isStreaming) return;

    let convId = activeConversationId;
    if (!convId) {
      const title = input.length > 50 ? input.substring(0, 50) + "..." : input;
      convId = await createConversation(title);
      setActiveConversationId(convId);
    }

    const userMsg: ChatMessage = { role: "user", content: input };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setIsStreaming(true);

    // Save user message
    await saveMessage(convId, "user", input);

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
        }),
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.error || `Error ${resp.status}`);
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
          if (jsonStr === "[DONE]") { streamDone = true; break; }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantContent += content;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
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

      // Flush remaining
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) assistantContent += content;
          } catch { /* ignore */ }
        }
        if (assistantContent) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
            }
            return [...prev, { role: "assistant", content: assistantContent }];
          });
        }
      }

      // Save assistant message
      if (assistantContent) {
        await saveMessage(convId, "assistant", assistantContent);
        qc.invalidateQueries({ queryKey: ["chat-conversations"] });
      }
    } catch (e: any) {
      console.error("Chat error:", e);
      toast.error(e.message || "Error al enviar mensaje");
    } finally {
      setIsStreaming(false);
    }
  }, [messages, isStreaming, activeConversationId, createConversation, saveMessage, qc]);

  const startNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
  }, []);

  return {
    messages,
    isStreaming,
    conversations: conversations ?? [],
    loadingConversations,
    activeConversationId,
    sendMessage,
    loadConversation,
    startNewChat,
    deleteConversation: deleteConversation.mutate,
    updateConversationFolder,
    renameConversation,
  };
}
