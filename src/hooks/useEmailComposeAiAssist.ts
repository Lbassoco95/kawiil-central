import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  plainTextToEmailHtml,
  type ImproveMode,
} from "@/components/microsoft/emailComposeAiShared";
import type { RichTextEditorHandle } from "@/components/microsoft/RichTextEditor";

export type UseEmailComposeAiAssistParams = {
  open: boolean;
  subject: string;
  /** Etiqueta para contexto (p. ej. destinatarios o "(respuesta)") */
  toLabel: string;
  /** Extracto del hilo para enriquecer el borrador IA */
  threadContext?: string;
  getBodyHtml: () => string;
  setBodyHtml: (html: string) => void;
  editorRef: RefObject<RichTextEditorHandle | null>;
};

export function useEmailComposeAiAssist({
  open,
  subject,
  toLabel,
  threadContext,
  getBodyHtml,
  setBodyHtml,
  editorRef,
}: UseEmailComposeAiAssistParams) {
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [hasAiDraft, setHasAiDraft] = useState(false);
  const [improveBusy, setImproveBusy] = useState<ImproveMode | null>(null);
  const lastInstructionRef = useRef("");

  useEffect(() => {
    if (open) return;
    setAiPanelOpen(false);
    setAiInstruction("");
    setAiLoading(false);
    setHasAiDraft(false);
    setImproveBusy(null);
    lastInstructionRef.current = "";
  }, [open]);

  const runAiDraft = useCallback(
    async (instruction: string) => {
      const trimmed = instruction.trim();
      if (!trimmed) {
        toast.error("Escribe qué quieres que redacte la IA");
        return;
      }
      setAiLoading(true);
      try {
        const thread = threadContext?.trim();
        const instructionForModel =
          thread && thread.length > 0
            ? `${trimmed}\n\n---\nContexto del hilo que respondes (no cites literalmente salvo que se pida):\n${thread.slice(0, 2200)}`
            : trimmed;

        const { data, error } = await supabase.functions.invoke("ai-email-draft", {
          body: {
            action: "draft",
            instruction: instructionForModel,
            context: {
              subject: subject.trim() || "(sin asunto)",
              to: toLabel.trim() || "(no indicado)",
            },
            tone: "formal",
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(typeof data.message === "string" ? data.message : data.error);
        const text = data?.text ?? "";
        if (!text) throw new Error("La IA no devolvió texto");
        lastInstructionRef.current = trimmed;
        const html = plainTextToEmailHtml(text);
        const existing = (getBodyHtml() || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (existing.length > 0 && !window.confirm("Ya tienes contenido escrito. ¿Reemplazarlo con el borrador de la IA?")) {
          return;
        }
        editorRef.current?.setHtml(html);
        setBodyHtml(html);
        setHasAiDraft(true);
        toast.success("Borrador generado");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al generar borrador");
      } finally {
        setAiLoading(false);
      }
    },
    [subject, toLabel, threadContext, setBodyHtml, getBodyHtml, editorRef],
  );

  const runImproveBody = useCallback(
    async (mode: ImproveMode) => {
      const currentHtml = (getBodyHtml() || "").trim();
      if (!currentHtml) {
        toast.error("Escribe primero un borrador o genera uno con IA");
        return;
      }
      setImproveBusy(mode);
      try {
        const { data, error } = await supabase.functions.invoke<{
          improvedHtml?: string;
          error?: string;
          message?: string;
        }>("email-ai-improve", {
          body: {
            bodyHtml: currentHtml,
            mode,
            subject: subject.trim(),
            to: toLabel.trim(),
            locale: "es",
          },
        });
        if (error) throw new Error(error.message || "Error AI");
        if (!data || data.error) {
          throw new Error(data?.message || data?.error || "Sin sugerencia");
        }
        const next = (data.improvedHtml || "").trim();
        if (!next) throw new Error("La IA no devolvió HTML");
        editorRef.current?.setHtml(next);
        setBodyHtml(next);
        setHasAiDraft(true);
        toast.success(
          mode === "shorter"
            ? "Versión más corta lista"
            : mode === "formal"
              ? "Versión más formal lista"
              : mode === "friendly"
                ? "Versión más amigable lista"
                : "Borrador mejorado",
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error mejorando con IA");
      } finally {
        setImproveBusy(null);
      }
    },
    [getBodyHtml, setBodyHtml, subject, toLabel, editorRef],
  );

  return {
    aiPanelOpen,
    setAiPanelOpen,
    aiInstruction,
    setAiInstruction,
    aiLoading,
    hasAiDraft,
    setHasAiDraft,
    improveBusy,
    lastInstructionRef,
    runAiDraft,
    runImproveBody,
  };
}
