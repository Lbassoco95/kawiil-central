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
  MAX_CHAT_IMAGE_BYTES_FOR_MODEL,
  formatMb,
} from "@/lib/chatAttachmentLimits";
import { extractPdfPagesClient } from "@/lib/extractPdfTextClient";

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

const MSG_ANTHROPIC_BILLING_FALLBACK =
  "Los créditos del proveedor de IA (Anthropic/Claude) están agotados o son insuficientes. " +
  "Un administrador debe añadir créditos en https://console.anthropic.com (Plans & Billing) y comprobar el secreto ANTHROPIC_API_KEY en Supabase.";

const MSG_CLAUDE_OVERLOADED =
  "Claude está temporalmente saturado (muchas peticiones en Anthropic). Espera unos segundos e inténtalo de nuevo.";

/** Detecta saturación Anthropic (529, 503 claude_overloaded, o JSON antiguo con detail overloaded_error). */
function parseAnthropicOverloadFromAiChatBody(
  errRaw: string,
  status: number,
): { overload: boolean; retryAfterMs: number } {
  let retryAfterMs = 12_000;
  try {
    const j = JSON.parse(errRaw) as {
      code?: string;
      retry_after?: number;
      message?: string;
      error?: string;
      detail?: string;
    };
    if (typeof j.retry_after === "number" && j.retry_after > 0) {
      retryAfterMs = Math.min(120_000, j.retry_after * 1000 + 2000);
    }
    if (j.code === "claude_overloaded") return { overload: true, retryAfterMs };
    const d = typeof j.detail === "string" ? j.detail : "";
    if (d.includes("overloaded_error") || d.includes('"type":"overloaded_error"')) {
      return { overload: true, retryAfterMs };
    }
    if (status === 529) return { overload: true, retryAfterMs };
    const combined = `${j.message ?? ""} ${j.error ?? ""}`;
    if (status === 503 && /saturado|overload/i.test(combined)) return { overload: true, retryAfterMs };
  } catch {
    if (status === 529) return { overload: true, retryAfterMs };
  }
  return { overload: false, retryAfterMs };
}

/** Entre invocaciones: el Edge ahora procesa muchas páginas/trozos por llamada; breve pausa ante 429. */
const MIN_MS_BETWEEN_INDEX_INVOKES = 120;
/** Páginas por petición al Edge (texto ya extraído en el navegador). */
const PAGES_PER_INDEX_REQUEST = 12;
/** Tras un posible 429 de embeddings, una pausa antes de reintentar la misma petición. */
const INDEX_CLIENT_RETRY_ON_429_MS = 8000;
const INDEX_CLIENT_MAX_429_RETRIES = 1;

function sleepMsChat(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function looksLikeOpenAIRateLimit(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("too many requests")
  );
}

const isPdfChatAttachment = (m: ChatAttachmentMeta) =>
  m.mime_type === "application/pdf" || m.name.toLowerCase().endsWith(".pdf");

/** Progreso de indexación PDF para RAG (fuera del panel del stream de ai-chat). */
export type PdfIndexingStatus =
  | { phase: "extracting"; fileName: string }
  | {
      phase: "indexing";
      fileName: string;
      pageDone: number;
      totalPages: number;
      /** Fragmentos vectoriales del último lote (feedback más “real”). */
      lastBatchChunks?: number;
    };

type PushProgressMode = "append" | "replace_same_phase";

/**
 * Indexa PDFs para RAG tras terminar la respuesta de ai-chat (evita competir con el fetch largo al mismo host).
 */
