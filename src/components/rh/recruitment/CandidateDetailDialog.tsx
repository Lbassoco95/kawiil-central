import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Mail, StickyNote, Send, FileText, Upload, UserCheck, Trash2, Sparkles, CheckCircle2, AlertTriangle, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatMX } from "@/lib/dateUtils";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";
import { HireCandidateDialog } from "./HireCandidateDialog";
import { CandidateAttachments } from "./CandidateAttachments";
import { DocumentPreviewDialog, type PreviewTarget } from "./DocumentPreviewDialog";
import {
  ACTIVITY_LABEL,
  EDUCATION_STATUSES,
  EDUCATION_STATUS_LABEL,
  STATE_COLOR_STYLE,
  SEMAPHORE_DOT,
  SEMAPHORE_TEXT,
  renderTemplate,
  scoreSemaphore,
  weightedScore,
  panelWeightedScore,
  scoreAveragesByCriterion,
  distinctEvaluators,
  type Candidate,
  type EducationStatus,
  type RecruitmentCriterion,
  type RecruitmentStage,
  type RecruitmentState,
} from "@/lib/recruitment";
import {
  useCandidateActivities,
  useCandidateScores,
  useEmailTemplates,
  useAddCandidateNote,
  useMoveCandidateStage,
  useSetCandidateState,
  useSetCandidateScore,
  useUpdateCandidate,
  useDeleteCandidate,
  useSendCandidateEmail,
  useUploadCandidateCv,
  useUploadCandidateExam,
  useAnalyzeCandidateFit,
  useExtractCvData,
  useUploadCandidatePhoto,
  useExtractCvPhoto,
  useCandidatePhotoUrls,
} from "@/hooks/useRecruitment";
import { renderCvFirstPageToBase64 } from "@/lib/cvImage";
import { UserAvatar } from "@/components/shared/UserAvatar";

