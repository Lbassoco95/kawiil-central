import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ExternalLink, Lightbulb, Loader2, RefreshCw, Trash2 } from "lucide-react";

type GatherPurpose = "inbox_tasks_slack_mail" | "lightbulb_reminders";

type GatherBinding = {
  id: string;
  purpose: GatherPurpose | string;
  label: string | null;
  webhook_host: string | null;
  enabled: boolean;
  last_ping_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  last_snapshot: {
    tasksDue?: number;
    tasksOverdue?: number;
    slackUnread?: number;
    mailUnread?: number;
    remindersDue?: number;
    urgent?: boolean;
  } | null;
};

type ListResponse = {
  bindings?: GatherBinding[];
  dueWindowDays?: number;
  configured?: boolean;
  mailUnreadStub?: boolean;
  error?: string;
  message?: string;
};

const PURPOSE_LABEL: Record<GatherPurpose, string> = {
  inbox_tasks_slack_mail: "Inbox — tareas + Slack + correo",
  lightbulb_reminders: "Lightbulb — urgencias / recordatorios",
};

function purposeLabel(p: string): string {
  return PURPOSE_LABEL[p as GatherPurpose] ?? p;
}

export function GatherSmartObjectsCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [purpose, setPurpose] = useState<GatherPurpose>("inbox_tasks_slack_mail");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [label, setLabel] = useState("");

  const listQuery = useQuery({
    queryKey: ["gather-bindings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<ListResponse>("gather-sync", {
        body: { action: "list" },
      });
      if (error) throw error;
      if (data?.error && data.error !== "gather_not_configured") {
        throw new Error(data.message || data.error);
      }
      return data ?? { bindings: [], configured: false };
    },
    retry: 1,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        error?: string;
        message?: string;
        ping?: { preset?: string | null };
      }>("gather-sync", {
        body: {
          action: "save",
          purpose,
          webhookUrl: webhookUrl.trim(),
          webhookSecret: webhookSecret.trim(),
          label: label.trim() || null,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || data?.error || "No se pudo guardar");
      return data;
    },
    onSuccess: (data) => {
      toast.success(
        data.ping?.preset
          ? `Conectado (preset Gather: ${data.ping.preset})`
          : "Objeto Gather conectado",
      );
      setWebhookUrl("");
      setWebhookSecret("");
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["gather-bindings", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message || "Error al guardar"),
  });

  const pingDraftMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        error?: string;
        message?: string;
        ping?: { preset?: string | null; colors?: string[] };
      }>("gather-sync", {
        body: {
          action: "ping",
          webhookUrl: webhookUrl.trim(),
          webhookSecret: webhookSecret.trim(),
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || data?.error || "Ping falló");
      return data;
    },
    onSuccess: (data) => {
      toast.success(
        data.ping?.preset
          ? `Ping OK · preset «${data.ping.preset}»`
          : "Ping OK — URL y secret válidos",
      );
    },
    onError: (e: Error) => toast.error(e.message || "Ping falló"),
  });

  const syncMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        error?: string;
        message?: string;
      }>("gather-sync", {
        body: { action: "sync_me" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || data?.error || "Sync falló");
      return data;
    },
    onSuccess: () => {
      toast.success("Sincronizado con Gather");
      void qc.invalidateQueries({ queryKey: ["gather-bindings", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo sincronizar"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        error?: string;
        message?: string;
      }>("gather-sync", {
        body: { action: "delete", id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || data?.error || "No se pudo eliminar");
    },
    onSuccess: () => {
      toast.success("Objeto desconectado");
      void qc.invalidateQueries({ queryKey: ["gather-bindings", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message || "Error al eliminar"),
  });

  const bindings = listQuery.data?.bindings ?? [];
  const dueDays = listQuery.data?.dueWindowDays ?? 3;
  const serverConfigured = listQuery.data?.configured !== false;
  const canSubmit = webhookUrl.trim().length > 8 && webhookSecret.trim().startsWith("whsec_");

  const hint = useMemo(
    () =>
      `Las alertas de escritorio del SO siguen en esta página (push / navegador). Gather solo muestra el pulso en tu desk (tareas ≤ ${dueDays} días, Slack y correo como conteos).`,
    [dueDays],
  );

  if (!user) return null;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Gather (oficina virtual)
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1 max-w-prose">{hint}</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a
              href="https://support.help.gather.town/articles/1914828565"
              target="_blank"
              rel="noreferrer"
            >
              Guía Gather
              <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!serverConfigured && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            El servidor aún no tiene <code className="text-[11px]">GATHER_BINDING_SECRET</code> (≥32).
            Pedí a ops que lo configure en Edge Secrets antes de guardar.
          </p>
        )}

        {listQuery.data?.mailUnreadStub && (
          <p className="text-[11px] text-muted-foreground">
            MVP: el contador de correo unread está en stub (0). Tareas y Slack sí se reflejan.
          </p>
        )}

        {listQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando conexiones…
          </div>
        ) : bindings.length > 0 ? (
          <ul className="space-y-2">
            {bindings.map((b) => (
              <li
                key={b.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border/50 px-3 py-2"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{b.label || purposeLabel(b.purpose)}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {purposeLabel(b.purpose)}
                    </Badge>
                    {!b.enabled && (
                      <Badge variant="outline" className="text-[10px]">
                        pausado
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    Host: {b.webhook_host || "—"}
                    {b.last_sync_at ? ` · sync ${new Date(b.last_sync_at).toLocaleString("es-MX")}` : ""}
                  </p>
                  {b.last_snapshot && (
                    <p className="text-[11px] text-muted-foreground">
                      Snapshot: tareas {b.last_snapshot.tasksDue ?? 0}
                      {b.last_snapshot.tasksOverdue
                        ? ` (${b.last_snapshot.tasksOverdue} vencidas)`
                        : ""}
                      {" · "}Slack {b.last_snapshot.slackUnread ?? 0}
                      {" · "}mail {b.last_snapshot.mailUnread ?? 0}
                      {b.last_snapshot.urgent ? " · urgente" : ""}
                    </p>
                  )}
                  {b.last_error && (
                    <p className="text-[11px] text-destructive">Último error: {b.last_error}</p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  disabled={deleteMut.isPending}
                  onClick={() => deleteMut.mutate(b.id)}
                  title="Desconectar"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Aún no hay objetos conectados. En Gather: Decorate Desk → Smart Objects → copiá URL y{" "}
            <code className="text-[11px]">whsec_…</code>.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="gather-purpose">Propósito</Label>
            <Select value={purpose} onValueChange={(v) => setPurpose(v as GatherPurpose)}>
              <SelectTrigger id="gather-purpose">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inbox_tasks_slack_mail">
                  Inbox — tareas + Slack + correo
                </SelectItem>
                <SelectItem value="lightbulb_reminders">
                  Lightbulb — urgencias / recordatorios
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="gather-url">Webhook URL</Label>
            <Input
              id="gather-url"
              type="url"
              autoComplete="off"
              placeholder="https://… (desde el menú ⋮ del objeto)"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="gather-secret">API key / secret</Label>
            <Input
              id="gather-secret"
              type="password"
              autoComplete="off"
              placeholder="whsec_…"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="gather-label">Etiqueta (opcional)</Label>
            <Input
              id="gather-label"
              placeholder="Desk Leopoldo — Inbox"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canSubmit || pingDraftMut.isPending || !serverConfigured}
            onClick={() => pingDraftMut.mutate()}
          >
            {pingDraftMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : null}
            Probar conexión
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit || saveMut.isPending || !serverConfigured}
            onClick={() => saveMut.mutate()}
          >
            {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Guardar objeto
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={bindings.length === 0 || syncMut.isPending || !serverConfigured}
            onClick={() => syncMut.mutate()}
          >
            {syncMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            Sincronizar ahora
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
