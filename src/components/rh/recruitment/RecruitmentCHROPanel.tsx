import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Users, UserPlus, Clock, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import {
  useRecruitmentProcesses,
  useAllCandidates,
  useAllCandidateActivities,
} from "@/hooks/useRecruitment";
import type { Candidate } from "@/lib/recruitment";

const DAY = 86_400_000;

export function RecruitmentCHROPanel() {
  const [open, setOpen] = useState(true);
  const { data: processes = [] } = useRecruitmentProcesses();
  const { data: candidates = [] } = useAllCandidates(true);
  const { data: activities = [] } = useAllCandidateActivities(true);

  const procTitle = useMemo(() => new Map(processes.map((p) => [p.id, p.title])), [processes]);

  // Último "toque" por candidato = última actividad, si no, su creación/actualización.
  const lastTouch = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of activities) {
      const t = new Date(a.created_at).getTime();
      if (!m.has(a.candidate_id) || t > m.get(a.candidate_id)!) m.set(a.candidate_id, t);
    }
    return m;
  }, [activities]);

  const now = Date.now();
  const active = useMemo(() => candidates.filter((c) => c.status === "active"), [candidates]);

  function touchOf(c: Candidate): number {
    return Math.max(lastTouch.get(c.id) ?? 0, new Date(c.updated_at).getTime(), new Date(c.created_at).getTime());
  }

  const stale = useMemo(
    () =>
      active
        .map((c) => ({ c, days: Math.floor((now - touchOf(c)) / DAY), ms: now - touchOf(c) }))
        .filter((x) => x.ms > 2 * DAY)
        .sort((a, b) => b.ms - a.ms),
    [active, lastTouch, now], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const atRisk = stale.filter((x) => x.ms > 7 * DAY).length;
  const nuevos7d = active.filter((c) => now - new Date(c.created_at).getTime() <= 7 * DAY).length;

  const byChannel = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of active) {
      const k = (c.source || "Sin canal").trim();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [active]);

  return (
    <Card className="border-primary/20">
      <CardHeader className="cursor-pointer pb-2" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Panel CHRO · reclutamiento</span>
          <Button size="icon" variant="ghost" className="h-7 w-7">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi icon={Users} label="Candidatos activos" value={String(active.length)} />
            <Kpi icon={UserPlus} label="Nuevos (7 días)" value={String(nuevos7d)} />
            <Kpi icon={Clock} label="Sin avance >48 h" value={String(stale.length)} tone={stale.length ? "amber" : undefined} />
            <Kpi icon={AlertTriangle} label="En riesgo >7 días" value={String(atRisk)} tone={atRisk ? "red" : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Sin avance */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sin avance (&gt;48 h)</p>
              {stale.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todo al día 🎉</p>
              ) : (
                <ul className="space-y-1.5">
                  {stale.slice(0, 8).map(({ c, days }) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        {c.full_name}
                        <span className="text-muted-foreground"> · {procTitle.get(c.process_id) ?? "—"}{c.source ? ` · ${c.source}` : ""}</span>
                      </span>
                      <Badge variant="outline" className={cn("shrink-0 text-[10px]", days > 7 ? "border-red-300 text-red-700 dark:text-red-400" : "border-amber-300 text-amber-700 dark:text-amber-400")}>
                        {days}d sin avance
                      </Badge>
                    </li>
                  ))}
                  {stale.length > 8 && <li className="text-xs text-muted-foreground">+{stale.length - 8} más…</li>}
                </ul>
              )}
            </div>

            {/* Por canal */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Candidatos activos por canal</p>
              {byChannel.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin datos.</p>
              ) : (
                <ul className="space-y-1.5">
                  {byChannel.map(([canal, n]) => (
                    <li key={canal} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{canal}</span>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">{n}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "amber" | "red" }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", tone === "red" ? "text-red-500" : tone === "amber" ? "text-amber-500" : "text-muted-foreground")} />
        <span className="text-lg font-semibold">{value}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
