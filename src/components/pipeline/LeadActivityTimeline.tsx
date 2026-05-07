import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  Mail,
  MessageCircle,
  Calendar,
  StickyNote,
  ArrowRightLeft,
  UserCheck,
  TrendingUp,
  MailOpen,
  MousePointerClick,
  CheckCircle2,
  Clock,
  Inbox,
  Landmark,
} from "lucide-react";
import type { Json } from "@/integrations/supabase/types";
import { renderTextWithMentionHighlights } from "@/lib/renderMentionHighlights";

interface Activity {
  id: string;
  type: string;
  metadata: Json | null;
  created_at: string;
  user_id: string | null;
}

interface Task {
  id: string;
  title: string;
  task_type: string;
  due_date: string;
  is_completed: boolean;
  completed_at: string | null;
  priority: string;
  notes: string | null;
}

interface Props {
  activities: Activity[];
  tasks: Task[];
}

const typeConfig: Record<string, { icon: typeof Phone; color: string; label: string }> = {
  call: { icon: Phone, color: "text-green-600 bg-green-100", label: "Llamada" },
  email_sent: { icon: Mail, color: "text-blue-600 bg-blue-100", label: "Email enviado" },
  email_opened: { icon: MailOpen, color: "text-blue-500 bg-blue-50", label: "Email abierto" },
  email_clicked: { icon: MousePointerClick, color: "text-blue-700 bg-blue-100", label: "Click en email" },
  email_received: { icon: Inbox, color: "text-sky-600 bg-sky-100", label: "Email recibido" },
  whatsapp: { icon: MessageCircle, color: "text-emerald-600 bg-emerald-100", label: "WhatsApp" },
  meeting: { icon: Calendar, color: "text-purple-600 bg-purple-100", label: "Reunión" },
  note: { icon: StickyNote, color: "text-amber-600 bg-amber-100", label: "Nota" },
  stage_change: { icon: ArrowRightLeft, color: "text-indigo-600 bg-indigo-100", label: "Cambio de etapa" },
  assignment: { icon: UserCheck, color: "text-cyan-600 bg-cyan-100", label: "Asignación" },
  score_change: { icon: TrendingUp, color: "text-orange-600 bg-orange-100", label: "Score" },
  lead_created: { icon: CheckCircle2, color: "text-green-700 bg-green-100", label: "Lead creado" },
  savio_promotion: { icon: Landmark, color: "text-teal-700 bg-teal-100", label: "Savio" },
};

const defaultConfig = { icon: Clock, color: "text-gray-600 bg-gray-100", label: "Actividad" };

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days}d`;
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function getActivityDescription(type: string, metadata: Record<string, unknown> | null): string {
  if (!metadata) return "";
  switch (type) {
    case "call":
      return [
        metadata.result && `Resultado: ${metadata.result}`,
        metadata.duration_minutes && `${metadata.duration_minutes} min`,
      ]
        .filter(Boolean)
        .join(" — ");
    case "email_sent":
      return metadata.subject ? `Asunto: ${metadata.subject}` : "";
    case "email_received": {
      const from = metadata.from != null ? String(metadata.from) : "";
      const subj = metadata.subject != null ? String(metadata.subject) : "";
      return [from && `De: ${from}`, subj && `Asunto: ${subj}`].filter(Boolean).join(" — ");
    }
    case "whatsapp":
      return [
        metadata.direction === "inbound" ? "Recibido" : "Enviado",
        metadata.summary && String(metadata.summary).substring(0, 80),
      ]
        .filter(Boolean)
        .join(" — ");
    case "meeting":
      return metadata.title ? String(metadata.title) : "";
    case "note":
      return metadata.content ? String(metadata.content).substring(0, 120) : "";
    case "stage_change":
      return metadata.reason === "auto_call_connected"
        ? "Auto: llamada conectada"
        : metadata.reason === "auto_stale"
          ? "Auto: lead sin actividad"
          : "";
    case "score_change":
      return metadata.reason ? `Razón: ${metadata.reason}` : "";
    case "savio_promotion": {
      const cid = metadata.savio_customer_id != null ? String(metadata.savio_customer_id) : "";
      const iid = metadata.savio_invoice_id != null ? String(metadata.savio_invoice_id) : "";
      return [cid && `Cliente Savio: ${cid}`, iid && `Cargo: ${iid}`].filter(Boolean).join(" · ");
    }
    default:
      return "";
  }
}

export function LeadActivityTimeline({ activities, tasks }: Props) {
  const pendingTasks = useMemo(
    () => tasks.filter((t) => !t.is_completed).sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime()),
    [tasks],
  );

  return (
    <div className="space-y-1">
      {/* Pending tasks first */}
      {pendingTasks.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            Tareas pendientes
          </p>
          {pendingTasks.map((task) => {
            const isOverdue = new Date(task.due_date) < new Date();
            return (
              <div
                key={task.id}
                className={`flex items-start gap-3 p-2 rounded-md mb-1 ${
                  isOverdue ? "bg-red-50 dark:bg-red-950/20" : "bg-yellow-50 dark:bg-yellow-950/20"
                }`}
              >
                <div className={`rounded-full p-1.5 shrink-0 ${isOverdue ? "bg-red-100 text-red-600" : "bg-yellow-100 text-yellow-600"}`}>
                  <Clock className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{task.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant={isOverdue ? "destructive" : "secondary"} className="text-[10px]">
                      {isOverdue ? "Vencida" : "Pendiente"}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(task.due_date).toLocaleString("es-MX", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Activity timeline */}
      {activities.length === 0 && pendingTasks.length === 0 ? (
        <p className="text-muted-foreground text-sm py-4 text-center">Sin actividades registradas</p>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

          {activities.map((a) => {
            const config = typeConfig[a.type] || defaultConfig;
            const Icon = config.icon;
            const meta = a.metadata as Record<string, unknown> | null;
            const description = getActivityDescription(a.type, meta);
            const isImportant = a.type === "note" && meta?.is_important;

            return (
              <div key={a.id} className="flex gap-3 relative pb-3">
                <div className={`rounded-full p-1.5 shrink-0 z-10 ${config.color}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {config.label}
                      {isImportant && " !!"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatRelativeTime(a.created_at)}
                    </span>
                  </div>
                  {description && (
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">
                      {renderTextWithMentionHighlights(description, `pipe-act-${a.id}`)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