async function runChatPdfIndexingInBackground(
  savedMeta: ChatAttachmentMeta[],
  pathToFile: Map<string, File>,
  setPdfIndexing: (s: PdfIndexingStatus | null) => void,
): Promise<void> {
  try {
    for (const meta of savedMeta) {
      if (!isPdfChatAttachment(meta)) continue;

      let pageStart = 1;
      let indexId: string | null = null;
      let resumeChunk = 0;
      let continuationChunk = 0;
      let iterations = 0;

      setPdfIndexing({ phase: "extracting", fileName: meta.name });

      const localFile = pathToFile.get(meta.path);
      if (!localFile) {
        toast.error(
          `No se indexó «${meta.name}» en segundo plano (archivo local no disponible). La conversación sigue con el PDF adjunto al modelo.`,
        );
        continue;
      }

      let clientPages: { totalPages: number; pages: string[] } | null = null;
      try {
        clientPages = await extractPdfPagesClient(localFile);
        if (!clientPages.totalPages || clientPages.pages.length === 0) {
          clientPages = null;
        }
      } catch (ex) {
        console.error("extractPdfPagesClient (background)", ex);
        clientPages = null;
      }

      if (!clientPages) {
        toast.error(
          `No se indexó «${meta.name}» (no se pudo leer el texto en el navegador). La conversación sigue con el PDF adjunto.`,
        );
        continue;
      }

      await supabase.auth.refreshSession().catch(() => {});

      setPdfIndexing({
        phase: "indexing",
        fileName: meta.name,
        pageDone: 0,
        totalPages: clientPages.totalPages,
      });

      try {
        let nextIndexInvokeEarliest = 0;
        /* Cada página puede requerir varias invocaciones (trozos de texto); resume_from_chunk = offset en caracteres. */
        while (iterations < 20000) {
          iterations += 1;
          const isResume = resumeChunk > 0;
          const batchLen = isResume
            ? 1
            : Math.min(PAGES_PER_INDEX_REQUEST, clientPages.totalPages - pageStart + 1);
          const pageSlice = clientPages.pages.slice(pageStart - 1, pageStart - 1 + batchLen);
          const body: Record<string, unknown> = {
            bucket: meta.bucket,
            path: meta.path,
            name: meta.name,
            mime_type: meta.mime_type,
            page_start: pageStart,
            attachment_index_id: indexId,
            resume_from_chunk: resumeChunk,
            continuation_chunk_index: continuationChunk,
            client_pdf_pages: {
              total_pages: clientPages.totalPages,
              pages: pageSlice,
            },
          };

          const throttleWait = Math.max(0, nextIndexInvokeEarliest - Date.now());
          if (throttleWait > 0) await sleepMsChat(throttleWait);

          let r429Left = INDEX_CLIENT_MAX_429_RETRIES;
          let d: {
            error?: string;
            attachment_index_id?: string;
            pages_done?: number;
            total_pages?: number;
            done?: boolean;
            next_page?: number | null;
            resume_from_chunk_next?: number | null;
            continuation_chunk_index_next?: number;
            chunks_this_batch?: number;
          };

          for (;;) {
            const { data, error: fnErr } = await supabase.functions.invoke("index-chat-attachment", {
              body,
            });
            nextIndexInvokeEarliest = Date.now() + MIN_MS_BETWEEN_INDEX_INVOKES;

            const early = data as { error?: string } | null;
            const fnMsg = fnErr ? String((fnErr as Error).message || fnErr) : "";
            const bodyErr = early?.error ?? "";

            if (fnErr && !early?.error) {
              if (looksLikeOpenAIRateLimit(fnMsg) && r429Left > 0) {
                r429Left -= 1;
                await sleepMsChat(INDEX_CLIENT_RETRY_ON_429_MS);
                continue;
              }
              throw fnErr;
            }
            if (bodyErr) {
              if (looksLikeOpenAIRateLimit(bodyErr) && r429Left > 0) {
                r429Left -= 1;
                await sleepMsChat(INDEX_CLIENT_RETRY_ON_429_MS);
                continue;
              }
              throw new Error(bodyErr);
            }

            d = data as typeof d;
            if (!d || typeof d.attachment_index_id !== "string") {
              throw new Error("Respuesta inválida de index-chat-attachment");
            }
            break;
          }

          indexId = d.attachment_index_id;
          if (typeof d.continuation_chunk_index_next === "number") {
            continuationChunk = d.continuation_chunk_index_next;
          }
          const donePg = d.pages_done ?? 0;
          const totalPg = d.total_pages ?? 0;
          const batchChunks = typeof d.chunks_this_batch === "number" ? d.chunks_this_batch : 0;
          setPdfIndexing({
            phase: "indexing",
            fileName: meta.name,
            pageDone: donePg,
            totalPages: totalPg,
            lastBatchChunks: batchChunks > 0 ? batchChunks : undefined,
          });

          if (d.resume_from_chunk_next != null) {
            resumeChunk = d.resume_from_chunk_next;
            continue;
          }
          resumeChunk = 0;

          if (d.done) break;
          if (d.next_page == null) break;
          pageStart = d.next_page;
        }
        toast.success(`«${meta.name}» quedó indexado para búsqueda en próximos mensajes.`);
      } catch (e) {
        console.error("index-chat-attachment (background)", e);
        toast.error(
          `No se completó la indexación de «${meta.name}». El PDF sigue disponible para el modelo en este hilo.`,
        );
      }
    }
  } finally {
    setPdfIndexing(null);
  }
}

