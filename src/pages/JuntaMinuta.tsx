/**
 * Pantalla Minuta completa (B4) — /juntas/:meetingId/minuta
 */

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useProfiles } from "@/hooks/useTasks";
import { supabase } from "@/integrations/supabase/client";
import { mtgDb, type MtgAgreementRow, type MtgMeetingRow, type MtgMinutesRow, type MtgSeriesRow } from "@/lib/mtg/db";
import { MTG_BUCKET, MTG_SIGNED_URL_TTL_SECONDS } from "@/lib/mtg/storagePaths";
import {
  canApproveMinutes,
  isIncompleteConfirmed,
  isProposed,
} from "@/lib/mtg/minutesReview";
import {
  approveMinutes,
  closeMeetingAfterMinutes,
  confirmProposedAgreement,
  rejectProposedAgreement,
} from "@/lib/mtg/approveMinutes";
import { assignProjectAndCreateTask } from "@/lib/mtg/captureAgreement";
import { MtgUploadTranscriptButton } from "@/components/mtg/MtgUploadTranscriptButton";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function JuntaMinuta() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { user } = useAuth();
  const { data: profiles = [] } = useProfiles();
  const qc = useQueryClient();
  const [draftMd, setDraftMd] = useState<string | null>(null);
  const [vttOpen, setVttOpen] = useState(false);
  const [vttUrl, setVttUrl] = useState<string | null>(null);
  const [vttSeek, setVttSeek] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [editProposed, setEditProposed] = useState<
    Record<string, { projectId: string; dueDate: string; ownerUserId: string; ownerName: string }>
  >({});
  const [sendOpen, setSendOpen] = useState(false);
  const [sendRecipients, setSendRecipients] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);

  const q = useQuery({
    queryKey: ["mtg-minutes-full", meetingId],
    enabled: !!user && !!meetingId,
    queryFn: async () => {
      const { data: meeting, error: mErr } = await mtgDb
        .from("mtg_meetings")
        .select("*")
        .eq("id", meetingId!)
        .single();
      if (mErr) throw mErr;

      let series: MtgSeriesRow | null = null;
      if (meeting.series_id) {
        const { data: s } = await mtgDb.from("mtg_series").select("*").eq("id", meeting.series_id).single();
        series = s as MtgSeriesRow;
      }

      const { data: minutes } = await mtgDb
        .from("mtg_minutes")
        .select("*")
        .eq("meeting_id", meetingId!)
        .order("version", { ascending: false });

      const { data: agreements } = await mtgDb
        .from("mtg_agreements")
        .select("*")
        .eq("meeting_id", meetingId!)
        .order("created_at");

      const clientIds = [
        ...new Set(
          [
            meeting.client_id,
            ...(series?.entities ?? []).map((e) => e.client_id),
            ...(agreements ?? []).map((a) => a.client_id),
          ].filter(Boolean) as string[],
        ),
      ];

      let projects: { id: string; name: string; area: string | null; client_id: string | null }[] = [];
      if (clientIds.length > 0) {
        const { data: p } = await supabase
          .from("projects")
          .select("id, name, area, client_id")
          .in("client_id", clientIds)
          .eq("status", "activo");
        projects = p ?? [];
      }

      return {
        meeting: meeting as MtgMeetingRow,
        series,
        minutes: (minutes ?? []) as MtgMinutesRow[],
        agreements: (agreements ?? []) as MtgAgreementRow[],
        projects,
      };
    },
  });

  const current = q.data?.minutes.find((m) => m.status === "draft" || m.status === "in_review" || m.status === "approved")
    ?? q.data?.minutes[0];
  const md = draftMd ?? current?.content_md ?? "";
  const agreements = q.data?.agreements ?? [];
  const proposed = agreements.filter(isProposed);
  const incomplete = agreements.filter(isIncompleteConfirmed);
  const approval = canApproveMinutes(agreements);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["mtg-minutes-full", meetingId] });

  const openVttAt = async (ref: string | null) => {
    const path = q.data?.meeting.transcript_path;
    if (!path) {
      toast.error("No hay transcripción en esta junta");
      return;
    }
    const { data, error } = await supabase.storage
      .from(MTG_BUCKET)
      .createSignedUrl(path, MTG_SIGNED_URL_TTL_SECONDS);
    if (error) {
      toast.error(error.message);
      return;
    }
    setVttSeek(ref);
    setVttUrl(data.signedUrl);
    setVttOpen(true);
  };

  const getEdit = (a: MtgAgreementRow) => {
    if (editProposed[a.id]) return editProposed[a.id];
    const hintName = a.owner_name ?? "";
    const matched = hintName
      ? profiles.find(
          (p) =>
            (p.full_name ?? "").toLowerCase() === hintName.toLowerCase() ||
            (p.email ?? "").toLowerCase() === hintName.toLowerCase(),
        )
      : undefined;
    return {
      projectId: a.project_hint ?? a.project_id ?? "",
      dueDate: a.due_date ?? "",
      ownerUserId: a.owner_user_id ?? matched?.user_id ?? "",
      ownerName: matched ? "" : hintName,
    };
  };

  if (q.isLoading) {
    return (
      <AppLayout>
        <div className="flex gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando minuta…
        </div>
      </AppLayout>
    );
  }

  if (!q.data || !user) {
    return (
      <AppLayout>
        <p className="p-8 text-sm text-destructive">No se pudo cargar la minuta.</p>
      </AppLayout>
    );
  }

  const { meeting, series, projects } = q.data;
  const orgId = meeting.organization_id;

  return (
    <AppLayout>
      <div className="space-y-4 animate-fade-in pb-16">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/juntas/${meetingId}`}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Tablero
            </Link>
          </Button>
          <div className="flex flex-wrap gap-2">
            {user && (
              <MtgUploadTranscriptButton
                organizationId={orgId}
                actorUserId={user.id}
                meeting={meeting}
                series={series}
                onDone={() => invalidate()}
              />
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={draftBusy || current?.status === "approved"}
              onClick={async () => {
                setDraftBusy(true);
                try {
                  const { data, error } = await supabase.functions.invoke("mtg-minutes-draft", {
                    body: { meeting_id: meeting.id },
                  });
                  if (error) throw error;
                  if (data?.error) throw new Error(data.error);
                  toast.success("Borrador generado (sin modelo)");
                  setDraftMd(null);
                  invalidate();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Error al generar borrador");
                } finally {
                  setDraftBusy(false);
                }
              }}
            >
              {draftBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
              Generar borrador de minuta
            </Button>
            <Button
              size="sm"
              disabled={!approval.ok || !current || current.status === "approved"}
              title={!approval.ok ? approval.reason : undefined}
              onClick={async () => {
                if (!current || !approval.ok) return;
                try {
                  await approveMinutes({
                    organizationId: orgId,
                    actorUserId: user.id,
                    meeting,
                    series,
                    minutes: current,
                    contentMd: md,
                  });
                  toast.success("Minuta aprobada");
                  invalidate();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Error al aprobar");
                }
              }}
            >
              Aprobar minuta
            </Button>
            {series?.send_minutes_to_client && meeting.status === "minutes_approved" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setSendRecipients(
                    (series.attendees_client ?? [])
                      .map((a) => a.email)
                      .filter(Boolean)
                      .join(", "),
                  );
                  setSendOpen(true);
                }}
              >
                Enviar al cliente
              </Button>
            )}
            {(meeting.status === "minutes_approved" || meeting.status === "ended" || meeting.status === "minutes_draft") && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await closeMeetingAfterMinutes({
                      organizationId: orgId,
                      actorUserId: user.id,
                      meeting,
                      series,
                      contentMd: md,
                      sendToClient: false,
                    });
                    toast.success("Junta cerrada");
                    invalidate();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Error");
                  }
                }}
              >
                Cerrar junta
              </Button>
            )}
          </div>
        </div>

        <h1 className="text-xl font-bold">Minuta</h1>
        {!current && (
          <p className="text-sm text-muted-foreground">
            Aún no hay borrador. Termina la junta y genera con el worker (`mtg.generate_minutes`, mock disponible).
          </p>
        )}

        <div className="grid lg:grid-cols-2 gap-6">
          <section className="space-y-2">
            <h2 className="font-semibold text-sm">Markdown</h2>
            <Textarea
              className="min-h-[420px] font-mono text-xs"
              value={md}
              onChange={(e) => setDraftMd(e.target.value)}
              disabled={current?.status === "approved"}
            />
            {current && (
              <p className="text-xs text-muted-foreground">
                v{current.version} · {current.status} · {current.generated_by ?? "—"} · prompt{" "}
                {current.prompt_version ?? "—"}
              </p>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="font-semibold text-sm">Acuerdos propuestos</h2>
            {proposed.length === 0 && (
              <p className="text-sm text-muted-foreground">Ninguno pendiente.</p>
            )}
            {proposed.map((a) => {
              const ed = getEdit(a);
              const clientProjects = projects.filter((p) => p.client_id === a.client_id);
              return (
                <div key={a.id} className="border rounded-md p-3 space-y-2 text-sm">
                  <div className="font-medium">{a.text}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.entity_key ?? "—"} · conf {a.confidence ?? "—"}
                    {a.project_reason && (
                      <span className="block">Sugerencia: {a.project_reason}</span>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      value={ed.projectId || undefined}
                      onValueChange={(v) =>
                        setEditProposed((s) => ({ ...s, [a.id]: { ...ed, projectId: v } }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Proyecto" />
                      </SelectTrigger>
                      <SelectContent>
                        {clientProjects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} · {p.area}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="date"
                      value={ed.dueDate}
                      onChange={(e) =>
                        setEditProposed((s) => ({ ...s, [a.id]: { ...ed, dueDate: e.target.value } }))
                      }
                    />
                    <Select
                      value={ed.ownerUserId || undefined}
                      onValueChange={(v) =>
                        setEditProposed((s) => ({ ...s, [a.id]: { ...ed, ownerUserId: v } }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Responsable interno" />
                      </SelectTrigger>
                      <SelectContent>
                        {profiles.map((p) => (
                          <SelectItem key={p.user_id} value={p.user_id}>
                            {p.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Nombre cliente (si aplica)"
                      value={ed.ownerName}
                      onChange={(e) =>
                        setEditProposed((s) => ({ ...s, [a.id]: { ...ed, ownerName: e.target.value } }))
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {a.transcript_ref && (
                      <Button size="sm" variant="outline" onClick={() => openVttAt(a.transcript_ref)}>
                        VTT {a.transcript_ref}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          await confirmProposedAgreement({
                            organizationId: orgId,
                            actorUserId: user.id,
                            agreement: a,
                            projectId: ed.projectId,
                            dueDate: ed.dueDate,
                            ownerUserId: ed.ownerUserId || null,
                            ownerName: ed.ownerName || null,
                            ownerSide: ed.ownerUserId ? "kawiil" : "client",
                          });
                          toast.success("Acuerdo confirmado + tarea");
                          invalidate();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Error");
                        }
                      }}
                    >
                      Confirmar
                    </Button>
                    <Input
                      className="max-w-[180px] h-8"
                      placeholder="Motivo rechazo"
                      value={rejectReason[a.id] ?? ""}
                      onChange={(e) => setRejectReason((s) => ({ ...s, [a.id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => {
                        const reason = (rejectReason[a.id] ?? "").trim();
                        if (!reason) {
                          toast.error("Motivo obligatorio");
                          return;
                        }
                        try {
                          await rejectProposedAgreement({
                            organizationId: orgId,
                            actorUserId: user.id,
                            agreementId: a.id,
                            reason,
                          });
                          toast.success("Rechazado");
                          invalidate();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Error");
                        }
                      }}
                    >
                      Rechazar
                    </Button>
                  </div>
                </div>
              );
            })}

            <h2 className="font-semibold text-sm pt-2">Acuerdos incompletos</h2>
            {incomplete.length === 0 && (
              <p className="text-sm text-muted-foreground">Ninguno.</p>
            )}
            {incomplete.map((a) => (
              <div key={a.id} className="border border-amber-300 rounded-md p-3 space-y-2 text-sm">
                <div className="font-medium">{a.text}</div>
                {a.project_reason && (
                  <p className="text-xs text-muted-foreground">{a.project_reason}</p>
                )}
                <Select
                  defaultValue={a.project_hint ?? undefined}
                  onValueChange={async (pid) => {
                    try {
                      await assignProjectAndCreateTask({
                        organizationId: orgId,
                        actorUserId: user.id,
                        agreement: a,
                        projectId: pid,
                      });
                      toast.success("Proyecto asignado + tarea");
                      invalidate();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Error");
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={a.project_hint ? "Usar sugerencia / elegir" : "Elegir proyecto"} />
                  </SelectTrigger>
                  <SelectContent>
                    {projects
                      .filter((p) => p.client_id === a.client_id)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} · {p.area}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ))}

            {agreements.filter((a) => a.status === "rejected").length > 0 && (
              <>
                <h2 className="font-semibold text-sm pt-2 text-muted-foreground">Rechazados</h2>
                {agreements
                  .filter((a) => a.status === "rejected")
                  .map((a) => (
                    <div
                      key={a.id}
                      className="text-sm text-muted-foreground line-through opacity-70 border rounded-md p-2 bg-muted/40"
                    >
                      {a.text} — {a.rejected_reason}
                    </div>
                  ))}
              </>
            )}
          </section>
        </div>
      </div>

      <Dialog open={vttOpen} onOpenChange={setVttOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Transcripción {vttSeek ? `@ ${vttSeek}` : ""}</DialogTitle>
          </DialogHeader>
          {vttUrl ? (
            <iframe title="vtt" src={vttUrl} className="w-full h-64 border rounded" />
          ) : (
            <p className="text-sm text-muted-foreground">Sin URL</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar minuta al cliente</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Vista previa: se adjunta el PDF de la minuta (sin transcripción). Envío vía Graph
            Mail.Send de aplicación desde el buzón del owner.
          </p>
          <Label className="text-xs">Destinatarios (coma-separados)</Label>
          <Input value={sendRecipients} onChange={(e) => setSendRecipients(e.target.value)} />
          <div className="max-h-40 overflow-auto rounded border p-2 text-xs font-mono whitespace-pre-wrap">
            {md.slice(0, 1200)}
            {md.length > 1200 ? "…" : ""}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSendOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                try {
                  const recipients = sendRecipients
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  await closeMeetingAfterMinutes({
                    organizationId: orgId,
                    actorUserId: user.id,
                    meeting,
                    series,
                    contentMd: md,
                    sendToClient: true,
                    recipients,
                  });
                  toast.success("Marcada como enviada y junta cerrada");
                  setSendOpen(false);
                  invalidate();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Error");
                }
              }}
            >
              Enviar y cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
