import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpen,
  Plus,
  Trash2,
  TrendingUp,
  Flag,
  AlertTriangle,
  Ban,
  Users,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { formatMX, toDateStringMX } from "@/lib/dateUtils";
import { toast } from "sonner";

export const LOG_ENTRY_TYPES: {
  value: string;
  label: string;
  icon: LucideIcon;
  color: string;
  dot: string;
}[] = [
  { value: "avance", label: "Avance", icon: TrendingUp, color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", dot: "bg-green-500" },
  { value: "hito", label: "Hito", icon: Flag, color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400", dot: "bg-blue-500" },
  { value: "atraso", label: "Atraso", icon: AlertTriangle, color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", dot: "bg-red-500" },
  { value: "bloqueo", label: "Bloqueo", icon: Ban, color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400", dot: "bg-orange-500" },
  { value: "reunion", label: "Reunión", icon: Users, color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400", dot: "bg-purple-500" },
  { value: "nota", label: "Nota", icon: StickyNote, color: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
];

export const LOG_RESPONSIBILITIES: { value: string; label: string; color: string }[] = [
  { value: "kawiil", label: "Nosotros (Kawiil)", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "cliente", label: "Cliente", color: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400" },
  { value: "autoridad", label: "Autoridad / SAT", color: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400" },
  { value: "externo", label: "Dependencia externa", color: "bg-slate-100 text-slate-800 dark:bg-slate-800/50 dark:text-slate-300" },
];

const typeMeta = (v: string) => LOG_ENTRY_TYPES.find((t) => t.value === v) ?? LOG_ENTRY_TYPES[0];
const respMeta = (v: string | null) => LOG_RESPONSIBILITIES.find((r) => r.value === v);

// Los atrasos/bloqueos requieren indicar de quién fue la responsabilidad.
const NEEDS_RESPONSIBILITY = new Set(["atraso", "bloqueo"]);

interface Props {
  projectId: string;
}

interface LogEntry {
  id: string;
  project_id: string;
  user_id: string;
  entry_date: string;
  entry_type: string;
  responsibility: string | null;
  title: string | null;
  content: string;
  created_at: string;
  profile?: { full_name?: string; avatar_url?: string };
}

export function ProjectLogTab({ projectId }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [entryDate, setEntryDate] = useState(toDateStringMX());
  const [entryType, setEntryType] = useState("avance");
  const [responsibility, setResponsibility] = useState<string>("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const { data: entries = [] } = useQuery({
    queryKey: ["project-log", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_log_entries")
        .select("*")
        .eq("project_id", projectId)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;

      const userIds = [...new Set(data.map((e) => e.user_id))];
      if (userIds.length === 0) return data as LogEntry[];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", userIds);

      return data.map((e) => ({
        ...e,
        profile: profiles?.find((p) => p.user_id === e.user_id),
      })) as LogEntry[];
    },
    enabled: !!user && !!projectId,
  });

  const addEntry = useMutation({
    mutationFn: async () => {
      const needsResp = NEEDS_RESPONSIBILITY.has(entryType);
      const { error } = await supabase.from("project_log_entries").insert({
        project_id: projectId,
        user_id: user!.id,
        entry_date: entryDate || toDateStringMX(),
        entry_type: entryType,
        responsibility: needsResp && responsibility ? responsibility : null,
        title: title.trim() || null,
        content: content.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-log", projectId] });
      setTitle("");
      setContent("");
      setResponsibility("");
      setEntryType("avance");
      setEntryDate(toDateStringMX());
      toast.success("Entrada agregada a la bitácora");
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("project_log_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-log", projectId] });
      toast.success("Entrada eliminada");
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });

  // Resumen: cuántos atrasos/bloqueos y de quién fue la responsabilidad.
  const summary = useMemo(() => {
    const blockers = entries.filter((e) => NEEDS_RESPONSIBILITY.has(e.entry_type));
    const byResp: Record<string, number> = {};
    for (const e of blockers) {
      if (e.responsibility) byResp[e.responsibility] = (byResp[e.responsibility] || 0) + 1;
    }
    return { total: entries.length, blockerCount: blockers.length, byResp };
  }, [entries]);

  const needsResp = NEEDS_RESPONSIBILITY.has(entryType);
  const canSave = content.trim().length > 0 && (!needsResp || !!responsibility);

  return (
    <div className="space-y-4">
      {/* Resumen de responsabilidad de atrasos */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Bitácora del proyecto
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-2xl font-semibold">{summary.total}</span>
              <span className="text-muted-foreground ml-1.5">entradas</span>
            </div>
            <div className="border-l border-border/60 pl-4">
              <span className="text-2xl font-semibold text-red-600 dark:text-red-400">
                {summary.blockerCount}
              </span>
              <span className="text-muted-foreground ml-1.5">atrasos / bloqueos</span>
            </div>
            {summary.blockerCount > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-l border-border/60 pl-4">
                {LOG_RESPONSIBILITIES.filter((r) => summary.byResp[r.value]).map((r) => (
                  <Badge key={r.value} variant="outline" className={r.color}>
                    {r.label}: {summary.byResp[r.value]}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Nueva entrada */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Nueva entrada
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs text-muted-foreground">Fecha</label>
              <Input
                type="date"
                className="mt-1 h-9 text-sm"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tipo</label>
              <Select value={entryType} onValueChange={setEntryType}>
                <SelectTrigger className="mt-1 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOG_ENTRY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                Responsable {needsResp && <span className="text-red-500">*</span>}
              </label>
              <Select
                value={responsibility || "__none__"}
                onValueChange={(v) => setResponsibility(v === "__none__" ? "" : v)}
                disabled={!needsResp}
              >
                <SelectTrigger className="mt-1 h-9 text-sm">
                  <SelectValue placeholder={needsResp ? "¿De quién fue?" : "No aplica"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin especificar</SelectItem>
                  {LOG_RESPONSIBILITIES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Input
            className="h-9 text-sm"
            placeholder="Título (opcional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            className="text-sm min-h-[80px]"
            placeholder="Describe qué pasó, el avance, el motivo del atraso, el plan de acción..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => addEntry.mutate()}
              disabled={addEntry.isPending || !canSave}
            >
              <Plus className="h-4 w-4 mr-1" />
              Registrar entrada
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Línea de tiempo */}
      <Card>
        <CardContent className="pt-4">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Aún no hay entradas en la bitácora. Registra el primer avance o situación arriba.
            </p>
          ) : (
            <div className="space-y-0">
              {entries.map((e, i) => {
                const meta = typeMeta(e.entry_type);
                const Icon = meta.icon;
                const rMeta = respMeta(e.responsibility);
                const isOwn = e.user_id === user?.id;
                return (
                  <div key={e.id} className="flex gap-3 relative pb-5 last:pb-0">
                    {/* Línea vertical */}
                    {i < entries.length - 1 && (
                      <span className="absolute left-[15px] top-8 bottom-0 w-px bg-border/60" />
                    )}
                    <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${meta.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={meta.color}>
                          {meta.label}
                        </Badge>
                        {rMeta && (
                          <Badge variant="outline" className={rMeta.color}>
                            {rMeta.label}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatMX(e.entry_date, "dd MMM yyyy")}
                        </span>
                        {isOwn && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 ml-auto text-muted-foreground hover:text-destructive"
                            onClick={() => deleteEntry.mutate(e.id)}
                            disabled={deleteEntry.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      {e.title && (
                        <p className="text-sm font-medium mt-1">{e.title}</p>
                      )}
                      <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">
                        {e.content}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <UserAvatar
                          name={e.profile?.full_name}
                          avatarUrl={e.profile?.avatar_url}
                          userId={e.user_id}
                          size="sm"
                        />
                        <span className="text-xs text-muted-foreground">
                          {e.profile?.full_name || "Usuario"} · {formatMX(e.created_at, "dd MMM HH:mm")}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
