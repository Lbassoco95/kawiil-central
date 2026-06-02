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
  STATE_COLOR_STYLE,
  type Candidate,
  type RecruitmentStage,
  type RecruitmentState,
} from "@/lib/recruitment";
import {
  useCandidateActivities,
  useAddCandidateNote,
  useMoveCandidateStage,
  useSetCandidateState,
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
  onOpenChange: (v: boolean) => void;
}

export function CandidateDetailDialog({ candidate, stages, states, onOpenChange }: Props) {
  const open = !!candidate;
  const { data: activities = [] } = useCandidateActivities(candidate?.id ?? null);
  const addNote = useAddCandidateNote();
  const moveStage = useMoveCandidateStage();
  const setState = useSetCandidateState();
  const logEmail = useLogCandidateEmail();
  const uploadCv = useUploadCandidateCv();
  const sendEmail = useSendNewEmail();
  const fileRef = useRef<HTMLInputElement>(null);

  const [note, setNote] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [openingCv, setOpeningCv] = useState(false);

  if (!candidate) return null;
  const currentState = states.find((s) => s.id === candidate.state_id);

  async function handleSendEmail() {
    if (!candidate.email) {
      toast.error("El candidato no tiene correo.");
      return;
    }
    if (!subject.trim() || !emailBody.trim()) {
      toast.error("Asunto y mensaje son obligatorios.");
      return;
    }
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {candidate.full_name}
            {currentState && (
              <Badge variant="outline" className={cn(STATE_COLOR_STYLE[currentState.color] ?? STATE_COLOR_STYLE.slate)}>
                {currentState.name}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Datos */}
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
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fileRef.current?.click()}
              disabled={uploadCv.isPending}
            >
              {uploadCv.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
              {candidate.resume_url ? "Reemplazar" : "Subir CV"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadCv.mutate({ candidate, file });
                e.target.value = "";
              }}
            />
          </div>

          {/* Fase y estado */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fase</Label>
              <Select
                value={candidate.stage_id ?? ""}
                onValueChange={(stageId) => {
                  const st = stages.find((s) => s.id === stageId);
                  if (st) moveStage.mutate({ candidate, stageId, stageName: st.name });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Sin fase" /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select
                value={candidate.state_id ?? ""}
                onValueChange={(stateId) => {
                  const st = states.find((s) => s.id === stateId);
                  if (st) setState.mutate({ candidate, stateId, stateName: st.name });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Sin estado" /></SelectTrigger>
                <SelectContent>
                  {states.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEmailOpen((v) => !v)} disabled={!candidate.email}>
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              Enviar correo
            </Button>
          </div>

          {emailOpen && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
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

          {/* Nota rápida */}
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label className="flex items-center gap-1.5"><StickyNote className="h-3.5 w-3.5" /> Nota</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Agregar nota al seguimiento" className="h-8 text-sm" />
            </div>
            <Button
              size="sm"
              disabled={!note.trim() || addNote.isPending}
              onClick={() => addNote.mutate({ candidate, note: note.trim() }, { onSuccess: () => setNote("") })}
            >
              Agregar
            </Button>
          </div>

          {/* Bitácora */}
          <div>
            <p className="mb-2 text-sm font-medium">Seguimiento</p>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