export function useChat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamProgressSteps, setStreamProgressSteps] = useState<ChatProgressStep[]>([]);
  const progressStepsRef = useRef<ChatProgressStep[]>([]);
  const [pdfIndexingStatus, setPdfIndexingStatus] = useState<PdfIndexingStatus | null>(null);
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
    setPdfIndexingStatus(null);

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
    ): Promise<string | undefined> => {
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

      const insertedId = (msgData as { id?: string } | null)?.id;

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

      return insertedId;
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
        setPdfIndexingStatus(null);
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
      const pushProgress = (phase: string, message: string, mode: PushProgressMode = "append") => {
        if (mode === "replace_same_phase") {
          const arr = [...progressStepsRef.current];
          for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i].phase === phase) {
              arr[i] = { phase, message };
              progressStepsRef.current = arr;
              setStreamProgressSteps([...arr]);
              return;
            }
          }
        }
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
      const pathToFile = new Map<string, File>();
      let uploadedBatchBytes = 0;

      for (const file of files) {
        if (file.type.startsWith("image/") && file.size > MAX_CHAT_IMAGE_BYTES_FOR_MODEL) {
          toast.error(
            `«${file.name}» supera 512 KB; para visión en el chat comprime o recorta la imagen (límite del modelo).`,
          );
          continue;
        }
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
        pathToFile.set(objectPath, file);
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

      let userMessageId: string | undefined;
      try {
        userMessageId = await saveMessage(convId, "user", text, savedMeta.length ? savedMeta : null);
      } catch (persistErr: any) {
        console.error(persistErr);
        toast.error(persistErr?.message || "No se pudo guardar el mensaje");
        setIsStreaming(false);
        setStreamProgressSteps([]);
        progressStepsRef.current = [];
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      if (userMessageId) {
        void supabase.functions
          .invoke("analyze-improvement-suggestions", { body: { message_id: userMessageId } })
          .catch(() => {});
      }

      const refsForAiChat: ChatAttachmentMeta[] = [...savedMeta];

      pushProgress("ai_connect", "Conectando con Kawiil AI y procesando contexto…");

      let assistantContent = "";
      const hasArtifactMarker = (text: string) => /\[artifact:[a-f0-9-]{36}\|/.test(text);

      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;

        const chatBody = JSON.stringify({
          messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
          conversationId: convId,
          ai_project_id: activeAiProjectId || undefined,
          attachmentRefs: refsForAiChat.length ? refsForAiChat : undefined,
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

        const fetchChatResilient = async (): Promise<Response> => {
          for (let netTry = 0; netTry < 2; netTry++) {
            try {
              return await chatFetch();
            } catch (err: unknown) {
              const m = err instanceof Error ? err.message : String(err);
              const soft =
                /failed to fetch/i.test(m) ||
                /networkerror/i.test(m) ||
                /load failed/i.test(m);
              if (netTry === 0 && soft) {
                await supabase.auth.refreshSession().catch(() => {});
                await new Promise((r) => setTimeout(r, 3000));
                continue;
              }
              throw err;
            }
          }
          throw new Error("No se pudo conectar con el servidor de chat.");
        };

        let resp = await fetchChatResilient();
        for (let r429 = 0; r429 < 5 && resp.status === 429; r429++) {
          let waitMs = 6000 + r429 * 4000;
          try {
            const errRaw = await resp.text();
            const j = JSON.parse(errRaw) as { retry_after?: number; message?: string; error?: string };
            if (typeof j.retry_after === "number" && j.retry_after > 0) {
              waitMs = Math.min(120_000, j.retry_after * 1000 + 3000);
            }
          } catch {
            /* ignore */
          }
          pushProgress(
            "rate_limit",
            `Límite temporal del proveedor de IA. Esperando ${Math.round(waitMs / 1000)} s y reintentando (${r429 + 1}/5)…`,
          );
          await new Promise((r) => setTimeout(r, waitMs));
          resp = await fetchChatResilient();
        }

        for (let rOv = 0; rOv < 6; rOv++) {
          if (resp.status !== 503 && resp.status !== 529) break;
          const errRaw = await resp.text();
          const { overload, retryAfterMs } = parseAnthropicOverloadFromAiChatBody(errRaw, resp.status);
          if (!overload) {
            resp = new Response(errRaw, {
              status: resp.status,
              headers: { "content-type": resp.headers.get("content-type") || "application/json" },
            });
            break;
          }
          if (rOv >= 5) {
            resp = new Response(
              JSON.stringify({
                error: MSG_CLAUDE_OVERLOADED,
                message: MSG_CLAUDE_OVERLOADED,
                code: "claude_overloaded",
              }),
              { status: 503, headers: { "content-type": "application/json" } },
            );
            break;
          }
          pushProgress(
            "overload",
            `El servicio de IA está muy cargado. Esperando ${Math.round(retryAfterMs / 1000)} s (reintento ${rOv + 1}/5)…`,
          );
          await new Promise((r) => setTimeout(r, retryAfterMs));
          resp = await fetchChatResilient();
        }

        const ct = resp.headers.get("content-type") || "";

        if (!resp.ok) {
          const errRaw = await resp.text();
          let errMsg = `Error ${resp.status}`;
          if (resp.status === 546) {
            errMsg =
              "Límite de recursos en Supabase (código 546: memoria o tiempo de CPU del Edge Function). " +
              "Suele ocurrir con PDFs de muchas páginas, Excel muy grandes o varios adjuntos a la vez. " +
              "Prueba un PDF más corto (o las páginas que necesites), exporta solo una hoja a CSV, imágenes bajo ~512 KB para el modelo, o envía los archivos en mensajes separados.";
          } else {
            try {
              const j = JSON.parse(errRaw) as {
                error?: string;
                message?: string;
                code?: string;
                detail?: string;
              };
              if (resp.status === 402 || j.code === "anthropic_billing") {
                errMsg = j.message || j.error || MSG_ANTHROPIC_BILLING_FALLBACK;
              } else if (j.code === "claude_overloaded") {
                errMsg = j.message || j.error || MSG_CLAUDE_OVERLOADED;
              } else if (
                typeof j.detail === "string" &&
                (j.detail.includes("overloaded_error") || j.detail.includes('"type":"overloaded_error"'))
              ) {
                errMsg = MSG_CLAUDE_OVERLOADED;
              } else if (resp.status === 413 || j.code === "context_too_long") {
                errMsg =
                  j.message ||
                  j.error ||
                  "El contexto supera el límite del modelo (200k tokens). Abre un chat nuevo, acorta el historial o usa archivos más pequeños.";
              } else {
                errMsg = j.message || j.error || errMsg;
              }
            } catch {
              if (resp.status === 402) {
                errMsg = MSG_ANTHROPIC_BILLING_FALLBACK;
              } else if (errRaw && errRaw.length < 500) {
                errMsg = errRaw;
              }
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
            const aid = await saveMessage(convId, "assistant", assistantContent, null);
            if (aid) {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant" && !last.isError) {
                  return prev.map((m, i) => (i === prev.length - 1 ? { ...m, id: aid } : m));
                }
                return prev;
              });
            }
            void supabase.functions
              .invoke("extract-ai-memories", { body: { conversation_id: convId } })
              .catch(() => {});
            qc.invalidateQueries({ queryKey: ["chat-conversations"] });
            if (hasArtifactMarker(assistantContent)) {
              qc.invalidateQueries({ queryKey: ["ai-artifacts", activeAiProjectId ?? null] });
            }
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
          const aid = await saveMessage(convId, "assistant", assistantContent, null);
          if (aid) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant" && !last.isError) {
                return prev.map((m, i) => (i === prev.length - 1 ? { ...m, id: aid } : m));
              }
              return prev;
            });
          }
          void supabase.functions
            .invoke("extract-ai-memories", { body: { conversation_id: convId } })
            .catch(() => {});
          qc.invalidateQueries({ queryKey: ["chat-conversations"] });
          if (hasArtifactMarker(assistantContent)) {
            qc.invalidateQueries({ queryKey: ["ai-artifacts", activeAiProjectId ?? null] });
          }
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
        const overloadHint =
          /saturado|overloaded|529|claude_overloaded/i.test(msg) || msg === MSG_CLAUDE_OVERLOADED;
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `**No se pudo completar la respuesta.**\n\n${msg}\n\n${
              overloadHint
                ? "Es un fallo temporal del proveedor de IA; suele bastar con reintentar en unos minutos."
                : "Si el problema continúa, revisa que la función **ai-chat** esté desplegada y que haya créditos del proveedor de IA."
            }`,
            isError: true,
          },
        ]);
      } finally {
        setIsStreaming(false);
        setStreamProgressSteps([]);
        progressStepsRef.current = [];
      }

      const shouldIndexPdfs =
        savedMeta.some(isPdfChatAttachment) && pathToFile.size > 0;
      if (shouldIndexPdfs) {
        void runChatPdfIndexingInBackground(savedMeta, pathToFile, setPdfIndexingStatus).catch((err) =>
          console.error("runChatPdfIndexingInBackground", err),
        );
      }
    },
    [
      messages,
      isStreaming,
      pdfIndexingStatus,
      activeConversationId,
      activeAiProjectId,
      createConversation,
      saveMessage,
      qc,
      user,
    ]
  );

  const startNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setPdfIndexingStatus(null);
  }, []);

  const setAiProject = useCallback((projectId: string | null) => {
    setActiveAiProjectId(projectId);
    setActiveConversationId(null);
    setMessages([]);
    setPdfIndexingStatus(null);
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
    pdfIndexingStatus,
  };
}
