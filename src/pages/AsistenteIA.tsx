import { useState, useRef, useEffect, useMemo, useCallback, Fragment } from "react";
import {
  DuplicateFileResolutionDialog,
  type DuplicateResolutionChoice,
} from "@/components/shared/DuplicateFileResolutionDialog";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import {
  useChat,
  type ChatAgentTaskRef,
  syntheticChatAgentSessionFromMessages,
} from "@/hooks/useChat";
import { useAiProjects, useAiProjectDocuments, useAiProjectMembers } from "@/hooks/useAiProjects";
import { useAiSharedMemories } from "@/hooks/useAiSharedMemories";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useAuth } from "@/contexts/AuthContext";
import { useAiMemories } from "@/hooks/useAiMemories";
import { useAiArtifacts, type AiArtifact } from "@/hooks/useAiArtifacts";
import { useProjectDocumentUpload } from "@/hooks/useProjectDocumentUpload";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Send, Sparkles, Loader2, PanelLeftClose, PanelLeft, PanelRightClose, PanelRight,
  BrainCircuit, Settings2, FileText, UserPlus, Copy, MessageSquare, ListChecks, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { matchesMobileViewport, useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invokeSlackApi } from "@/lib/slackApi";
import { ProjectSidebar } from "@/components/ai/ProjectSidebar";
import { KnowledgePanel } from "@/components/ai/KnowledgePanel";
import { ArtifactCard } from "@/components/ai/ArtifactCard";
import { AgentTaskCard } from "@/components/ai/AgentTaskCard";
import { DelegateToAgentDialog, type AttachmentRef } from "@/components/ai/DelegateToAgentDialog";
import { ArtifactViewer } from "@/components/ai/ArtifactViewer";
import { ProjectPreviewCard } from "@/components/ai/ProjectPreviewCard";
import { ChatAttachmentPicker, ChatAttachmentChips } from "@/components/ai/ChatAttachmentPicker";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { chatLimits } from "@/lib/fileIntake/limits";
import { ChatProcessingPanel } from "@/components/ai/ChatProcessingPanel";
import {
  MAX_CHAT_ATTACHMENT_BATCH_BYTES,
  MAX_CHAT_ATTACHMENT_BYTES_PER_FILE,
  MAX_CHAT_ATTACHMENT_FILES,
  MAX_CHAT_IMAGE_BYTES_FOR_MODEL,
  formatMb,
} from "@/lib/chatAttachmentLimits";
import { AiProjectMembersDialog } from "@/components/ai/AiProjectMembersDialog";
import { AiMessageFeedback } from "@/components/ai/AiMessageFeedback";
import { nowMX, toDateStringMX } from "@/lib/dateUtils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  KAWIIL_AI_GRADIENT,
  KAWIIL_AI_HEADER_BG,
  KAWIIL_AI_SOFT_BG,
} from "@/lib/kawiilAi";
import { mimeTypeForFile } from "@/lib/mimeFromFilename";
import { useResolveDuplicateFilenames } from "@/hooks/useResolveDuplicateFilenames";
import type { AgentTaskDeliverableLink } from "@/lib/agentTaskResult";
import { renderTextWithMentionHighlights } from "@/lib/renderMentionHighlights";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

/** Si `storage.upload` no responde, el botón "Delegar" quedaría en spinner indefinidamente. */
const DELEGATE_UPLOAD_TIMEOUT_MS = 150_000;
const DELEGATE_PROJECT_LINK_TIMEOUT_MS = 120_000;

const FALLBACK_SUGGESTIONS = [
  "¿Cuáles son mis tareas pendientes más urgentes?",
  "No sé cómo hacer una declaración anual, ¿me guías?",
  "¿Qué comunicados internos recientes hay?",
  "¿Cómo está la carga de trabajo del equipo?",
  "Tengo miedo de equivocarme en un trámite, ¿me ayudas?",
  "¿Dónde encuentro el procedimiento para alta en IMSS?",
];

const ARTIFACT_RE = /\[artifact:([a-f0-9-]{36})\|([^\]]+)\|([^\]]+)\]/gi;
const PROJECT_LINK_RE = /\[project:([a-f0-9-]{36})\|([^\]|]+)(?:\|([^\]]*))?\]/gi;

function AsistenteIAContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const {
    messages, isStreaming, streamingConversationIds, streamProgressSteps, pdfIndexingStatus, conversations, activeConversationId, activeAiProjectId,
    agentSession, returnToKawiilAssistant,
    sendMessage, loadConversation, addAgentTaskMessage, patchMessageContent, startNewChat,
    deleteConversation,
    updateConversationFolder, renameConversation, setAiProject,
  } = useChat();
  const {
    projects: aiProjects, createProject: createAiProject,
    archiveProject: archiveAiProject, updateProject: updateAiProject,
    leaveAiProject,
  } = useAiProjects();
  const { data: orgUsers = [] } = useOrgUsers();
  const { members: projectMembers, isLoading: membersLoading, addMember, removeMember } = useAiProjectMembers(activeAiProjectId);
  const { sharedMemories, deleteMemory: deleteSharedMemory } = useAiSharedMemories(activeAiProjectId);
  const { memories, deleteMemory, createMemory, updateMemory } = useAiMemories(activeAiProjectId);
  const { artifacts, deleteArtifact, updateArtifact } = useAiArtifacts(activeAiProjectId);
  const { documents: projectDocs, addDocument, removeDocument } = useAiProjectDocuments(activeAiProjectId);

  const [dupUploadOpen, setDupUploadOpen] = useState(false);
  const [dupUploadName, setDupUploadName] = useState("");
  const dupUploadResolver = useRef<((c: DuplicateResolutionChoice) => void) | null>(null);

  const duplicateUploadPrompt = useCallback((fileName: string) => {
    setDupUploadName(fileName);
    setDupUploadOpen(true);
    return new Promise<DuplicateResolutionChoice>((resolve) => {
      dupUploadResolver.current = resolve;
    });
  }, []);

  const onDupUploadResolve = useCallback((c: DuplicateResolutionChoice) => {
    setDupUploadOpen(false);
    dupUploadResolver.current?.(c);
    dupUploadResolver.current = null;
  }, []);

  const [dupChatOpen, setDupChatOpen] = useState(false);
  const [dupChatName, setDupChatName] = useState("");
  const dupChatResolver = useRef<((c: DuplicateResolutionChoice) => void) | null>(null);

  const chatDuplicatePrompt = useCallback((fileName: string) => {
    setDupChatName(fileName);
    setDupChatOpen(true);
    return new Promise<DuplicateResolutionChoice>((resolve) => {
      dupChatResolver.current = resolve;
    });
  }, []);

  const onDupChatResolve = useCallback((c: DuplicateResolutionChoice) => {
    setDupChatOpen(false);
    dupChatResolver.current?.(c);
    dupChatResolver.current = null;
  }, []);

  const resolveChatDuplicateFilenames = useResolveDuplicateFilenames(chatDuplicatePrompt);

  const handlePendingFilesChange = useCallback(
    async (next: File[]) => {
      const resolved = await resolveChatDuplicateFilenames(next);
      setPendingFiles(resolved);
    },
    [resolveChatDuplicateFilenames]
  );

  const { uploadToProject, uploading, progress: uploadProgress } = useProjectDocumentUpload(
    activeAiProjectId,
    projectDocs ?? [],
    duplicateUploadPrompt
  );

  const [input, setInput] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [newProjectInstructions, setNewProjectInstructions] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [linkFilesToProject, setLinkFilesToProject] = useState(false);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [artifactDialogOpen, setArtifactDialogOpen] = useState(false);
  /** Escritorio: panel derecho tipo Claude (chat + documento). Móvil: sigue usando Dialog. */
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(false);
  const [artifactDialogArtifact, setArtifactDialogArtifact] = useState<AiArtifact | null>(null);
  const [artifactDialogLoading, setArtifactDialogLoading] = useState(false);
  const [isDelegateModalOpen, setIsDelegateModalOpen] = useState(false);
  const [delegateAttachments, setDelegateAttachments] = useState<AttachmentRef[]>([]);
  /** Título sugerido al abrir el modal (p. ej. seguimiento de tarea); si es null se usa el input del composer. */
  const [delegateModalTitleOverride, setDelegateModalTitleOverride] = useState<string | null>(null);
  const [delegateDefaultAgentTemplateId, setDelegateDefaultAgentTemplateId] = useState<string | null>(null);
  const [delegatePreviousTaskId, setDelegatePreviousTaskId] = useState<string | null>(null);
  const [delegateFollowUpKind, setDelegateFollowUpKind] = useState<"retry" | "continuation" | null>(null);
  const [isPreparingDelegate, setIsPreparingDelegate] = useState(false);
  const [agentTaskDeliverables, setAgentTaskDeliverables] = useState<Record<string, AgentTaskDeliverableLink[]>>(
    () => ({}),
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  const { data: proactiveChatHint } = useQuery({
    queryKey: ["asistente-proactive-hint", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("body")
        .eq("user_id", user!.id)
        .eq("type", "ai_proactive_tip")
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.body as string | null | undefined;
    },
    enabled: !!user,
  });

  const { data: dynamicSuggestions = FALLBACK_SUGGESTIONS } = useQuery({
    queryKey: ["asistente-sugerencias", user?.id],
    enabled: !!user && !activeAiProjectId,
    queryFn: async () => {
      const out: string[] = [];
      const today = toDateStringMX(nowMX());
      const { data: tasks } = await supabase
        .from("tasks")
        .select("title, priority, due_date, projects(name)")
        .eq("assigned_to", user!.id)
        .in("status", ["pendiente", "en_progreso", "en_revision"])
        .order("due_date", { ascending: true })
        .limit(12);
      const list = tasks ?? [];
      const overdue = list.filter((t) => t.due_date && String(t.due_date).slice(0, 10) < today);
      if (overdue.length > 0) {
        out.push(
          overdue.length === 1
            ? `Tienes 1 tarea vencida: "${overdue[0].title.slice(0, 48)}${overdue[0].title.length > 48 ? "…" : ""}". ¿La priorizamos?`
            : `Tienes ${overdue.length} tareas vencidas. ¿Quieres que prioricemos las más urgentes?`,
        );
      }
      const urgent = list.filter((t) => t.priority === "urgente" || t.priority === "alta").slice(0, 3);
      for (const t of urgent) {
        if (out.length >= 6) break;
        const pn = (t as { projects?: { name?: string } }).projects?.name;
        out.push(
          pn
            ? `"${t.title.slice(0, 40)}${t.title.length > 40 ? "…" : ""}" (${pn}) — ¿revisamos?`
            : `"${t.title.slice(0, 44)}${t.title.length > 44 ? "…" : ""}" — ¿revisamos?`,
        );
      }
      const { data: prof } = await supabase.from("profiles").select("organization_id").eq("user_id", user!.id).single();
      if (prof?.organization_id) {
        const { data: projs } = await supabase
          .from("projects")
          .select("name")
          .eq("organization_id", prof.organization_id)
          .eq("status", "activo")
          .order("updated_at", { ascending: false })
          .limit(2);
        for (const p of projs ?? []) {
          if (out.length >= 6) break;
          out.push(`El proyecto "${p.name}" tuvo actividad reciente. ¿Repasamos pendientes?`);
        }
      }
      let i = 0;
      while (out.length < 6) {
        out.push(FALLBACK_SUGGESTIONS[i % FALLBACK_SUGGESTIONS.length]);
        i++;
      }
      return out.slice(0, 6);
    },
  });

  const suggestionCards = activeAiProjectId ? FALLBACK_SUGGESTIONS.slice(0, 6) : dynamicSuggestions;

  const filteredConversations = useMemo(() => {
    if (activeAiProjectId) {
      return conversations.filter((c) => c.ai_project_id === activeAiProjectId);
    }
    return conversations;
  }, [conversations, activeAiProjectId]);

  const activeProject = useMemo(
    () => aiProjects.find((p) => p.id === activeAiProjectId),
    [aiProjects, activeAiProjectId]
  );

  /** Cubre hilo con tareas de agente aunque falle `agent_session` en conversación. */
  const displayAgentSession = useMemo(
    () => agentSession ?? syntheticChatAgentSessionFromMessages(messages),
    [agentSession, messages],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isMobile) setShowSidebar(false);
  }, [isMobile]);

  useEffect(() => {
    const projectParam = searchParams.get("project");
    if (projectParam && projectParam !== activeAiProjectId) {
      setAiProject(projectParam);
    }
  }, [searchParams]);

  const slackGroupPrefillApplied = useRef<string | null>(null);
  const slackGroupIdParam = searchParams.get("slackGroup");
  useEffect(() => {
    const gid = slackGroupIdParam;
    if (!gid) {
      slackGroupPrefillApplied.current = null;
      return;
    }
    if (!user?.id || slackGroupPrefillApplied.current === gid) return;
    let cancelled = false;
    slackGroupPrefillApplied.current = gid;
    void (async () => {
      const { data: g, error: ge } = await supabase
        .from("slack_sidebar_groups")
        .select("title")
        .eq("id", gid)
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (ge || !g) {
        slackGroupPrefillApplied.current = null;
        return;
      }
      const { data: rows } = await supabase
        .from("slack_sidebar_group_channels")
        .select("channel_id")
        .eq("group_id", gid)
        .order("sort_order");
      const cids = (rows || []).map((r) => r.channel_id).slice(0, 12);
      const parts: string[] = [];
      for (const cid of cids) {
        try {
          const d = await invokeSlackApi<{
            ok: boolean;
            messages?: { text?: string }[];
          }>({
            action: "conversations.history",
            channel: cid,
            limit: 8,
          });
          if (d.ok && d.messages?.length) {
            const texts = [...d.messages]
              .reverse()
              .map((m) => (m.text || "").replace(/\s+/g, " ").trim().slice(0, 500))
              .filter(Boolean);
            if (texts.length) parts.push(`Conversación ${cid}:\n${texts.join("\n—\n")}`);
          }
        } catch {
          /* omit canal si falla API */
        }
      }
      const body = parts.length ? parts.join("\n\n") : "(No se pudieron cargar mensajes recientes; revisa conexión Slack.)";
      if (!cancelled) {
        setInput(
          `Tengo en Slack un grupo llamado «${g.title}». Últimos mensajes (recortados):\n\n${body}\n\nResume temas abiertos, riesgos y próximos pasos sugeridos.`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slackGroupIdParam, user?.id]);

  const promptPrefillApplied = useRef<string | null>(null);
  const promptParam = searchParams.get("prompt");
  useEffect(() => {
    const raw = promptParam;
    if (!raw) {
      promptPrefillApplied.current = null;
      return;
    }
    if (promptPrefillApplied.current === raw) return;
    promptPrefillApplied.current = raw;
    let text = raw;
    try {
      text = decodeURIComponent(raw);
    } catch {
      text = raw;
    }
    setInput(text);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("prompt");
        return p;
      },
      { replace: true },
    );
  }, [promptParam, setSearchParams]);

  const conversationDeeplinkApplied = useRef<string | null>(null);
  const conversationParam = searchParams.get("conversation");
  useEffect(() => {
    const raw = conversationParam?.trim() ?? "";
    if (!raw) {
      conversationDeeplinkApplied.current = null;
      return;
    }
    if (!/^[0-9a-f-]{36}$/i.test(raw)) return;
    if (conversationDeeplinkApplied.current === raw) return;
    conversationDeeplinkApplied.current = raw;

    if (raw === activeConversationId) {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.delete("conversation");
          return p;
        },
        { replace: true },
      );
      return;
    }

    void (async () => {
      try {
        await loadConversation(raw);
      } finally {
        setSearchParams(
          (prev) => {
            const p = new URLSearchParams(prev);
            p.delete("conversation");
            return p;
          },
          { replace: true },
        );
      }
    })();
  }, [conversationParam, activeConversationId, loadConversation, setSearchParams]);

  useEffect(() => {
    if (activeProject) setShowKnowledge(true);
  }, [activeProject?.id]);

  const handleSend = () => {
    if ((!input.trim() && pendingFiles.length === 0) || isStreaming) return;
    sendMessage(input.trim(), {
      files: pendingFiles,
      onAfterChatUpload:
        linkFilesToProject && activeAiProjectId ? (file) => uploadToProject(file) : undefined,
    });
    setInput("");
    setPendingFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  };

  /** Sube `pendingFiles` al bucket del chat para obtener refs consumibles por `dispatch-to-agent`. */
  const uploadPendingFilesForDelegate = useCallback(async (): Promise<AttachmentRef[]> => {
    if (!user) return [];
    const files = pendingFiles.slice(0, MAX_CHAT_ATTACHMENT_FILES);
    if (files.length === 0) return [];

    const orgRes = await supabase.rpc("get_user_org_id", { _user_id: user.id });
    if (orgRes.error || !orgRes.data) {
      toast.error(orgRes.error?.message || "No se pudo obtener la organización");
      return [];
    }
    const orgId = orgRes.data as string;
    const saved: AttachmentRef[] = [];
    let batchBytes = 0;

    for (const file of files) {
      if (file.type.startsWith("image/") && file.size > MAX_CHAT_IMAGE_BYTES_FOR_MODEL) {
        toast.error(
          `«${file.name}» supera 512 KB; para delegar comprime o recorta la imagen (límite del modelo).`,
        );
        continue;
      }
      if (file.size > MAX_CHAT_ATTACHMENT_BYTES_PER_FILE) {
        toast.error(`${file.name} supera ${formatMb(MAX_CHAT_ATTACHMENT_BYTES_PER_FILE)} MB por archivo`);
        continue;
      }
      if (batchBytes + file.size > MAX_CHAT_ATTACHMENT_BATCH_BYTES) {
        toast.error(`Límite de ${formatMb(MAX_CHAT_ATTACHMENT_BATCH_BYTES)} MB total por mensaje`);
        break;
      }
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const objectPath = `${orgId}/${user.id}/${crypto.randomUUID()}_${safe}`;
      let upRes: { error: Error | null } | null = null;
      try {
        upRes = await Promise.race([
          supabase.storage.from("chat-uploads").upload(objectPath, file),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("DELEGATE_UPLOAD_TIMEOUT")), DELEGATE_UPLOAD_TIMEOUT_MS),
          ),
        ]);
      } catch (e) {
        if (e instanceof Error && e.message === "DELEGATE_UPLOAD_TIMEOUT") {
          toast.error(
            `Tiempo agotado subiendo «${file.name}». Revisa la conexión o prueba con menos archivos.`,
          );
          continue;
        }
        throw e;
      }
      const upErr = upRes?.error ?? null;
      if (upErr) {
        toast.error(`No se pudo subir ${file.name}`);
        continue;
      }
      saved.push({
        bucket: "chat-uploads",
        path: objectPath,
        name: file.name,
        mime_type: mimeTypeForFile(file),
      });
      batchBytes += file.size;
      if (linkFilesToProject && activeAiProjectId) {
        try {
          await Promise.race([
            uploadToProject(file),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error("PROJECT_LINK_TIMEOUT")), DELEGATE_PROJECT_LINK_TIMEOUT_MS),
            ),
          ]);
        } catch {
          /* no bloquear delegación (timeout u otro error) */
        }
      }
    }
    return saved;
  }, [user, pendingFiles, linkFilesToProject, activeAiProjectId, uploadToProject]);

  const openDelegateModal = useCallback(async () => {
    if (isStreaming) return;
    setIsPreparingDelegate(true);
    try {
      const refs = await uploadPendingFilesForDelegate();
      if (pendingFiles.length > 0 && refs.length === 0) {
        toast.error("No se pudo preparar ningún adjunto para delegar.");
        return;
      }
      setDelegateModalTitleOverride(null);
      setDelegateDefaultAgentTemplateId(null);
      setDelegatePreviousTaskId(null);
      setDelegateFollowUpKind(null);
      setDelegateAttachments(refs);
      setIsDelegateModalOpen(true);
    } finally {
      setIsPreparingDelegate(false);
    }
  }, [isStreaming, pendingFiles.length, uploadPendingFilesForDelegate]);

  const openFollowUpWithAgent = useCallback(
    (ref: ChatAgentTaskRef, mode: "continuation" | "retry") => {
      if (isStreaming) return;
      setDelegatePreviousTaskId(ref.task_id);
      setDelegateFollowUpKind(mode);
      setDelegateModalTitleOverride(
        (mode === "retry" ? `Reintento: ${ref.title}` : `Seguimiento: ${ref.title}`).trim().slice(0, 200),
      );
      setDelegateDefaultAgentTemplateId(ref.agent_id);
      setDelegateAttachments([]);
      setIsDelegateModalOpen(true);
    },
    [isStreaming],
  );

  /** Desde seguimiento: delegar sin `previous_task_id` (tarea desacoplada). Mantiene agente y adjuntos del modal. */
  const handleDelegateStartFreshTask = useCallback(() => {
    setDelegatePreviousTaskId(null);
    setDelegateFollowUpKind(null);
    setDelegateModalTitleOverride(null);
  }, []);

  /** Abre el modal de delegar con las instrucciones del proyecto pre-rellenadas (si existen). */
  const openDelegateWithProjectInstructionPrefill = useCallback(async () => {
    if (isStreaming) return;
    if (!activeProject?.instructions?.trim()) {
      toast.info("Añade instrucciones al proyecto en Conocimiento o edita el proyecto para reenviarlas al agente.");
    }
    await openDelegateModal();
  }, [isStreaming, activeProject?.instructions, openDelegateModal]);

  const handleAgentDeliverableLinks = useCallback((taskId: string, links: AgentTaskDeliverableLink[]) => {
    setAgentTaskDeliverables((prev) => {
      const prevL = prev[taskId];
      if (
        prevL &&
        prevL.length === links.length &&
        prevL.every((p, i) => p.href === links[i]?.href && p.label === links[i]?.label)
      ) {
        return prev;
      }
      return { ...prev, [taskId]: links };
    });
  }, []);

  useEffect(() => {
    setAgentTaskDeliverables({});
  }, [activeConversationId]);

  const handleAgentDelegated = useCallback(
    async (ref: ChatAgentTaskRef) => {
      await addAgentTaskMessage(ref);
      setInput("");
      setPendingFiles([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    },
    [addAgentTaskMessage],
  );

  const handleCreateAiProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      await createAiProject.mutateAsync({
        name: newProjectName.trim(),
        description: newProjectDesc.trim() || undefined,
        instructions: newProjectInstructions.trim() || undefined,
      });
      toast.success("Proyecto de IA creado");
      setShowCreateProject(false);
      setNewProjectName("");
      setNewProjectDesc("");
      setNewProjectInstructions("");
    } catch (e) {
      console.error("[AsistenteIA] createAiProject", e);
      const msg =
        e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : e instanceof Error
            ? e.message
            : "Error al crear proyecto";
      toast.error(msg);
    }
  };

  const handleIndexDropbox = useCallback(async (path: string) => {
    if (!path.trim()) return;
    setIndexing(true);
    try {
      const { error } = await supabase.functions.invoke("index-dropbox", {
        body: { folder_path: path.trim(), ai_project_id: activeAiProjectId },
      });
      if (error) throw error;
      toast.success("Indexacion de Dropbox iniciada");
    } catch (e: any) {
      toast.error(e.message || "Error al indexar");
    } finally {
      setIndexing(false);
    }
  }, [activeAiProjectId]);

  const handleAddDropboxFile = useCallback(async (file: { name: string; path: string }) => {
    if (!activeAiProjectId || !file.path) return;
    setIndexing(true);
    try {
      const orgRes = await supabase.rpc("get_user_org_id" as any, {
        _user_id: (await supabase.auth.getUser()).data.user?.id,
      });

      const clientId = activeProject?.client_id || null;
      const projectId = activeProject?.project_id || null;

      const { data: doc, error: docErr } = await (supabase as any)
        .from("documents")
        .insert({
          organization_id: orgRes.data,
          client_id: clientId,
          project_id: projectId,
          name: file.name,
          source: "dropbox",
          external_path: file.path,
          document_type: file.name.split(".").pop()?.toUpperCase() || "FILE",
        })
        .select("id")
        .single();

      if (docErr) throw docErr;

      await addDocument.mutateAsync({
        ai_project_id: activeAiProjectId,
        document_id: doc.id,
        dropbox_path: file.path,
        name: file.name,
        source: "dropbox",
      });

      supabase.functions.invoke("process-document", {
        body: { document_id: doc.id },
      }).then(() => {
        toast.success(`${file.name} procesado correctamente`);
      }).catch((err) => {
        console.error("process-document error:", err);
      });

      toast.success(`${file.name} vinculado al proyecto`);
    } catch (e: any) {
      toast.error(e.message || "Error al vincular archivo de Dropbox");
    } finally {
      setIndexing(false);
    }
  }, [activeAiProjectId, activeProject, addDocument]);

  /** Panel lateral de conocimiento: vista detalle de artefacto en contexto de proyecto. */
  const handleViewArtifactInPanel = useCallback((id: string | null) => {
    setActiveArtifactId(id);
    if (id) setShowKnowledge(true);
  }, []);

  /** Panel lateral escritorio: chat + documento (sin modal). */
  const closeArtifactPreview = useCallback(() => {
    setArtifactPreviewOpen(false);
    setArtifactDialogOpen(false);
    setArtifactDialogArtifact(null);
    setArtifactDialogLoading(false);
  }, []);

  /** Al cambiar ancho (rotación / DevTools), sincronizar modal vs panel sin perder el artefacto. */
  useEffect(() => {
    const active = artifactDialogArtifact !== null || artifactDialogLoading;
    if (!active) return;

    if (!isMobile && artifactDialogOpen) {
      setArtifactPreviewOpen(true);
      setArtifactDialogOpen(false);
      return;
    }
    if (isMobile && artifactPreviewOpen && !artifactDialogOpen) {
      setArtifactDialogOpen(true);
      setArtifactPreviewOpen(false);
    }
  }, [
    isMobile,
    artifactDialogOpen,
    artifactPreviewOpen,
    artifactDialogArtifact,
    artifactDialogLoading,
  ]);

  /**
   * Tarjeta "Ver" en el hilo del chat: siempre abre visor (incluso sin proyecto IA o artefacto fuera de la lista filtrada).
   *
   * Flujo de resolución:
   *   1. Busca en la lista local `artifacts` (filtrada por proyecto + user_id).
   *   2. Si no está, intenta `select * from ai_artifacts where id = ?` via PostgREST.
   *   3. Si PostgREST devuelve 0 filas (posible RLS), llama a la edge `artifact-probe`
   *      que usa service-role acotado a la organización del usuario para reportar el
   *      motivo real (owner distinto, org distinta, realmente no existe) y, si es del
   *      mismo org, devuelve el artefacto para abrirlo de todos modos.
   */
  const openArtifactFromChat = useCallback(
    async (id: string) => {
      const idShort = id.slice(0, 8);
      const local = artifacts.find((a) => a.id === id);
      console.log("[openArtifactFromChat] request", {
        id,
        idShort,
        activeAiProjectId,
        foundInLocalList: !!local,
        localListSize: artifacts.length,
      });

      const prepareOpenUi = () => {
        setShowKnowledge(false);
        setActiveArtifactId(null);
      };

      /** Misma media query que `useIsMobile`; lectura síncrona al clic para no abrir modal en escritorio. */
      const compactArtifactUi = matchesMobileViewport();

      if (local) {
        prepareOpenUi();
        setArtifactDialogArtifact(local);
        setArtifactDialogLoading(false);
        if (compactArtifactUi) {
          setArtifactDialogOpen(true);
          setArtifactPreviewOpen(false);
        } else {
          setArtifactPreviewOpen(true);
          setArtifactDialogOpen(false);
        }
        return;
      }

      prepareOpenUi();
      setArtifactDialogLoading(true);
      setArtifactDialogArtifact(null);
      if (compactArtifactUi) {
        setArtifactDialogOpen(true);
        setArtifactPreviewOpen(false);
      } else {
        setArtifactPreviewOpen(true);
        setArtifactDialogOpen(false);
      }

      try {
        const { data, error } = await (supabase as any)
          .from("ai_artifacts")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error) {
          console.error("[openArtifactFromChat] postgrest error", {
            id,
            code: (error as { code?: string }).code,
            message: (error as { message?: string }).message,
            details: (error as { details?: string }).details,
            hint: (error as { hint?: string }).hint,
          });
          throw error;
        }
        if (data) {
          console.log("[openArtifactFromChat] found via direct select", { id });
          setArtifactDialogArtifact(data as AiArtifact);
          return;
        }

        console.warn("[openArtifactFromChat] direct select devolvió null; consultando artifact-probe", { id });
        const probeResp = await (supabase.functions as { invoke: (fn: string, opts: { body: unknown }) => Promise<{ data: unknown; error: unknown }> })
          .invoke("artifact-probe", { body: { id } });
        const probeData = probeResp.data as {
          reason?: string;
          exists_in_org?: boolean;
          owner_user_id?: string | null;
          ai_project_id?: string | null;
          created_at?: string | null;
          artifact?: AiArtifact | null;
        } | null;
        const probeError = probeResp.error;
        console.log("[openArtifactFromChat] probe response", { id, probeData, probeError });

        if (probeData?.artifact) {
          setArtifactDialogArtifact(probeData.artifact);
          return;
        }

        const reason = probeData?.reason || "not_found";
        const reasonLabel =
          reason === "wrong_org"
            ? "pertenece a otra organización"
            : reason === "rls_mismatch_user"
              ? "no tienes acceso (otro usuario)"
              : reason === "deleted"
                ? "fue eliminado"
                : "no existe";
        toast.error(`No se encontró el artefacto ${idShort}: ${reasonLabel}.`);
        closeArtifactPreview();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Error al cargar el artefacto";
        console.error("[openArtifactFromChat] unexpected error", { id, error: e });
        toast.error(`${msg} (id ${idShort})`);
        closeArtifactPreview();
      } finally {
        setArtifactDialogLoading(false);
      }
    },
    [artifacts, activeAiProjectId, closeArtifactPreview],
  );

  const renderMessageContent = (
    content: string,
    role: string,
    attachments?: { name: string; mime_type?: string }[],
    options?: { isError?: boolean; messageId?: string }
  ) => {
    if (role === "assistant" && options?.isError) {
      return (
        <div className="text-sm prose prose-sm max-w-none prose-p:text-destructive prose-headings:text-destructive [&_strong]:text-destructive">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      );
    }
    if (role === "user") {
      const keyP = `ai-user-${options?.messageId ?? "m"}`;
      return (
        <div className="space-y-2">
          <p className="text-sm whitespace-pre-wrap">
            {renderTextWithMentionHighlights(content, keyP, {
              mentionClassName:
                "font-bold text-primary-foreground underline decoration-primary-foreground/70 underline-offset-2",
            })}
          </p>
          {attachments && attachments.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {attachments.map((a, idx) => (
                <span
                  key={`${a.name}-${idx}`}
                  className="inline-flex items-center gap-1 text-[10px] bg-primary-foreground/15 rounded px-1.5 py-0.5"
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[140px]">{a.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }

    const COMBINED_RE = /\[artifact:([a-f0-9-]{36})\|([^\]]+)\|([^\]]+)\]|\[project:([a-f0-9-]{36})\|([^\]|]+)(?:\|([^\]]*))?\]/gi;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = COMBINED_RE.exec(content)) !== null) {
      if (match.index > lastIndex) {
        const textBefore = content.slice(lastIndex, match.index);
        parts.push(
          <div key={`text-${lastIndex}`} className="prose prose-sm max-w-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs [&_code]:bg-secondary/60 [&_code]:px-1 [&_code]:rounded">
            <ReactMarkdown>{textBefore}</ReactMarkdown>
          </div>
        );
      }

      if (match[1]) {
        // `renderStatus` lo resolvemos aquí (donde tenemos la lista `artifacts`)
        // para que la card pueda mostrar spinner "Generando…" mientras el
        // reconciliador termina el render multi-formato.
        const matchedArtifact = artifacts.find((a) => a.id === match![1]);
        parts.push(
          <ArtifactCard
            key={`artifact-${match[1]}`}
            artifactId={match[1]}
            title={match[2]}
            contentType={match[3]}
            onView={openArtifactFromChat}
            renderStatus={matchedArtifact?.render_status ?? "ready"}
          />
        );
      } else if (match[4]) {
        parts.push(
          <ProjectPreviewCard
            key={`project-${match[4]}`}
            project={{ id: match[4], name: match[5], area: match[6] || undefined }}
          />
        );
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(
        <div key={`text-${lastIndex}`} className="prose prose-sm max-w-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs [&_code]:bg-secondary/60 [&_code]:px-1 [&_code]:rounded">
          <ReactMarkdown>{content.slice(lastIndex)}</ReactMarkdown>
        </div>
      );
    }

    return parts.length > 0 ? <>{parts}</> : (
      <div className="prose prose-sm max-w-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs [&_code]:bg-secondary/60 [&_code]:px-1 [&_code]:rounded">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    );
  };

  /** JSX directo (no componente interno): un `const Fn = () => …` aquí cambiaría la identidad del tipo en cada render y desmontaría el textarea (pérdida de foco al escribir). */
  const chatMainColumn = (
          <>
          <div
            className="shrink-0 border-b border-sky-200/60 px-2.5 py-1.5 sm:px-3 sm:py-2 dark:border-sky-800/40"
            style={{ background: KAWIIL_AI_HEADER_BG }}
          >
            <div className="flex items-center gap-1.5 min-w-0 text-white">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSidebar(!showSidebar)}
                className="h-7 w-7 shrink-0 p-0 text-white/90 hover:text-white hover:bg-white/20"
                aria-label={showSidebar ? "Ocultar panel" : "Mostrar panel"}
              >
                {showSidebar ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeft className="h-3.5 w-3.5" />}
              </Button>
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white shadow-sm ring-1 ring-white/25"
                style={{ background: KAWIIL_AI_GRADIENT }}
                aria-hidden
              >
                {activeProject ? <BrainCircuit className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 flex-wrap">
                  <h1 className="text-sm sm:text-base font-bold tracking-tight text-white leading-tight drop-shadow-sm">
                    Kawiil{" "}
                    <span className="text-white/95 font-extrabold" aria-hidden>
                      AI
                    </span>
                  </h1>
                  <Badge
                    variant="outline"
                    className="h-3.5 border border-white/40 bg-white/10 px-1 text-[8px] font-bold uppercase tracking-wider text-white shadow-sm"
                  >
                    v2.4
                  </Badge>
                  {activeProject ? (
                    <span className="inline-flex max-w-[min(100%,12rem)] items-center gap-0.5 truncate rounded-full border border-white/30 bg-white/10 px-1.5 py-0 text-[9px] sm:text-[10px] text-white">
                      <BrainCircuit className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{activeProject.name}</span>
                    </span>
                  ) : (
                    <span className="rounded-full border border-white/25 bg-white/10 px-1.5 py-0 text-[9px] sm:text-[10px] text-white/95">
                      Asistente interno
                    </span>
                  )}
                </div>
                {activeConversationId && displayAgentSession && (
                  <div className="sm:hidden flex items-center justify-between gap-2 mt-1 min-w-0 max-w-full">
                    <span className="text-[10px] text-white/90 truncate min-w-0">
                      Agente: {displayAgentSession.task_ref.agent_display_name}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-6 text-[9px] px-1.5 shrink-0 bg-white/95 text-slate-800 hover:bg-white border-0 shadow-sm"
                      onClick={() => {
                        void openFollowUpWithAgent(displayAgentSession.task_ref, "continuation");
                      }}
                      disabled={isStreaming || isPreparingDelegate}
                    >
                      Continuar
                    </Button>
                  </div>
                )}
              </div>
              {activeConversationId && displayAgentSession && (
                <div className="hidden sm:flex items-center gap-1.5 shrink-0 max-w-[min(100%,14rem)] flex-wrap justify-end">
                  <span
                    className="text-[9.5px] sm:text-[10px] text-white/90 truncate max-w-[7rem] sm:max-w-[10rem] drop-shadow-sm"
                    title={displayAgentSession.task_ref.agent_display_name}
                  >
                    {displayAgentSession.task_ref.agent_display_name}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-6 text-[9px] sm:text-[9.5px] px-1.5 bg-white/95 text-slate-800 hover:bg-white border-0 shadow-sm"
                    onClick={() => {
                      void openFollowUpWithAgent(displayAgentSession.task_ref, "continuation");
                    }}
                    disabled={isStreaming || isPreparingDelegate}
                  >
                    Continuar
                  </Button>
                </div>
              )}
              {activeProject && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void openDelegateWithProjectInstructionPrefill();
                    }}
                    disabled={isStreaming || isPreparingDelegate}
                    className="h-7 shrink-0 gap-0.5 text-[9px] sm:text-[10px] px-1.5 sm:px-2 text-white/95 hover:text-white hover:bg-white/20"
                    title="Delegar; se rellenan las instrucciones del proyecto"
                  >
                    <ListChecks className="h-3 w-3 shrink-0" />
                    <span className="hidden sm:inline lg:hidden">Tarea</span>
                    <span className="hidden lg:inline">Próxima tarea</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setShowKnowledge(!showKnowledge); setActiveArtifactId(null); }}
                    className={cn(
                      "h-7 shrink-0 gap-1 text-[10px] text-white/95 hover:text-white",
                      showKnowledge
                        ? "bg-white/25 hover:bg-white/30"
                        : "hover:bg-white/20",
                    )}
                  >
                    {showKnowledge ? <PanelRightClose className="h-3 w-3" /> : <PanelRight className="h-3 w-3" />}
                    <span className="hidden sm:inline">Conocimiento</span>
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full max-w-lg mx-auto">
                <div
                  className="rounded-2xl p-4 mb-6 text-white shadow-lg shadow-blue-500/20"
                  style={{ background: KAWIIL_AI_GRADIENT }}
                >
                  {activeProject ? (
                    <BrainCircuit className="h-8 w-8" />
                  ) : (
                    <Sparkles className="h-8 w-8" />
                  )}
                </div>
                {activeProject ? (
                  <>
                    <h2 className="text-lg font-bold tracking-tight bg-clip-text text-transparent mb-1 text-center" style={{ backgroundImage: KAWIIL_AI_GRADIENT }}>{activeProject.name}</h2>
                    {activeProject.description && (
                      <p className="text-sm text-muted-foreground text-center mb-2">{activeProject.description}</p>
                    )}
                    {activeProject.instructions && (
                      <div className="text-xs text-muted-foreground bg-secondary/40 rounded-lg px-3 py-2 mb-6 max-w-sm">
                        <span className="font-medium text-foreground flex items-center gap-1 mb-1">
                          <Settings2 className="h-3 w-3" /> Instrucciones:
                        </span>
                        <p className="line-clamp-3">{activeProject.instructions}</p>
                      </div>
                    )}
                    <p className="text-sm text-muted-foreground text-center mb-6">
                      Inicia una conversacion dentro de este proyecto. La IA usara el contexto y documentos vinculados.
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="text-lg font-bold tracking-tight bg-clip-text text-transparent mb-1 text-center" style={{ backgroundImage: KAWIIL_AI_GRADIENT }}>¿En qué te puedo ayudar?</h2>
                    <p className="text-sm text-muted-foreground text-center mb-6">
                      Puedo ayudarte con redacción de correos, documentos, consultas fiscales y priorización de tareas.
                    </p>
                    {proactiveChatHint && (
                      <div className="w-full max-w-md mb-6 rounded-xl border border-blue-200/70 bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-950/30 dark:to-blue-950/20 dark:border-blue-900/40 px-4 py-3 text-left">
                        <p className="text-[11px] font-medium text-blue-700 dark:text-blue-300 mb-1 flex items-center gap-1">
                          <Sparkles className="h-3 w-3" /> Sugerencia del día
                        </p>
                        <p className="text-xs text-foreground/90 leading-relaxed">{proactiveChatHint}</p>
                      </div>
                    )}
                  </>
                )}
                <div className="grid gap-2 w-full grid-cols-1 sm:grid-cols-2">
                  {suggestionCards.map((s, si) => (
                    <button
                      key={`sg-${si}-${s.slice(0, 24)}`}
                      type="button"
                      onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                      className="group flex items-start gap-2 text-left rounded-xl border border-border/50 bg-card hover:border-blue-300/70 hover:bg-blue-50/40 dark:hover:border-blue-900/50 dark:hover:bg-blue-950/20 px-4 py-3 text-[13px] text-foreground transition-colors"
                    >
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500/70 group-hover:text-blue-600" />
                      <span className="leading-snug">{s}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-8 text-center">
                  <p className="text-xs text-muted-foreground/60">
                    {activeProject
                      ? "Las conversaciones de este proyecto tienen contexto personalizado"
                      : "Tip: Crea un Proyecto IA para dar contexto persistente a la IA"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((msg, i) => {
                  const taskRef = msg.agent_task_ref;
                  if (taskRef) {
                    const hasAgentContent = Boolean(msg.content?.trim());
                    return (
                      <Fragment key={msg.id || `task-${taskRef.task_id}-${i}`}>
                        <div className="flex gap-3 justify-start">
                          <AgentTaskCard
                            taskId={taskRef.task_id}
                            agent={{
                              display_name: taskRef.agent_display_name,
                              role: taskRef.agent_name,
                              color: taskRef.agent_color,
                            }}
                            title={taskRef.title}
                            className="flex-1 min-w-0 max-w-[85%]"
                            chatMessageId={msg.id}
                            patchMessageContent={patchMessageContent}
                            hasChatContent={hasAgentContent}
                            onFollowUpSameAgent={() => openFollowUpWithAgent(taskRef, "continuation")}
                            onRetryAgentSearch={() => openFollowUpWithAgent(taskRef, "retry")}
                            serverMessageContent={msg.content ?? ""}
                            onDeliverableLinksChange={handleAgentDeliverableLinks}
                          />
                        </div>
                        {hasAgentContent && (
                          <div className="flex gap-3 justify-start">
                            <div
                              className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 text-white shadow-sm"
                              style={{ background: KAWIIL_AI_GRADIENT }}
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                            </div>
                            <div className="flex flex-col min-w-0 max-w-[85%]">
                              <div className="rounded-2xl px-4 py-3 bg-secondary/40 border border-border/40">
                                {renderMessageContent(msg.content, "assistant", msg.attachments, {
                                  isError: msg.isError,
                                  messageId: msg.id,
                                })}
                              </div>
                              {msg.id && !msg.isError && (
                                <AiMessageFeedback messageId={msg.id} />
                              )}
                            </div>
                          </div>
                        )}
                        {(agentTaskDeliverables[taskRef.task_id] ?? []).length > 0 && (
                          <div className="flex gap-3 justify-start">
                            <div className="h-7 w-7 shrink-0" aria-hidden="true" />
                            <div className="min-w-0 max-w-[85%] flex-1">
                              <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-[11px] w-full">
                                <p className="font-medium text-foreground/80 mb-1.5">Entregables</p>
                                <ul className="space-y-1.5 list-none p-0 m-0">
                                  {(agentTaskDeliverables[taskRef.task_id] ?? []).map((d, di) => (
                                    <li key={`${d.href.slice(0, 64)}-${di}`} className="flex items-start gap-2 min-w-0">
                                      <FileText className="h-3.5 w-3.5 shrink-0 mt-0.5 opacity-70" />
                                      {/^https?:\/\//i.test(d.href) ? (
                                        <a
                                          href={d.href}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-primary hover:underline break-all"
                                        >
                                          {d.label}
                                        </a>
                                      ) : (
                                        <span className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1.5 min-w-0 w-full">
                                          <span className="text-muted-foreground break-all">{d.label}</span>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-[10px] shrink-0 w-fit -ml-1"
                                            onClick={() => {
                                              void navigator.clipboard.writeText(d.href);
                                              toast.success("Ruta copiada al portapapeles");
                                            }}
                                          >
                                            <Copy className="h-3 w-3 mr-1" />
                                            Copiar ruta
                                          </Button>
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        )}
                      </Fragment>
                    );
                  }

                  const showProgressBeforeAssistant =
                    isStreaming &&
                    msg.role === "assistant" &&
                    i === messages.length - 1 &&
                    streamProgressSteps.length > 0;
                  return (
                    <Fragment key={msg.id || `m-${i}`}>
                      {showProgressBeforeAssistant && (
                        <div className="flex gap-3 justify-start">
                          <div
                            className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 text-white shadow-sm"
                            style={{ background: KAWIIL_AI_GRADIENT }}
                          >
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          </div>
                          <ChatProcessingPanel steps={streamProgressSteps} className="flex-1 min-w-0" />
                        </div>
                      )}
                      <div
                        className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}
                      >
                        {msg.role === "assistant" && (
                          <div
                            className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 text-white shadow-sm"
                            style={{ background: KAWIIL_AI_GRADIENT }}
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                          </div>
                        )}
                        <div className="flex flex-col min-w-0 max-w-[85%]">
                          <div
                            className={cn(
                              "rounded-2xl px-4 py-3",
                              msg.role === "user"
                                ? "text-white shadow-sm shadow-sky-500/20"
                                : msg.isError
                                  ? "bg-destructive/10 border border-destructive/25 text-foreground"
                                  : "bg-secondary/40 border border-border/40"
                            )}
                            style={
                              msg.role === "user"
                                ? { background: KAWIIL_AI_GRADIENT }
                                : undefined
                            }
                          >
                            {renderMessageContent(msg.content, msg.role, msg.attachments, {
                              isError: msg.isError,
                              messageId: msg.id,
                            })}
                            {msg.role === "assistant" &&
                              msg.activityLog &&
                              msg.activityLog.length > 0 && (
                                <details className="mt-3 text-[10px] text-muted-foreground border-t border-border/40 pt-2">
                                  <summary className="cursor-pointer select-none font-medium text-foreground/70">
                                    Pasos del proceso
                                  </summary>
                                  <ol className="mt-1.5 list-decimal pl-4 space-y-0.5">
                                    {msg.activityLog.map((line, j) => (
                                      <li key={j}>{line}</li>
                                    ))}
                                  </ol>
                                </details>
                              )}
                          </div>
                          {msg.role === "assistant" && msg.id && !msg.isError && (
                            <AiMessageFeedback messageId={msg.id} />
                          )}
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
                {isStreaming &&
                  messages[messages.length - 1]?.role === "user" &&
                  (streamProgressSteps.length > 0 ? (
                    <div className="flex gap-3 justify-start">
                      <div
                        className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 text-white shadow-sm"
                        style={{ background: KAWIIL_AI_GRADIENT }}
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      </div>
                      <ChatProcessingPanel steps={streamProgressSteps} className="flex-1 min-w-0" />
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <div
                        className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 text-white shadow-sm"
                        style={{ background: KAWIIL_AI_GRADIENT }}
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      </div>
                      <div className="rounded-2xl bg-secondary/40 px-4 py-3">
                        <div className="flex gap-1">
                          <div
                            className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                            style={{ animationDelay: "0ms" }}
                          />
                          <div
                            className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                            style={{ animationDelay: "150ms" }}
                          />
                          <div
                            className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                            style={{ animationDelay: "300ms" }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <div
            className="shrink-0 sticky bottom-0 z-20 border-t border-sky-200/50 dark:border-sky-800/30"
            style={{
              background: KAWIIL_AI_SOFT_BG,
              boxShadow: "0 -8px 28px rgba(15, 23, 42, 0.07)",
            }}
          >
            {pdfIndexingStatus && (
              <div className="shrink-0 border-b border-sky-300/40 bg-sky-50/60 px-3 py-1.5 dark:border-sky-800/40 dark:bg-sky-950/30">
                <div className="max-w-3xl mx-auto flex items-center gap-1.5 text-[9px] sm:text-[10px] text-muted-foreground leading-tight">
                  <Loader2 className="h-3 w-3 animate-spin text-sky-600 dark:text-sky-400 shrink-0" />
                  <span className="min-w-0">
                    {pdfIndexingStatus.phase === "extracting"
                      ? `Leyendo «${pdfIndexingStatus.fileName}» para indexar búsqueda semántica…`
                      : (() => {
                          const s = pdfIndexingStatus;
                          const frag =
                            s.lastBatchChunks != null && s.lastBatchChunks > 0
                              ? ` · último lote: ${s.lastBatchChunks} fragmentos`
                              : "";
                          return `Indexando «${s.fileName}»: página ${s.pageDone} de ${s.totalPages}${frag}. Sigue en segundo plano; puedes chatear. La búsqueda semántica mejora al terminar.`;
                        })()}
                  </span>
                </div>
              </div>
            )}

            {displayAgentSession && (
              <div className="shrink-0 px-3 py-1.5 sm:px-4">
                <div className="max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 rounded-lg border border-sky-200/60 dark:border-sky-800/40 bg-card/80 px-2.5 py-1.5 shadow-sm">
                  <div className="flex items-start gap-1.5 min-w-0 text-[9px] sm:text-[10px] text-foreground/90 leading-tight">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400 mt-0.5" />
                    <div className="min-w-0 line-clamp-2 sm:line-clamp-none">
                      {displayAgentSession.last_interaction === "delegate" ? (
                        <p>
                          Tarea con <span className="font-semibold">{displayAgentSession.task_ref.agent_display_name}</span>
                          : sigue con el agente o vuelve al asistente; hilo y proyecto guardados.
                        </p>
                      ) : (
                        <p>
                          Asistente Kawiil ·{" "}
                          <span className="font-medium">Seguir con {displayAgentSession.task_ref.agent_display_name}</span> para
                          instrucciones al mismo agente.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 shrink-0 sm:pl-1">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="h-7 text-[10px] px-2"
                      style={{ background: KAWIIL_AI_GRADIENT }}
                      onClick={() => {
                        openFollowUpWithAgent(displayAgentSession.task_ref, "continuation");
                      }}
                      disabled={isStreaming || isPreparingDelegate}
                    >
                      <span className="truncate max-w-[10rem]">Con {displayAgentSession.task_ref.agent_display_name}</span>
                    </Button>
                    {displayAgentSession.last_interaction === "delegate" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] px-2 border-sky-200/70 dark:border-sky-800/50"
                        onClick={() => {
                          returnToKawiilAssistant();
                          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                          setTimeout(() => textareaRef.current?.focus(), 200);
                        }}
                      >
                        Al asistente
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Input */}
            <div className="px-3 py-2 sm:px-4">
              <div className="max-w-3xl mx-auto flex flex-col gap-1.5">
              <ChatAttachmentChips
                files={pendingFiles}
                disabled={isStreaming}
                onRemove={(i) => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
              />
              <div className="flex gap-2 items-end">
                <ChatAttachmentPicker
                  files={pendingFiles}
                  onChange={handlePendingFilesChange}
                  disabled={isStreaming}
                  showChips={false}
                  className="shrink-0"
                />
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleTextareaChange}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    displayAgentSession?.last_interaction === "delegate"
                      ? "Escribe al asistente Kawiil o usa «Continuar con el agente» arriba…"
                      : "Escribe tu mensaje o adjunta archivos…"
                  }
                  className="resize-none min-h-[64px] max-h-[180px] text-[13px] leading-snug bg-card border border-sky-200/50 rounded-lg flex-1 min-w-0 shadow-sm focus-visible:ring-sky-400 focus-visible:ring-offset-0 dark:border-sky-800/40"
                  rows={2}
                  disabled={isStreaming}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void openDelegateModal()}
                  disabled={isStreaming || isPreparingDelegate}
                  title="Delegar a un agente"
                  className="h-[38px] w-[38px] rounded-lg shrink-0 border-sky-200/60 dark:border-sky-800/50"
                >
                  {isPreparingDelegate ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={(!input.trim() && pendingFiles.length === 0) || isStreaming}
                  className="h-[38px] w-[38px] rounded-lg shrink-0 text-white shadow-md shadow-sky-500/30 hover:opacity-95 disabled:opacity-50 disabled:shadow-none"
                  style={{ background: KAWIIL_AI_GRADIENT }}
                >
                  {isStreaming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              </div>
              {activeAiProjectId && (
                <div className="max-w-3xl mx-auto flex items-center gap-1.5 mt-1">
                  <Checkbox
                    id="link-project-files"
                    checked={linkFilesToProject}
                    onCheckedChange={(c) => setLinkFilesToProject(!!c)}
                    disabled={isStreaming}
                    className="h-3.5 w-3.5"
                  />
                  <Label htmlFor="link-project-files" className="text-[9px] text-muted-foreground cursor-pointer font-normal leading-tight">
                    Vincular adjuntos al conocimiento del proyecto
                  </Label>
                </div>
              )}
              <details className="max-w-3xl mx-auto mt-1.5 text-left">
                <summary className="text-[8px] text-muted-foreground/90 cursor-pointer list-none text-center">
                  Límites y ayuda con adjuntos
                </summary>
                <p className="text-[8px] text-muted-foreground/80 leading-relaxed pt-1 px-0.5">
                  Hasta {MAX_CHAT_ATTACHMENT_FILES} archivos, {formatMb(MAX_CHAT_ATTACHMENT_BYTES_PER_FILE)} MB c/u,{" "}
                  {formatMb(MAX_CHAT_ATTACHMENT_BATCH_BYTES)} MB total. Los PDF se indexan en segundo plano. La IA
                  puede equivocarse.
                </p>
              </details>
            </div>
          </div>
          </>
  );

  const artifactSplitVisible =
    artifactPreviewOpen && !isMobile && (artifactDialogArtifact !== null || artifactDialogLoading);

  return (
    <>
      <div className="flex h-[calc(100vh-4rem)] min-h-0 -mt-2 items-stretch">
        {/* Left sidebar */}
        {showSidebar && (
          <ProjectSidebar
            activeProject={activeProject ?? null}
            aiProjects={aiProjects}
            activeAiProjectId={activeAiProjectId}
            activeConversationId={activeConversationId}
            filteredConversations={filteredConversations}
            onSelectProject={setAiProject}
            onNewChat={startNewChat}
            onLoadConversation={loadConversation}
            onDeleteConversation={deleteConversation}
            onRenameConversation={renameConversation}
            onMoveConversation={(id, folder) => {
              updateConversationFolder(id, folder);
              toast.success(folder ? `Movido a "${folder}"` : "Movido a conversaciones generales");
            }}
            onCreateProject={() => setShowCreateProject(true)}
            onArchiveProject={(id) => archiveAiProject.mutate(id)}
            onLeaveProject={(id) => {
              leaveAiProject.mutate(id, {
                onSuccess: () => {
                  toast.success("Saliste del proyecto compartido");
                  if (activeAiProjectId === id) setAiProject(null);
                },
                onError: (e: Error) => toast.error(e.message),
              });
            }}
            onUpdateInstructions={(id, instr) => {
              updateAiProject.mutate({ id, instructions: instr });
              toast.success("Instrucciones actualizadas");
            }}
            currentUserId={user?.id}
            onOpenMembers={activeAiProjectId ? () => setMembersDialogOpen(true) : undefined}
            streamingConversationIds={streamingConversationIds}
          />
        )}

        {/* Main chat area */}
        {!isMobile ? (
          <ResizablePanelGroup direction="horizontal" className="flex h-full min-h-0 min-w-0 flex-1" autoSaveId="asistente-artifact-split-v3">
            <ResizablePanel
              defaultSize={artifactSplitVisible ? 46 : 100}
              minSize={artifactSplitVisible ? 32 : 100}
              className="flex min-h-0 min-w-0 flex-col"
            >
              <FileDropzone
                files={pendingFiles}
                onChange={handlePendingFilesChange}
                limits={chatLimits}
                disabled={isStreaming}
                variant="overlay"
                showChips={false}
                enablePaste={false}
                hint="Suelta archivos para adjuntar al chat"
                enableFolderPicker
                className="flex h-full min-h-0 min-w-0 flex-1 flex-col border-l border-border/40"
              >
                {chatMainColumn}
              </FileDropzone>
            </ResizablePanel>
            {artifactSplitVisible ? (
              <>
                <ResizableHandle withHandle className="bg-border/70 w-2.5 shrink-0" />
                <ResizablePanel defaultSize={54} minSize={36} maxSize={78} className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border/40 bg-background shadow-sm dark:bg-background">
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 bg-muted/30 px-3 py-2">
                    <p
                      className="min-w-0 truncate text-xs font-medium"
                      title={artifactDialogArtifact?.title ?? undefined}
                    >
                      {artifactDialogLoading && !artifactDialogArtifact
                        ? "Cargando documento…"
                        : artifactDialogArtifact?.title ?? "Documento"}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 p-0"
                      onClick={closeArtifactPreview}
                      aria-label="Cerrar vista previa"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex min-h-0 min-w-0 flex-[1_1_0] basis-0 flex-col overflow-hidden">
                    {artifactDialogLoading && !artifactDialogArtifact ? (
                      <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="text-sm">Cargando…</span>
                      </div>
                    ) : artifactDialogArtifact ? (
                      <ArtifactViewer
                        key={artifactDialogArtifact.id}
                        artifact={artifactDialogArtifact}
                        onBack={closeArtifactPreview}
                        onUpdate={(id: string, content: string) => {
                          updateArtifact.mutate({ id, content });
                          setArtifactDialogArtifact((prev) =>
                            prev && prev.id === id ? { ...prev, content } : prev,
                          );
                        }}
                      />
                    ) : null}
                  </div>
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        ) : (
          <FileDropzone
            files={pendingFiles}
            onChange={handlePendingFilesChange}
            limits={chatLimits}
            disabled={isStreaming}
            variant="overlay"
            showChips={false}
            enablePaste={false}
            hint="Suelta archivos para adjuntar al chat"
            enableFolderPicker
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col border-l border-border/40"
          >
            {chatMainColumn}
          </FileDropzone>
        )}

        {/* Right knowledge panel */}
        {showKnowledge && activeProject && (
          <KnowledgePanel
            projectDocs={projectDocs}
            memories={memories}
            sharedMemories={sharedMemories}
            artifacts={artifacts}
            activeArtifactId={activeArtifactId}
            onClose={() => { setShowKnowledge(false); setActiveArtifactId(null); }}
            onRemoveDoc={(id) => removeDocument.mutate(id)}
            onDeleteMemory={(id) => deleteMemory.mutate(id)}
            onDeleteSharedMemory={(id) => deleteSharedMemory.mutate(id)}
            onDeleteArtifact={(id) => deleteArtifact.mutate(id)}
            onUpdateArtifact={(id, content) => updateArtifact.mutate({ id, content })}
            onViewArtifact={handleViewArtifactInPanel}
            onUploadFile={uploadToProject}
            uploading={uploading}
            uploadProgress={uploadProgress}
            onIndexDropbox={handleIndexDropbox}
            indexing={indexing}
            onCreateMemory={(path, content) => createMemory.mutate({ path, content })}
            onUpdateMemory={(id, content) => updateMemory.mutate({ id, content })}
            onAddDropboxFile={handleAddDropboxFile}
          />
        )}
      </div>

      <DuplicateFileResolutionDialog
        open={dupUploadOpen}
        fileName={dupUploadName}
        onResolve={onDupUploadResolve}
      />

      <DuplicateFileResolutionDialog
        open={dupChatOpen}
        fileName={dupChatName}
        onResolve={onDupChatResolve}
      />

      {/* Create AI Project Dialog */}
      <AiProjectMembersDialog
        open={membersDialogOpen}
        onOpenChange={setMembersDialogOpen}
        project={activeProject ?? null}
        members={projectMembers}
        orgUsers={orgUsers}
        currentUserId={user?.id}
        isLoading={membersLoading}
        onAddMember={async (userId, role) => {
          await addMember.mutateAsync({ userId, role });
          toast.success("Miembro invitado");
        }}
        onRemoveMember={async (memberRowId) => {
          await removeMember.mutateAsync(memberRowId);
          toast.success("Miembro eliminado");
        }}
      />

      {isMobile ? (
        <Dialog
          open={artifactDialogOpen}
          onOpenChange={(o) => {
            if (!o) closeArtifactPreview();
          }}
        >
          <DialogContent className="w-[min(98vw,1680px)] sm:w-[min(98vw,1680px)] max-w-[min(98vw,1680px)] sm:max-w-[min(98vw,1680px)] max-h-[92vh] h-[min(92vh,900px)] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-lg">
            <DialogHeader className="sr-only">
              <DialogTitle>Artefacto</DialogTitle>
            </DialogHeader>
            {artifactDialogLoading ? (
              <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">Cargando…</span>
              </div>
            ) : artifactDialogArtifact ? (
              <div className="flex min-h-0 min-w-0 flex-[1_1_0] basis-0 flex-col overflow-hidden">
                <ArtifactViewer
                  key={artifactDialogArtifact.id}
                  artifact={artifactDialogArtifact}
                  onBack={closeArtifactPreview}
                  onUpdate={(id, content) => {
                    updateArtifact.mutate({ id, content });
                    setArtifactDialogArtifact((prev) =>
                      prev && prev.id === id ? { ...prev, content } : prev,
                    );
                  }}
                />
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog open={showCreateProject} onOpenChange={setShowCreateProject}>
        <DialogContent className="sm:max-w-md overflow-hidden p-0">
          <div
            className="flex items-center gap-3 px-5 py-4 text-white"
            style={{ background: KAWIIL_AI_HEADER_BG }}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <BrainCircuit className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogHeader className="space-y-0">
                <DialogTitle className="flex items-center gap-2 text-white text-[15px] font-semibold">
                  Nuevo Proyecto de IA
                  <Badge
                    variant="outline"
                    className="h-4 border-white/40 bg-white/15 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-white"
                  >
                    v2.4
                  </Badge>
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-[11.5px] text-white/85">
                  Crea un espacio con contexto persistente: instrucciones, documentos y memorias.
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
          <div className="space-y-4 px-5 pb-2 pt-4">
            <div>
              <label className="text-xs font-medium mb-1 block">Nombre</label>
              <Input
                placeholder="Ej: Cumplimiento PLD, Declaraciones Anuales..."
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Descripción (opcional)</label>
              <Input
                placeholder="Breve descripción del propósito del proyecto"
                value={newProjectDesc}
                onChange={(e) => setNewProjectDesc(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Instrucciones para la IA (opcional)</label>
              <Textarea
                placeholder="Ej: Siempre referencia la Ley Federal de PLD. Enfocate en el marco regulatorio mexicano..."
                value={newProjectInstructions}
                onChange={(e) => setNewProjectInstructions(e.target.value)}
                rows={3}
                className="resize-none text-sm"
              />
            </div>
          </div>
          <DialogFooter className="px-5 pb-5 pt-2">
            <Button variant="outline" size="sm" onClick={() => setShowCreateProject(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="text-white shadow-sm hover:opacity-95"
              style={{ background: KAWIIL_AI_GRADIENT }}
              onClick={handleCreateAiProject}
              disabled={!newProjectName.trim() || createAiProject.isPending}
            >
              {createAiProject.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <BrainCircuit className="mr-1.5 h-3.5 w-3.5" />
              )}
              Crear proyecto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DelegateToAgentDialog
        isOpen={isDelegateModalOpen}
        onClose={() => {
          setIsDelegateModalOpen(false);
          setDelegateAttachments([]);
          setDelegateModalTitleOverride(null);
          setDelegateDefaultAgentTemplateId(null);
          setDelegatePreviousTaskId(null);
          setDelegateFollowUpKind(null);
        }}
        defaultTitle={(delegateModalTitleOverride ?? input).slice(0, 200)}
        attachments={delegateAttachments}
        conversationId={activeConversationId ?? undefined}
        defaultClientId={activeProject?.client_id ?? null}
        defaultAgentTemplateId={delegateDefaultAgentTemplateId}
        aiProjectId={activeAiProjectId}
        previousTaskId={delegatePreviousTaskId}
        followUpKind={delegateFollowUpKind}
        onDelegated={handleAgentDelegated}
        projectInstructions={activeProject?.instructions ?? null}
        projectDocuments={activeAiProjectId ? projectDocs : null}
        projectContextDefaults={activeProject ?? null}
        onStartFreshTask={handleDelegateStartFreshTask}
      />
    </>
  );
}

function AsistenteIA() {
  return (
    <AppLayout>
      <AsistenteIAContent />
    </AppLayout>
  );
}

export default AsistenteIA;
