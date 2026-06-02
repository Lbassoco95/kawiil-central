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
import { Loader2, Mail, StickyNote, Send, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatMX } from "@/lib/dateUtils";
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
  useLogCandidateEmail,
  useUploadCandidateCv,
  getCvSignedUrl,
} from "@/hooks/useRecruitment";
import { useSendNewEmail } from "@/hooks/useMicrosoft";

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

interface Props {
  candidate: Candidate | null;
  stages: RecruitmentStage[];
  states: RecruitmentState[];
  criteria: RecruitmentCriterion[];
  processTitle: string;
  orgName: string;
  isAdmin: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CandidateDetailDialog({ candidate, stages, states, criteria, processTitle, orgName, isAdmin, onOpenChange }: Props) {
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
            orgName={orgName}
            isAdmin={isAdmin}
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
  orgName,
  isAdmin,
}: {
  candidate: Candidate;
  stages: RecruitmentStage[];
  states: RecruitmentState[];
  criteria: RecruitmentCriterion[];
  processTitle: string;
  orgName: string;
  isAdmin: boolean;
}) {
  const { data: activities = [] } = useCandidateActivities(candidate.id);
  const { data: scores = [] } = useCandidateScores(candidate.id);
  const { data: templates = [] } = useEmailTemplates();
  const addNote = useAddCandidateNote();
  const moveStage = useMoveCandidateStage();
  const setState = useSetCandidateState();
  const setScore = useSetCandidateScore();
  const updateCandidate = useUpdateCandidate();
  const logEmail = useLogCandidateEmail();
  const uploadCv = useUploadCandidateCv();
  const sendEmail = useSendNewEmail();
  const fileRef = useRef<HTMLInputElement>(null);

  const [note, setNote] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [openingCv, setOpeningCv] = useState(false);

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
  const scoreById = new Map(scores.map((s) => [s.criterion_id, s.score]));
  const avg = weightedScore(criteria, scores);
  const sem = scoreSemaphore(avg);

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
      },
    });
  }

  async function handleSendEmail() {
    if (!candidate.email) return toast.error("El candidato no tiene correo.");
    if (!subject.trim() || !emailBody.trim()) return toast.error("Asunto y mensaje son obligatorios.");
    try {
      await sendEmail.mutateAsync({ to: [candidate.email], subject, bodyHtml: textToHtml(emailBody) });
      await logEmail.mutateAsync({ candidate, subject });
      setEmailOpen(false);
      setSubject("");
      setEmailBody("");
    } catch {
      /* el hook ya muestra el error */
    }
  }

  async function handleViewCv() {
    if (!candidate.resume_url) return;
    setOpeningCv(true);
    const url = await getCvSignedUrl(candidate.resume_url);
    setOpeningCv(false);
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("No se pudo abrir el CV.");
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
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
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="perfil">Perfil</TabsTrigger>
          <TabsTrigger value="eval">Evaluación</TabsTrigger>
          <TabsTrigger value="track">Seguimiento</TabsTrigger>
        </TabsList>

        {/* ---------------- PERFIL ---------------- */}
        <TabsContent value="perfil" className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-2 text-sm">
            {candidate.email && <div className="text-muted-foreground">📧 {candidate.email}</div>}
            {candidate.phone && <div className="text-muted-foreground">📞 {candidate.phone}</div>}
            {candidate.source && <div className="text-muted-foreground">🔗 {candidate.source}</div>}
          </div>

          {/* CV */}
          <div className="flex items-center gap-2">
            {candidate.resume_url ? (
              <Button size="sm" variant="outline" onClick={handleViewCv} disabled={openingCv}>
                {openingCv ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1.5 h-3.5 w-3.5" />}
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
              </>
            )}
          </div>

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

          <div className="flex justify-end">
            <Button size="sm" onClick={saveProfile} disabled={updateCandidate.isPending}>
              {updateCandidate.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Guardar ficha
            </Button>
          </div>
          </>
          ) : (
            <ProfileReadOnly candidate={candidate} />
          )}
        </TabsContent>

        {/* ---------------- EVALUACIÓN ---------------- */}
        <TabsContent value="eval" className="space-y-3 pt-2">
          {criteria.length === 0 ? (
            <p className="text-sm text-muted-foreground">Configura la rúbrica desde el botón “Rúbrica” del tablero.</p>
          ) : (
            <>
              {criteria.map((c) => {
                const val = scoreById.get(c.id);
                return (
                  <div key={c.id} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{c.name}</span>
                      <Badge variant="secondary" className="text-[10px]">peso {Number(c.weight)}</Badge>
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
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                <span className="text-sm font-medium">Calificación final</span>
                {avg == null ? (
                  <span className="text-sm text-muted-foreground">Sin calificar</span>
                ) : (
                  <span className={cn("flex items-center gap-1.5 text-sm font-semibold", SEMAPHORE_TEXT[sem])}>
                    <span className={cn("h-2.5 w-2.5 rounded-full", SEMAPHORE_DOT[sem])} />
                    {avg.toFixed(1)} / 5
                  </span>
                )}
              </div>
            </>
          )}
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
                  Enviar desde mi Outlook
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
