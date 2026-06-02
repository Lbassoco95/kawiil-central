import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useExpedientesOverview } from "@/hooks/useExpediente";
import { expedienteProgress, type EmployeeDocument } from "@/lib/expediente";
import { EmployeeExpedienteDialog } from "./EmployeeExpedienteDialog";
import { OnboardingTemplateDialog } from "./OnboardingTemplateDialog";

export function ExpedientesEquipoPanel() {
  const { data: users = [], isLoading } = useOrgUsers();
  const { data: docs = [] } = useExpedientesOverview(true);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [tplOpen, setTplOpen] = useState(false);

  const docsByUser = useMemo(() => {
    const m = new Map<string, EmployeeDocument[]>();
    for (const d of docs) {
      if (!m.has(d.user_id)) m.set(d.user_id, []);
      m.get(d.user_id)!.push(d);
    }
    return m;
  }, [docs]);

  const activeUsers = users.filter((u) => u.is_active);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Expedientes del equipo. Abre uno para revisar datos y verificar documentos.
        </p>
        <Button size="sm" variant="outline" onClick={() => setTplOpen(true)}>
          <ListChecks className="mr-1.5 h-3.5 w-3.5" /> Plantilla de bienvenida
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {activeUsers.map((u) => {
            const p = expedienteProgress(docsByUser.get(u.user_id) ?? []);
            const tone = p.verified === p.total ? "emerald" : p.uploaded > 0 ? "amber" : "slate";
            return (
              <button key={u.user_id} type="button" onClick={() => setSelected({ id: u.user_id, name: u.full_name })} className="w-full text-left">
                <Card className="transition-colors hover:bg-muted/40">
                  <CardContent className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{u.full_name}</p>
                      <div className="mt-1 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-muted-foreground/30",
                          )}
                          style={{ width: `${p.total ? Math.round((p.uploaded / p.total) * 100) : 0}%` }}
                        />
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 text-[10px]",
                        tone === "emerald"
                          ? "border-emerald-300 text-emerald-700 dark:text-emerald-400"
                          : tone === "amber"
                            ? "border-amber-300 text-amber-700 dark:text-amber-400"
                            : "border-border text-muted-foreground",
                      )}
                    >
                      {p.verified}/{p.total} verificados
                    </Badge>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      <EmployeeExpedienteDialog
        userId={selected?.id ?? null}
        userName={selected?.name ?? ""}
        onOpenChange={(v) => !v && setSelected(null)}
      />
      <OnboardingTemplateDialog open={tplOpen} onOpenChange={setTplOpen} />
    </div>
  );
}
