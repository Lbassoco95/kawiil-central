/**
 * Hub del módulo Múuch' — listado de juntas, minutas y estado.
 * Ruta: /juntas
 */

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader, type PageHeaderStat } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";
import { formatDateMX } from "@/lib/dateUtils";
import { MEETING_STATUS, TRANSCRIPT_STATUS, type MtgMeetingStatus } from "@/lib/mtg/constants";
import { useMtgMeetingsForOrg, type OrgMtgMeeting } from "@/hooks/useMtgMeetingsOrg";
import { useClients, type Client } from "@/hooks/useClients";
import { MtgAdhocMeetingDialog } from "@/components/clients/MtgAdhocMeetingDialog";
import {
  CalendarClock,
  CheckSquare,
  FileText,
  Mic,
  Plus,
  Search,
  Users,
} from "lucide-react";

type StatusFilter = "all" | "upcoming" | "live" | "minutes" | "closed";

function matchesFilter(m: OrgMtgMeeting, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "upcoming") return m.status === "planned";
  if (filter === "live") return m.status === "in_progress";
  if (filter === "minutes") {
    return (
      m.status === "ended" ||
      m.status === "minutes_draft" ||
      m.status === "minutes_review" ||
      m.status === "minutes_approved"
    );
  }
  if (filter === "closed") {
    return m.status === "closed" || m.status === "cancelled" || m.status === "no_show";
  }
  return true;
}