interface Props {
  candidate: Candidate | null;
  stages: RecruitmentStage[];
  states: RecruitmentState[];
  criteria: RecruitmentCriterion[];
  processTitle: string;
  processGrade?: string | null;
  orgName: string;
  isAdmin: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CandidateDetailDialog({ candidate, stages, states, criteria, processTitle, processGrade, orgName, isAdmin, onOpenChange }: Props) {
  const open = !!candidate;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {candidate && (
          <CandidateDetailInner
            key={candidate.id}
            candidate={candidate}
            stages={stages}
            states={states}
            criteria={criteria}
            processTitle={processTitle}
            processGrade={processGrade}
            orgName={orgName}
            isAdmin={isAdmin}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CandidateDetailInner({
  candidate,
  stages,
  states,
  criteria,
  processTitle,
  processGrade,
  orgName,
  isAdmin,
  onClose,
}: {
  candidate: Candidate;
  stages: RecruitmentStage[];
  states: RecruitmentState[];
  criteria: RecruitmentCriterion[];
  processTitle: string;
  processGrade?: string | null;
  orgName: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { data: activities = [] } = useCandidateActivities(candidate.id);
  const { data: scores = [] } = useCandidateScores(candidate.id);
  const { data: templates = [] } = useEmailTemplates();
  const { isTransformador } = useUserRole();
  const { user } = useAuth();
  const del = useDeleteCandidate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const addNote = useAddCandidateNote();
  const moveStage = useMoveCandidateStage();
  const setState = useSetCandidateState();
  const setScore = useSetCandidateScore();
  const updateCandidate = useUpdateCandidate();
  const uploadCv = useUploadCandidateCv();
  const uploadExam = useUploadCandidateExam();
  const analyzeFit = useAnalyzeCandidateFit();
  const extractCv = useExtractCvData();
  const uploadPhoto = useUploadCandidatePhoto();
  const extractPhoto = useExtractCvPhoto();
  const { data: photoMap = {} } = useCandidatePhotoUrls([candidate]);
  const photoUrl = candidate.photo_url ? photoMap[candidate.photo_url] ?? null : null;
  const sendEmail = useSendCandidateEmail();
  const fileRef = useRef<HTMLInputElement>(null);
  const examRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const [note, setNote] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [hireOpen, setHireOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  // Borrador editable de la ficha (se inicializa una vez por candidato).
  const [form, setForm] = useState({
    university: candidate.university ?? "",
    degree: candidate.degree ?? "",
    education_status: candidate.education_status ?? "",
    skills: (candidate.skills ?? []).join(", "),
    years_experience: candidate.years_experience?.toString() ?? "",
    salary_expectation: candidate.salary_expectation?.toString() ?? "",
    available_from: candidate.available_from ?? "",
    linkedin_url: candidate.linkedin_url ?? "",
    portfolio_url: candidate.portfolio_url ?? "",
    assessment_url: candidate.assessment_url ?? "",
  });

  const currentState = states.find((s) => s.id === candidate.state_id);
  const currentStageName = stages.find((s) => s.id === candidate.stage_id)?.name ?? "";
  const templateVars: Record<string, string> = {
    nombre: candidate.full_name.split(" ")[0],
    nombre_completo: candidate.full_name,
    vacante: processTitle,
    empresa: orgName,
    fase: currentStageName,
    correo: candidate.email ?? "",
  };
  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(renderTemplate(t.subject, templateVars));
    setEmailBody(renderTemplate(t.body, templateVars));
  }
  // Evaluación por entrevistador: "mi" rúbrica vs. consolidado del panel.
  const myScores = scores.filter((s) => s.scored_by === user?.id);
  const myScoreById = new Map(myScores.map((s) => [s.criterion_id, s.score]));
  const panelAvgById = scoreAveragesByCriterion(scores);
  const myAvg = weightedScore(criteria, myScores);
  const avg = panelWeightedScore(criteria, scores); // consolidado (encabezado)
  const sem = scoreSemaphore(avg);
  const mySem = scoreSemaphore(myAvg);
  const evaluators = distinctEvaluators(scores);

  function saveProfile() {
    updateCandidate.mutate({
      candidate,
      patch: {
        university: form.university.trim() || null,
        degree: form.degree.trim() || null,
        education_status: (form.education_status || null) as EducationStatus | null,
        skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
        years_experience: form.years_experience ? Number(form.years_experience) : null,
        salary_expectation: form.salary_expectation ? Number(form.salary_expectation) : null,
        available_from: form.available_from || null,
        linkedin_url: form.linkedin_url.trim() || null,
        portfolio_url: form.portfolio_url.trim() || null,
        assessment_url: form.assessment_url.trim() || null,
      },
    });
  }

  async function handlePrefillFromCv() {
    try {
      const d = await extractCv.mutateAsync({ candidate });
      let filled = 0;
      const keep = (cur: string, next: string | null) => {
        if (cur.trim() || !next) return cur;
        filled++;
        return next;
      };
      setForm((f) => ({
        ...f,
        university: keep(f.university, d.university),
        degree: keep(f.degree, d.degree),
        education_status: f.education_status || (d.education_status ?? ""),
        years_experience: keep(f.years_experience, d.years_experience != null ? String(d.years_experience) : null),
        salary_expectation: keep(f.salary_expectation, d.salary_expectation != null ? String(d.salary_expectation) : null),
        available_from: keep(f.available_from, d.available_from),
        skills: keep(f.skills, d.skills.length ? d.skills.join(", ") : null),
        linkedin_url: keep(f.linkedin_url, d.linkedin_url),
        portfolio_url: keep(f.portfolio_url, d.portfolio_url),
      }));
      if (d.education_status && !form.education_status) filled++;
      toast.success(
        filled > 0
          ? `Se prellenaron ${filled} campo(s) desde el CV. Revisa y guarda la ficha.`
          : "El CV no aportó campos nuevos (los que tiene ya estaban capturados).",
      );
    } catch {
      /* el hook ya muestra el error */
    }
  }

  async function handlePhotoFromCv() {
    if (!candidate.resume_url) return;
    setPhotoBusy(true);
    try {
      const img = await renderCvFirstPageToBase64(candidate.resume_url);
      if (!img?.base64) {
        toast.error("No se pudo leer el CV para extraer la foto.");
        return;
      }
      await extractPhoto.mutateAsync({ candidate, imageBase64: img.base64, mime: img.mime });
    } catch {
      /* el hook ya muestra el error */
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleSendEmail() {
    if (!candidate.email) return toast.error("El candidato no tiene correo.");
    if (!subject.trim() || !emailBody.trim()) return toast.error("Asunto y mensaje son obligatorios.");
    try {
      // Envía desde rh@kawiil.mx (Resend) y registra en la bitácora en el backend.
      await sendEmail.mutateAsync({ candidate, subject, body: emailBody });
      setEmailOpen(false);
      setSubject("");
      setEmailBody("");
    } catch {
      /* el hook ya muestra el error */
    }
  }

  const baseName = (path: string, fallback: string) => path.split("/").pop() || fallback;

  function handleViewCv() {
    if (!candidate.resume_url) return;
    setPreview({ path: candidate.resume_url, name: baseName(candidate.resume_url, "CV.pdf") });
  }

  function handleViewExam() {
    if (!candidate.assessment_file_path) return;
    setPreview({ path: candidate.assessment_file_path, name: baseName(candidate.assessment_file_path, "Examen.pdf") });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <UserAvatar name={candidate.full_name} avatarUrl={photoUrl} size="md" />
          {candidate.full_name}
          {currentState && (
            <Badge variant="outline" className={cn(STATE_COLOR_STYLE[currentState.color] ?? STATE_COLOR_STYLE.slate)}>
              {currentState.name}
            </Badge>
          )}
          {avg != null && (
            <span className={cn("flex items-center gap-1 text-xs font-medium", SEMAPHORE_TEXT[sem])}>
              <span className={cn("h-2 w-2 rounded-full", SEMAPHORE_DOT[sem])} />
              {avg.toFixed(1)}/5
            </span>
          )}
        </DialogTitle>
      </DialogHeader>

      <Tabs defaultValue="perfil" className="mt-1">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="perfil">Perfil</TabsTrigger>
          <TabsTrigger value="eval">Evaluación</TabsTrigger>
          <TabsTrigger value="ai">Fit IA</TabsTrigger>
          <TabsTrigger value="track">Seguimiento</TabsTrigger>
        </TabsList>

        {/* ---------------- PERFIL ---------------- */}
        <TabsContent value="perfil" className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-2 text-sm">
            {candidate.email && <div className="text-muted-foreground">📧 {candidate.email}</div>}
            {candidate.phone && <div className="text-muted-foreground">📞 {candidate.phone}</div>}
            {candidate.source && <div className="text-muted-foreground">🔗 {candidate.source}</div>}
          </div>

          {/* Contratación / onboarding (solo G4) */}
          {isTransformador && (
            candidate.hired_user_id ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                <UserCheck className="h-4 w-4" /> Contratado · ya es colaborador
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setHireOpen(true)}>
                <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                {candidate.status === "hired" ? "Iniciar onboarding (crear cuenta)" : "Contratar e iniciar onboarding"}
              </Button>
            )
          )}

          {/* CV */}
          <div className="flex items-center gap-2">
            {candidate.resume_url ? (
              <Button size="sm" variant="outline" onClick={handleViewCv}>
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                Ver CV
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">Sin CV cargado</span>
            )}
            {isAdmin && (
              <>
                <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploadCv.isPending}>
                  {uploadCv.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                  {candidate.resume_url ? "Reemplazar" : "Subir CV"}
                </Button>
                <input
                  ref={fileRef} type="file" accept=".pdf,.doc,.docx,application/pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCv.mutate({ candidate, file: f }); e.target.value = ""; }}
                />
                {candidate.resume_url && (
                  <Button size="sm" variant="ghost" onClick={handlePrefillFromCv} disabled={extractCv.isPending}
                    title="Lee el CV con IA y prellena los campos vacíos de la ficha">
                    {extractCv.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                    Prellenar desde CV
                  </Button>
                )}
              </>
            )}
          </div>

          {/* Foto del candidato */}
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Foto:</span>
              <Button size="sm" variant="ghost" onClick={() => photoRef.current?.click()} disabled={uploadPhoto.isPending}>
                {uploadPhoto.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                {candidate.photo_url ? "Cambiar foto" : "Subir foto"}
              </Button>
              <input
                ref={photoRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto.mutate({ candidate, file: f }); e.target.value = ""; }}
              />
              {candidate.resume_url && (
                <Button size="sm" variant="ghost" onClick={handlePhotoFromCv} disabled={photoBusy || extractPhoto.isPending}
                  title="Detecta y recorta la foto del CV con IA">
                  {photoBusy || extractPhoto.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                  Traer foto del CV
                </Button>
              )}
            </div>
          )}

          {/* Fase y estado */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fase</Label>
              <Select
                value={candidate.stage_id ?? ""}
                disabled={!isAdmin}
                onValueChange={(stageId) => { const st = stages.find((s) => s.id === stageId); if (st) moveStage.mutate({ candidate, stageId, stageName: st.name }); }}
              >
                <SelectTrigger><SelectValue placeholder="Sin fase" /></SelectTrigger>
                <SelectContent>{stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select
                value={candidate.state_id ?? ""}
                disabled={!isAdmin}
                onValueChange={(stateId) => { const st = states.find((s) => s.id === stateId); if (st) setState.mutate({ candidate, stateId, stateName: st.name }); }}
              >
                <SelectTrigger><SelectValue placeholder="Sin estado" /></SelectTrigger>
                <SelectContent>{states.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {isAdmin ? (
          <>
          {/* Datos académicos / experiencia (editables) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Universidad</Label>
              <Input value={form.university} onChange={(e) => setForm((f) => ({ ...f, university: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Carrera</Label>
              <Input value={form.degree} onChange={(e) => setForm((f) => ({ ...f, degree: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Titulación</Label>
              <Select value={form.education_status || "none"} onValueChange={(v) => setForm((f) => ({ ...f, education_status: v === "none" ? "" : v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin especificar</SelectItem>
                  {EDUCATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{EDUCATION_STATUS_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Años de experiencia</Label>
              <Input type="number" min={0} step={0.5} value={form.years_experience} onChange={(e) => setForm((f) => ({ ...f, years_experience: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Pretensión ($/mes)</Label>
              <Input type="number" min={0} value={form.salary_expectation} onChange={(e) => setForm((f) => ({ ...f, salary_expectation: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Disponible desde</Label>
              <Input type="date" value={form.available_from} onChange={(e) => setForm((f) => ({ ...f, available_from: e.target.value }))} className="h-8 text-sm" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Software que domina</Label>
            <Input value={form.skills} onChange={(e) => setForm((f) => ({ ...f, skills: e.target.value }))} placeholder="Excel, CONTPAQi, SAT…" className="h-8 text-sm" />
            <p className="text-[10px] text-muted-foreground">Separa con comas.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>LinkedIn</Label>
              <Input value={form.linkedin_url} onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Portafolio</Label>
              <Input value={form.portfolio_url} onChange={(e) => setForm((f) => ({ ...f, portfolio_url: e.target.value }))} className="h-8 text-sm" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Examen / psicométrico</Label>
            <Input value={form.assessment_url} onChange={(e) => setForm((f) => ({ ...f, assessment_url: e.target.value }))} placeholder="Liga (Tally, TypeForm, Psicotest…)" className="h-8 text-sm" />
            <div className="flex flex-wrap items-center gap-2">
              {candidate.assessment_url && (
                <a href={candidate.assessment_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
                  Abrir liga
                </a>
              )}
              {candidate.assessment_file_path && (
                <Button size="sm" variant="outline" onClick={handleViewExam}>
                  <FileText className="mr-1.5 h-3.5 w-3.5" /> Ver examen (PDF)
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => examRef.current?.click()} disabled={uploadExam.isPending}>
                {uploadExam.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                {candidate.assessment_file_path ? "Reemplazar PDF" : "Subir PDF del examen"}
              </Button>
              <input
                ref={examRef} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadExam.mutate({ candidate, file: f }); e.target.value = ""; }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">La calificación va en la pestaña Evaluación (rúbrica).</p>
          </div>

          <CandidateAttachments candidate={candidate} isAdmin={isAdmin} />

          <div className="flex items-center justify-between gap-2">
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-red-600">¿Eliminar?</span>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={del.isPending}
                  onClick={() => del.mutate({ candidate }, { onSuccess: () => { setConfirmDelete(false); onClose(); } })}
                >
                  {del.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Sí, eliminar
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-600" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Eliminar candidato
              </Button>
            )}
            <Button size="sm" onClick={saveProfile} disabled={updateCandidate.isPending}>
              {updateCandidate.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Guardar ficha
            </Button>
          </div>
          </>
          ) : (
            <>
              <ProfileReadOnly candidate={candidate} />
              <CandidateAttachments candidate={candidate} isAdmin={false} />
            </>
          )}
        </TabsContent>

        {/* ---------------- EVALUACIÓN ---------------- */}
        <TabsContent value="eval" className="space-y-3 pt-2">
          {criteria.length === 0 ? (
            <p className="text-sm text-muted-foreground">Configura la rúbrica desde el botón “Rúbrica” del tablero.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Tu evaluación es individual. Abajo se muestra el promedio del panel
                {evaluators > 0 ? ` (${evaluators} ${evaluators === 1 ? "evaluador" : "evaluadores"})` : ""}.
              </p>
              {criteria.map((c) => {
                const val = myScoreById.get(c.id);
                const panel = panelAvgById.get(c.id);
                return (
                  <div key={c.id} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{c.name}</span>
                      <div className="flex items-center gap-2">
                        {panel && (
                          <Badge variant="outline" className="text-[10px]" title={`Promedio de ${panel.count} evaluador(es)`}>
                            panel {panel.avg.toFixed(1)} · {panel.count}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px]">peso {Number(c.weight)}</Badge>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setScore.mutate({ candidate, criterionId: c.id, score: n })}
                          className={cn(
                            "h-8 flex-1 rounded-md border text-sm transition-colors",
                            val === n ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                          )}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Mi calificación</span>
                  {myAvg == null ? (
                    <span className="text-sm text-muted-foreground">Sin calificar</span>
                  ) : (
                    <span className={cn("flex items-center gap-1.5 text-sm font-semibold", SEMAPHORE_TEXT[mySem])}>
                      <span className={cn("h-2.5 w-2.5 rounded-full", SEMAPHORE_DOT[mySem])} />
                      {myAvg.toFixed(1)} / 5
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between border-t pt-2">
                  <span className="text-sm font-medium">
                    Consolidado del panel
                    {evaluators > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({evaluators})</span>}
                  </span>
                  {avg == null ? (
                    <span className="text-sm text-muted-foreground">Sin calificar</span>
                  ) : (
                    <span className={cn("flex items-center gap-1.5 text-sm font-semibold", SEMAPHORE_TEXT[sem])}>
                      <span className={cn("h-2.5 w-2.5 rounded-full", SEMAPHORE_DOT[sem])} />
                      {avg.toFixed(1)} / 5
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ---------------- FIT IA ---------------- */}
        <TabsContent value="ai" className="space-y-3 pt-2">
          {(() => {
            const ai = candidate.ai_analysis;
            const score = candidate.ai_fit_score;
            const scoreColor =
              score == null ? "text-muted-foreground"
                : score >= 70 ? "text-emerald-600"
                : score >= 40 ? "text-amber-600"
                : "text-red-600";
            const canAnalyze = !!candidate.assessment_file_path || !!candidate.resume_url;
            const analyzeSource = candidate.assessment_file_path && candidate.resume_url
              ? "examen + CV"
              : candidate.assessment_file_path ? "examen" : "CV";
            return (
              <>
                <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">Fit con Kawiil</p>
                    {candidate.ai_analyzed_at && (
                      <p className="text-[10px] text-muted-foreground">
                        Analizado {formatMX(candidate.ai_analyzed_at, "d MMM yyyy, HH:mm")}
                        {ai?.used_manuals ? " · con manuales" : ""}
                      </p>
                    )}
                  </div>
                  <span className={cn("text-2xl font-bold tabular-nums", scoreColor)}>
                    {score != null ? `${score}` : "—"}
                    <span className="text-sm font-normal text-muted-foreground">/100</span>
                  </span>
                </div>

                {!canAnalyze ? (
                  <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    Sube el <b>CV</b> o el PDF del <b>examen / psicométrico</b> en la pestaña <b>Perfil</b> para poder analizar.
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    Se analizará con: <b>{analyzeSource}</b>.
                  </p>
                )}

                <Button
                  size="sm"
                  className="w-full"
                  disabled={!canAnalyze || analyzeFit.isPending}
                  onClick={() => analyzeFit.mutate({ candidate })}
                >
                  {analyzeFit.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                  {ai ? "Volver a analizar con IA" : "Analizar con IA"}
                </Button>

                {ai && (
                  <div className="space-y-3">
                    {ai.summary && <p className="text-sm text-muted-foreground">{ai.summary}</p>}

                    {ai.strengths?.length > 0 && (
                      <div className="space-y-1">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Fortalezas</p>
                        <ul className="space-y-1 pl-1 text-sm">
                          {ai.strengths.map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-emerald-600">·</span><span>{s}</span></li>)}
                        </ul>
                      </div>
                    )}

                    {ai.risks?.length > 0 && (
                      <div className="space-y-1">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> Riesgos / a explorar</p>
                        <ul className="space-y-1 pl-1 text-sm">
                          {ai.risks.map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-amber-600">·</span><span>{s}</span></li>)}
                        </ul>
                      </div>
                    )}

                    {ai.interview_questions?.length > 0 && (
                      <div className="space-y-1">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-sky-700"><HelpCircle className="h-3.5 w-3.5" /> Preguntas para entrevista</p>
                        <ul className="space-y-1 pl-1 text-sm">
                          {ai.interview_questions.map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-sky-600">·</span><span>{s}</span></li>)}
                        </ul>
                      </div>
                    )}

                    {ai.suggested_rubric_scores?.length > 0 && criteria.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold">Puntajes sugeridos para la rúbrica</p>
                        {ai.suggested_rubric_scores.map((sug, i) => {
                          const crit = criteria.find((c) => c.id === sug.criterion_id);
                          if (!crit) return null;
                          const applied = myScoreById.get(crit.id) === sug.score;
                          return (
                            <div key={i} className="rounded-md border px-2.5 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium">{crit.name}</span>
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary" className="text-[10px]">sugerido {sug.score}/5</Badge>
                                  <Button
                                    size="sm"
                                    variant={applied ? "secondary" : "outline"}
                                    className="h-7 px-2 text-xs"
                                    disabled={applied || setScore.isPending}
                                    onClick={() => setScore.mutate({ candidate, criterionId: crit.id, score: sug.score })}
                                  >
                                    {applied ? "Aplicado" : "Aplicar"}
                                  </Button>
                                </div>
                              </div>
                              {sug.rationale && <p className="mt-1 text-xs text-muted-foreground">{sug.rationale}</p>}
                            </div>
                          );
                        })}
                        <p className="text-[10px] text-muted-foreground">Sugerencias de IA — confirma cada puntaje; quedan registrados en la pestaña Evaluación.</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </TabsContent>

        {/* ---------------- SEGUIMIENTO ---------------- */}
        <TabsContent value="track" className="space-y-4 pt-2">
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEmailOpen((v) => !v)} disabled={!candidate.email}>
                <Mail className="mr-1.5 h-3.5 w-3.5" /> Enviar correo
              </Button>
            </div>
          )}

          {isAdmin && emailOpen && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              {templates.length > 0 && (
                <Select onValueChange={applyTemplate}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Usar plantilla…" /></SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto" className="h-8 text-sm" />
              <Textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder={`Hola ${candidate.full_name.split(" ")[0]},`} rows={5} className="text-sm" />
              <div className="flex justify-end">
                <Button size="sm" onClick={handleSendEmail} disabled={sendEmail.isPending}>
                  {sendEmail.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                  Enviar desde rh@kawiil.mx
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label className="flex items-center gap-1.5"><StickyNote className="h-3.5 w-3.5" /> Nota</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Agregar nota al seguimiento" className="h-8 text-sm" />
            </div>
            <Button size="sm" disabled={!note.trim() || addNote.isPending}
              onClick={() => addNote.mutate({ candidate, note: note.trim() }, { onSuccess: () => setNote("") })}>
              Agregar
            </Button>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Actividad</p>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin actividad todavía.</p>
            ) : (
              <ul className="space-y-2">
                {activities.map((a) => (
                  <li key={a.id} className="rounded-md border p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="text-[10px]">{ACTIVITY_LABEL[a.activity_type]}</Badge>
                      <span className="text-muted-foreground">{formatMX(a.created_at, "dd MMM HH:mm")}</span>
                    </div>
                    {a.content && <p className="mt-1">{a.content}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <HireCandidateDialog candidate={candidate} states={states} defaultGrade={processGrade} open={hireOpen} onOpenChange={setHireOpen} />
      <DocumentPreviewDialog target={preview} open={!!preview} onOpenChange={(o) => !o && setPreview(null)} />
    </>
  );
}

/** Resumen de la ficha en solo lectura (entrevistadores). */
function ProfileReadOnly({ candidate }: { candidate: Candidate }) {
  const rows: { label: string; value: string | null }[] = [
    { label: "Universidad", value: candidate.university },
    { label: "Carrera", value: candidate.degree },
    { label: "Titulación", value: candidate.education_status ? EDUCATION_STATUS_LABEL[candidate.education_status] : null },
    { label: "Años de experiencia", value: candidate.years_experience != null ? String(candidate.years_experience) : null },
    { label: "Pretensión", value: candidate.salary_expectation != null ? `$${candidate.salary_expectation.toLocaleString("es-MX")}` : null },
    { label: "Disponible desde", value: candidate.available_from },
    { label: "Software", value: candidate.skills?.length ? candidate.skills.join(", ") : null },
    { label: "LinkedIn", value: candidate.linkedin_url },
    { label: "Portafolio", value: candidate.portfolio_url },
    { label: "Examen / psicométrico", value: candidate.assessment_url },
  ].filter((r) => r.value);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos adicionales en la ficha.</p>;
  }
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="space-y-0.5">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{r.label}</dt>
          <dd className="break-words">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
