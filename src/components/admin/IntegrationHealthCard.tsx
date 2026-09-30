import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shared/UserAvatar";
import {
  useIntegrationHealth,
  useRequestIntegrationReconnect,
  type UserIntegrationHealth,
  type LinkedAccountHealth,
} from "@/hooks/useIntegrationHealth";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Mail,
  MessageSquare,
  Monitor,
  Plug,
  RefreshCw,
  Users,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

function StatusBadge({ status, label }: { status: "ok" | "warning" | "error"; label: string }) {
  if (status === "ok") {
    return (
      <Badge variant="outline" className="text-[10px] bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-300 gap-1">
        <CheckCircle2 className="h-3 w-3" />
        {label}
      </Badge>
    );
  }
  if (status === "warning") {
    return (
      <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-300 gap-1">
        <AlertCircle className="h-3 w-3" />
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-300 gap-1">
      <XCircle className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function SlackCell({ slack }: { slack: UserIntegrationHealth["slack"] }) {
  if (slack.broken) {
    return (
      <div className="space-y-1">
        <StatusBadge status="error" label="Token revocado" />
        {slack.updated_at && (
          <p className="text-[10px] text-muted-foreground">
            Última vez {formatDistanceToNow(new Date(slack.updated_at), { locale: es, addSuffix: true })}
          </p>
        )}
      </div>
    );
  }
  if (slack.connected) {
    return <StatusBadge status="ok" label="Conectado" />;
  }
  return <StatusBadge status="warning" label="No conectado" />;
}

function MicrosoftCell({ ms }: { ms: UserIntegrationHealth["microsoft_principal"] }) {
  if (!ms.connected) {
    return <StatusBadge status="warning" label="Sin conectar" />;
  }
  return <StatusBadge status="ok" label="Conectado" />;
}

function LinkedAccountsCell({ accounts }: { accounts: LinkedAccountHealth[] }) {
  if (accounts.length === 0) {
    return <span className="text-[10px] text-muted-foreground italic">Ninguna</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      {accounts.map((acc) => {
        const status = acc.status === "connected" ? "ok" : acc.status === "error" ? "error" : "warning";
        const label = acc.status === "connected" ? "OK" : acc.status === "error" ? "Error" : "Desconectada";
        return (
          <div key={acc.id} className="flex items-center gap-1.5">
            <Badge variant="outline" className={`text-[9px] gap-1 ${
              status === "ok"
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-300"
                : status === "error"
                ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-300"
            }`}>
              {acc.provider === "microsoft" ? <Monitor className="h-3 w-3" /> : acc.provider === "google" ? <Mail className="h-3 w-3" /> : <Plug className="h-3 w-3" />}
              {label}
            </Badge>
            <span className="text-[10px] truncate max-w-[140px]" title={acc.email ?? acc.display_name ?? undefined}>
              {acc.display_name || acc.email || acc.provider}
            </span>
            {acc.last_error && (
              <span className="text-[10px] text-red-600 dark:text-red-400 truncate max-w-[200px]" title={acc.last_error}>
                {acc.last_error}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function UserActions({ user }: { user: UserIntegrationHealth }) {
  const requestReconnect = useRequestIntegrationReconnect();
  const options: { key: "slack" | "microsoft_principal" | "linked_account"; label: string }[] = [];

  if (!user.slack.connected || user.slack.broken) {
    options.push({ key: "slack", label: "Solicitar reconectar Slack" });
  }
  if (!user.microsoft_principal.connected) {
    options.push({ key: "microsoft_principal", label: "Solicitar reconectar Microsoft 365" });
  }
  if (user.linked_accounts.some((a) => a.status !== "connected")) {
    options.push({ key: "linked_account", label: "Solicitar revisar cuenta vinculada" });
  }

  if (options.length === 0) {
    return <span className="text-[10px] text-muted-foreground">Sin acciones</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={requestReconnect.isPending}>
          {requestReconnect.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
          Acciones
          <ChevronDown className="h-3.5 w-3.5 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.key}
            onClick={() => requestReconnect.mutate({ userId: user.user_id, fullName: user.full_name, integration: opt.key })}
            className="text-xs"
          >
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function IntegrationHealthCard() {
  const { data, isLoading, error, refetch, isFetching } = useIntegrationHealth();
  const [onlyIssues, setOnlyIssues] = useState(true);

  const filteredUsers = useMemo(() => {
    if (!data) return [];
    if (!onlyIssues) return data.users;
    return data.users.filter((u) => u.issue_count > 0);
  }, [data, onlyIssues]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="h-4 w-4" />
            Salud de integraciones por Kawiiler
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => setOnlyIssues((v) => !v)}
            >
              {onlyIssues ? "Ver todos" : "Solo con problemas"}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Actualizar"
            >
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Supervisa el estado de Slack, Microsoft 365 principal y cuentas de correo/calendario vinculadas de cada
          Kawiiler. Si algo falla, envía una notificación para que la reconecte desde Comunicación, Calendario o Correo.
        </p>

        {data?.counts && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <SummaryTile icon={Users} value={data.counts.total} label="Activos" variant="neutral" />
            <SummaryTile icon={MessageSquare} value={data.counts.slack_broken + data.counts.slack_missing} label="Slack con problema" variant="danger" />
            <SummaryTile icon={Monitor} value={data.counts.microsoft_missing} label="Microsoft sin conectar" variant="warning" />
            <SummaryTile icon={Plug} value={data.counts.linked_account_errors} label="Cuentas con error" variant="danger" />
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-xs text-destructive">{(error as Error).message}</p>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-500/70" />
            <p className="mt-3 text-sm text-muted-foreground">
              {onlyIssues ? "No hay Kawiilers con integraciones fallando" : "No hay Kawiilers activos"}
            </p>
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs w-[180px]">Kawiiler</TableHead>
                  <TableHead className="text-xs w-[120px]">Slack</TableHead>
                  <TableHead className="text-xs w-[140px]">Microsoft 365</TableHead>
                  <TableHead className="text-xs min-w-[220px]">Cuentas vinculadas</TableHead>
                  <TableHead className="text-xs w-[100px]">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.user_id} className="align-top">
                    <TableCell className="py-2">
                      <div className="flex items-center gap-2">
                        <UserAvatar
                          name={user.full_name}
                          email={user.email}
                          avatarUrl={user.avatar_url}
                          userId={user.user_id}
                          size="sm"
                          className="h-7 w-7"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{user.full_name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <SlackCell slack={user.slack} />
                    </TableCell>
                    <TableCell className="py-2">
                      <MicrosoftCell ms={user.microsoft_principal} />
                    </TableCell>
                    <TableCell className="py-2">
                      <LinkedAccountsCell accounts={user.linked_accounts} />
                    </TableCell>
                    <TableCell className="py-2">
                      <UserActions user={user} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data?.generated_at && (
          <p className="text-[10px] text-muted-foreground text-right">
            Última consulta {formatDistanceToNow(new Date(data.generated_at), { locale: es, addSuffix: true })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  icon: Icon,
  value,
  label,
  variant,
}: {
  icon: typeof Users;
  value: number;
  label: string;
  variant: "neutral" | "warning" | "danger";
}) {
  const color =
    variant === "danger"
      ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-300"
      : variant === "warning"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-300"
      : "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400 border-slate-300";
  return (
    <div className={`rounded-lg border p-2 ${color}`}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-lg font-semibold leading-none">{value}</span>
      </div>
      <p className="text-[10px] mt-1 leading-tight">{label}</p>
    </div>
  );
}