export default function Juntas() {
  const navigate = useNavigate();
  const { data: meetings = [], isLoading } = useMtgMeetingsForOrg({ limit: 150 });
  const { data: clients = [] } = useClients();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [pickClientOpen, setPickClientOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [adhocClient, setAdhocClient] = useState<Client | null>(null);
  const [unassignedOpen, setUnassignedOpen] = useState(false);

  const heroStats: PageHeaderStat[] = useMemo(() => {
    const upcoming = meetings.filter((m) => m.status === "planned").length;
    const live = meetings.filter((m) => m.status === "in_progress").length;
    const needsMinutes = meetings.filter((m) =>
      ["ended", "minutes_draft", "minutes_review"].includes(m.status),
    ).length;
    const withRecording = meetings.filter((m) => !!m.recording_path).length;
    return [
      { label: "Juntas", value: meetings.length },
      { label: "Próximas", value: upcoming, tone: "primary" },
      { label: "En curso", value: live, tone: live > 0 ? "warning" : "default" },
      { label: "Pendientes de minuta", value: needsMinutes, tone: needsMinutes > 0 ? "warning" : "default" },
      { label: "Con grabación", value: withRecording, tone: "success" },
    ];
  }, [meetings]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return meetings.filter((m) => {
      if (!matchesFilter(m, filter)) return false;
      if (!needle) return true;
      const hay = [
        m.seriesTitle,
        m.clientName,
        m.status,
        MEETING_STATUS[m.status as MtgMeetingStatus]?.label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [meetings, q, filter]);

  const filteredClients = useMemo(() => {
    const needle = clientQuery.trim().toLowerCase();
    if (!needle) return clients.slice(0, 40);
    return clients
      .filter((c) => (c.name ?? "").toLowerCase().includes(needle))
      .slice(0, 40);
  }, [clients, clientQuery]);

  return (
    <AppLayout>
      <div className="kwv24 space-y-6 animate-fade-in">
        <PageHeader
          variant="hero"
          icon={<CalendarClock />}
          breadcrumb={["Kawiil OS", "Trabajo", "Juntas"]}
          iconAccent="linear-gradient(135deg, hsl(199 89% 48%), hsl(221 83% 53%))"
          title="Juntas"
          description="Múuch': tablero de sesiones, grabaciones, minutas con IA y acuerdos que se convierten en tareas del proyecto."
          stats={heroStats}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setAdhocClient(null);
                  setUnassignedOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                Nueva junta
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPickClientOpen(true)}>
                Con cliente
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/clientes">Series desde cliente</Link>
              </Button>
            </div>
          }
        />

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por cliente, serie o estado…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="Filtro" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="upcoming">Próximas</SelectItem>
              <SelectItem value="live">En curso</SelectItem>
              <SelectItem value="minutes">Minuta / revisión</SelectItem>
              <SelectItem value="closed">Cerradas / canceladas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <p className="text-center text-muted-foreground py-12">Cargando juntas…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 px-6 py-14 text-center space-y-3">
            <CalendarClock className="h-10 w-10 mx-auto text-muted-foreground/60" />
            <p className="text-muted-foreground max-w-md mx-auto">
              {meetings.length === 0
                ? "Aún no hay juntas. Crea una junta ad hoc o una serie desde la ficha del cliente."
                : "Ninguna junta coincide con el filtro."}
            </p>
            <Button
              size="sm"
              onClick={() => {
                setAdhocClient(null);
                setUnassignedOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Nueva junta
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-border/70 overflow-hidden divide-y divide-border/60 bg-card">
            {filtered.map((m) => {
              const statusCfg = MEETING_STATUS[m.status as MtgMeetingStatus] ?? MEETING_STATUS.planned;
              const transcriptCfg =
                TRANSCRIPT_STATUS[m.transcript_status] ?? TRANSCRIPT_STATUS.not_requested;
              return (
                <button
                  key={m.id}
                  type="button"
                  className="w-full text-left px-4 py-3.5 sm:px-5 hover:bg-muted/40 transition-colors flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
                  onClick={() => navigate(`/juntas/${m.id}`)}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold truncate">
                        {m.seriesTitle ?? m.title ?? "Junta ad hoc"}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] border-0", statusCfg.color)}
                      >
                        {statusCfg.label}
                      </Badge>
                      {!m.client_id && (
                        <Badge variant="secondary" className="text-[10px]">
                          Sin cliente
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{formatDateMX(m.scheduled_at)}</span>
                      {m.clientName ? (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {m.clientName}
                        </span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400">Prospecto / interna</span>
                      )}
                      <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5", transcriptCfg.color)}>
                        Transcripción: {transcriptCfg.label}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground shrink-0">
                    {m.recording_path && (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <Mic className="h-3.5 w-3.5" /> Grabación
                      </span>
                    )}
                    {m.approvedMinutesId ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <FileText className="h-3.5 w-3.5" /> Minuta
                      </span>
                    ) : (
                      ["ended", "minutes_draft", "minutes_review"].includes(m.status) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/juntas/${m.id}/minuta`);
                          }}
                        >
                          Revisar minuta
                        </Button>
                      )
                    )}
                    <span className="inline-flex items-center gap-1">
                      Acuerdos {m.agreementsConfirmed}/{m.agreementsTotal}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CheckSquare className="h-3.5 w-3.5" />
                      {m.openTasksCount} tareas
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={pickClientOpen}
        onOpenChange={(o) => {
          setPickClientOpen(o);
          if (!o) setClientQuery("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Elegir cliente para la junta</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Buscar cliente…"
            value={clientQuery}
            onChange={(e) => setClientQuery(e.target.value)}
          />
          <div className="max-h-72 overflow-y-auto divide-y rounded-md border">
            {filteredClients.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground text-center">Sin clientes</p>
            ) : (
              filteredClients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted/50"
                  onClick={() => {
                    setPickClientOpen(false);
                    setAdhocClient(c);
                  }}
                >
                  {c.name}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {adhocClient && (
        <MtgAdhocMeetingDialog
          open={!!adhocClient}
          onOpenChange={(o) => {
            if (!o) setAdhocClient(null);
          }}
          client={adhocClient}
          onCreated={(id) => navigate(`/juntas/${id}`)}
        />
      )}

      <MtgAdhocMeetingDialog
        open={unassignedOpen}
        onOpenChange={setUnassignedOpen}
        client={null}
        onCreated={(id) => navigate(`/juntas/${id}`)}
      />
    </AppLayout>
  );
}
