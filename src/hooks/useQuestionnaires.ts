import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type {
  Question,
  Questionnaire,
  QuestionnaireResults,
  SurveyResponse,
} from "@/lib/questionnaires";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useQuestionnaires() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-questionnaires"],
    queryFn: async (): Promise<Questionnaire[]> => {
      const { data, error } = await db
        .from("rh_questionnaires")
        .select("*")
        .order("type", { ascending: true });
      if (error) throw error;
      return (data as Questionnaire[]) ?? [];
    },
    enabled: !!user,
  });
}

export function useQuestions(questionnaireId: string | null) {
  return useQuery({
    queryKey: ["rh-questions", questionnaireId],
    queryFn: async (): Promise<Question[]> => {
      const { data, error } = await db
        .from("rh_questions")
        .select("*")
        .eq("questionnaire_id", questionnaireId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data as Question[]) ?? [];
    },
    enabled: !!questionnaireId,
  });
}

/** ¿El usuario actual ya respondió este cuestionario? */
export function useMyResponse(questionnaireId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-my-response", questionnaireId, user?.id],
    queryFn: async (): Promise<SurveyResponse | null> => {
      const { data, error } = await db
        .from("rh_survey_responses")
        .select("*")
        .eq("questionnaire_id", questionnaireId)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as SurveyResponse) ?? null;
    },
    enabled: !!questionnaireId && !!user,
  });
}

/** Envía las respuestas (un registro por persona; confidencial). */
export function useSubmitSurvey() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      questionnaire,
      answers,
    }: {
      questionnaire: Questionnaire;
      answers: { question_id: string; value: number }[];
    }) => {
      const { data: resp, error } = await db
        .from("rh_survey_responses")
        .insert({
          organization_id: questionnaire.organization_id,
          questionnaire_id: questionnaire.id,
          user_id: user!.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      const rows = answers.map((a) => ({ response_id: resp.id, question_id: a.question_id, value: a.value }));
      const { error: ae } = await db.from("rh_survey_answers").insert(rows);
      if (ae) throw ae;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-my-response", vars.questionnaire.id] });
      qc.invalidateQueries({ queryKey: ["rh-response-count", vars.questionnaire.id] });
      toast.success("¡Gracias! Tus respuestas se guardaron de forma confidencial.");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo enviar"),
  });
}

/* ---------------- G4 ---------------- */
export function useToggleQuestionnaireActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await db.from("rh_questionnaires").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-questionnaires"] });
      toast.success("Cuestionario actualizado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar"),
  });
}

/** Cuántas personas han respondido (encabezados visibles para G4). */
export function useResponseCount(questionnaireId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["rh-response-count", questionnaireId],
    queryFn: async (): Promise<number> => {
      const { count, error } = await db
        .from("rh_survey_responses")
        .select("id", { count: "exact", head: true })
        .eq("questionnaire_id", questionnaireId);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!questionnaireId && enabled,
  });
}

/** Encabezados de respuestas de toda la org (G4): quién respondió qué. */
export function useAllResponses(enabled: boolean) {
  return useQuery({
    queryKey: ["rh-all-responses"],
    queryFn: async (): Promise<{ questionnaire_id: string; user_id: string }[]> => {
      const { data, error } = await db.from("rh_survey_responses").select("questionnaire_id, user_id");
      if (error) throw error;
      return (data as { questionnaire_id: string; user_id: string }[]) ?? [];
    },
    enabled,
  });
}

/* ---------------- Edición de cuestionarios (solo G4) ---------------- */
export function useUpdateQuestionnaire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title, description }: { id: string; title: string; description: string | null }) => {
      const { error } = await db.from("rh_questionnaires").update({ title, description }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-questionnaires"] });
      toast.success("Cuestionario actualizado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar"),
  });
}

export function useCreateQuestion() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ questionnaire, text, category, domain, reverse, position }: {
      questionnaire: Questionnaire; text: string; category: string | null; domain: string | null; reverse: boolean; position: number;
    }) => {
      const { error } = await db.from("rh_questions").insert({
        organization_id: questionnaire.organization_id,
        questionnaire_id: questionnaire.id,
        text, category, domain, reverse, position,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-questions", vars.questionnaire.id] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo agregar el ítem"),
  });
}

export function useUpdateQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; questionnaireId: string; patch: Partial<Question> }) => {
      const { error } = await db.from("rh_questions").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-questions", vars.questionnaireId] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar el ítem"),
  });
}

export function useDeleteQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; questionnaireId: string }) => {
      const { error } = await db.from("rh_questions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-questions", vars.questionnaireId] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar el ítem"),
  });
}

export function useReorderQuestions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ordered }: { questionnaireId: string; ordered: Question[] }) => {
      await Promise.all(ordered.map((q, i) => db.from("rh_questions").update({ position: i }).eq("id", q.id)));
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["rh-questions", vars.questionnaireId] }),
    onError: (e: Error) => toast.error(e.message || "No se pudo reordenar"),
  });
}

/** Resultados agregados (solo G4) vía RPC SECURITY DEFINER. */
export function useQuestionnaireResults(questionnaireId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["rh-results", questionnaireId],
    queryFn: async (): Promise<QuestionnaireResults | null> => {
      const { data, error } = await supabase.rpc("rh_questionnaire_results", { _qid: questionnaireId });
      if (error) throw error;
      return (data as QuestionnaireResults) ?? null;
    },
    enabled: !!questionnaireId && enabled,
  });
}
