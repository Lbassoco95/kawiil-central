/**
 * Minuta con formato (Vista) o Markdown (Editar), con Copiar y Enviar por correo.
 */

import { useMemo, useState } from "react";
import { Copy, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { useProfiles } from "@/hooks/useTasks";
import { cn } from "@/lib/utils";
import { copyMinutes, parseEmails, sendMinutesEmail } from "@/lib/mtg/minutesEmail";
import { meetingTeamIds } from "@/lib/mtg/meetingTeam";
import type { MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";

export function MtgMinutesView(props: {
  md: string;
  onChange: (md: string) => void;
  readOnly?: boolean;
  title: string;
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
  footer?: React.ReactNode;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [sendOpen, setSendOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [others, setOthers] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: profiles = [] } = useProfiles();

  const team = useMemo(() => meetingTeamIds(props.series, props.meeting), [props.series, props.meeting]);
  const withEmail = profiles.filter((p) => p.email);

  const onCopy = async () => {
    try {
      const kind = await copyMinutes(props.md);
      toast.success(kind === "rich" ? "Minuta copiada con formato" : "Minuta copiada (texto)");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const openSend = () => {
    setPicked(team.filter((id) => withEmail.some((p) => p.user_id === id)));
    setSubject(`Minuta: ${props.title} (${String(props.meeting.scheduled_at).slice(0, 10)})`);
    setSendOpen(true);
  };

  const send = async () => {
    const to = [
      ...new Set([
        ...picked.map((id) => withEmail.find((p) => p.user_id === id)?.email).filter(Boolean),
        ...parseEmails(others),
      ]),
    ] as string[];
    setBusy(true);
    try {
      await sendMinutesEmail({ to, subject: subject.trim() || `Minuta: ${props.title}`, md: props.md });
      toast.success(`Minuta enviada a ${to.length} persona(s)`);
      setSendOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar (¿Outlook conectado?)");
    } finally {
      setBusy(false);
    }
  };

  const tab = (m: "view" | "edit", label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={cn(
        "px-3 py-1 text-xs rounded-md border",
        mode === m ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h2 className="font-semibold text-sm mr-1">Minuta</h2>
          {tab("view", "Vista")}
          {tab("edit", "Editar")}
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void onCopy()} disabled={!props.md.trim()}>
            <Copy className="h-3.5 w-3.5 mr-1" />
            Copiar
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={openSend} disabled={!props.md.trim()}>
            <Mail className="h-3.5 w-3.5 mr-1" />
            Enviar
          </Button>
        </div>
      </div>

      {mode === "view" ? (
        <div className="min-h-[420px] rounded-md border bg-card p-4">
          <KawiilAiMarkdown>{props.md || "_Aún no hay minuta._"}</KawiilAiMarkdown>
        </div>
      ) : (
        <Textarea
          className="min-h-[420px] font-mono text-xs"
          value={props.md}
          onChange={(e) => props.onChange(e.target.value)}
          disabled={props.readOnly}
        />
      )}
      {props.footer}

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar minuta por correo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Asunto</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Equipo</Label>
              <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                {withEmail.map((p) => (
                  <label key={p.user_id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50">
                    <Checkbox
                      checked={picked.includes(p.user_id)}
                      onCheckedChange={(v) =>
                        setPicked((cur) => (v ? [...cur, p.user_id] : cur.filter((x) => x !== p.user_id)))
                      }
                    />
                    <span className="min-w-0 truncate">
                      {p.full_name || p.email}
                      {team.includes(p.user_id) && <span className="ml-1 text-[10px] text-muted-foreground">equipo de la junta</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Otros correos (clientes, externos)</Label>
              <Input value={others} onChange={(e) => setOthers(e.target.value)} placeholder="nombre@empresa.com, otro@empresa.com" />
            </div>
            <p className="text-[11px] text-muted-foreground">Se envía con formato desde tu Outlook conectado.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setSendOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={busy} onClick={() => void send()}>
                {busy ? "Enviando…" : "Enviar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
