import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, UserPlus, FolderCheck, ClipboardList, Bell, Download, BookOpen } from "lucide-react";
import { GuiaRHDialog } from "./GuiaRHDialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useExpedientesOverview } from "@/hooks/useExpediente";
import { useOnboardingOverview } from "@/hooks/useOnboarding";
import { useQuestionnaires, useAllResponses } from "@/hooks/useQuestionnaires";
import { useSendNewEmail } from "@/hooks/useMicrosoft";
import { EXPEDIENTE_DOC_TYPES, expedienteProgress } from "@/lib/expediente";
import { onboardingProgress } from "@/lib/onboarding";
import { bandFor, type QuestionnaireResults } from "@/lib/questionnaires";
import { exportExpedientesXlsx, exportResultadosXlsx } from "@/lib/rhExport";

interface Pending {
  userId: string;
  name: string;
  email: string;
  items: string[];
}

export function TableroRHPanel() {
  const { data: users = [], isLoading } = useOrgUsers();
  const { data: docs = [] } = useExpedientesOverview(true);
  const { data: onboarding = [] } = useOnboardingOverview(true);
  const { data: questionnaires = [] } = useQuestionnaires();
  const { data: responses = [] } = useAllResponses(true);
  const sendEmail = useSendNewEmail();
  const [exporting, setExporting] = useState(false);
  const [guiaOpen, setGuiaOpen] = useState(false);

  const activeUsers = useMemo(() => users.filter((u) => u.is_active), [users]);
  const activeQs = useMemo(() => questionnaires.filter((q) => q.active), [questionnaires]);
  const totalDocs = EXPEDIENTE_DOC_TYPES.length;

  const docsByUser = useMemo(() => groupBy(docs, (d) => d.user_id), [docs]);
  const obByUser = useMemo(() => groupBy(onboarding, (o) => o.user_id), [onboarding]);
  const respByUser = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of responses) {
      if (!m.has(r.user_id)) m.set(r.user_id, new Set());
      m.get(r.user_id)!.add(r.questionnaire_id);
    }
    return m;
  }, [responses]);

  // KPIs
  const now = new Date();
  const altasMes = activeUsers.filter((u) => {
    const d = new Date(u.created_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const expCompletos = activeUsers.filter((u) => expedienteProgress(docsByUser.get(u.user_id) ?? []).verified === totalDocs).length;
  const totalResponsesExpected = activeUsers.length * activeQs.length;
  const responsesGot = responses.filter((r) => activeQs.some((q) => q.id === r.questionnaire_id)).length;
  const avancePct = totalResponsesExpected ? Math.round((responsesGot / totalResponsesExpected) * 100) : 0;

  // Pendientes por persona
  const pendings: Pending[] = useMemo(() => {
    const out: Pending[] = [];
    for (const u of activeUsers) {
      const items: string[] = [];
      const exp = expedienteProgress(docsByUser.get(u.user_id) ?? []);
      if (exp.uploaded < totalDocs) items.push(`Expediente incompleto (${exp.uploaded}/${totalDocs})`);
      const ob = onboardingProgress(obByUser.get(u.user_id) ?? []);
      if (ob.total > 0 && ob.done < ob.total) items.push(`Bienvenida pendiente (${ob.done}/${ob.total})`);
      const answered = respByUser.get(u.user_id) ?? new Set();
      for (const q of activeQs) if (!answered.has(q.id)) items.push(`Falta responder: ${q.title}`);
      if (items.length) out.push({ userId: u.user_id, name: u.full_name, email: u.email, items });
    }
    return out;
  }, [activeUsers, docsByUser, obByUser, respByUser, activeQs, totalDocs]);

  function remind(p: Pending) {
    if (!p.email) return toast.error("El colaborador no tiene correo.");
    const list = p.items.map((i) => `<li>${i}</li>`).join("");
    const bodyHtml = `<p>Hola ${p.name.split(" ")[0]},</p><p>Te recordamos completar lo siguiente en el portal de RH:</p><ul>${list}</ul><p>Gracias.</p>`;
    sendEmail.mutate({ to: [p.email], subject: "Recordatorio de RH — Kawiil", bodyHtml });
  }

  async function exportExpedientes() {
    const rows = activeUsers.map((u) => {
      const exp = expedienteProgress(docsByUser.get(u.user_id) ?? []);
      const ob = onboardingProgress(obByUser.get(u.user_id) ?? []);
      return {
        Colaborador: u.full_name,
        Correo: u.email,
        "Docs subidos": exp.uploaded,
        "Docs verificados": exp.verified,
        "Total docs": totalDocs,
        "% verificado": exp.pct,
        Bienvenida: ob.total ? `${ob.done}/${ob.total}` : "—",
      };
    });
    await exportExpedientesXlsx(rows);
  }

  async function exportResultados() {
    setExporting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resumen: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const categorias: any[] = [];
      for (const q of questionnaires) {
        const { data } = await supabase.rpc("rh_questionnaire_results", { _qid: q.id });
        const res = data as QuestionnaireResults | null;
        if (!res) continue;
        const band = q.bands?.length ? bandFor(q.bands, res.total_avg) : null;
        resumen.push({
          Cuestionario: q.title,
          Respuestas: res.respondents,
          "Puntaje promedio": res.total_avg,
          Máximo: res.total_max,
          Nivel: band?.label ?? "—",
        });
        for (const c of res.categories ?? []) {
          categorias.push({ Cuestionario: q.title, Categoría: c.category, Promedio: c.avg, Máximo: c.max, "%": c.pct });
        }
      }
      await exportResultadosXlsx(resumen, categorias);
    } catch (e) {
      toast.error((e as Error).message || "No se pudo exportar");
    } finally {
      setExporting(false);
    }
  }

  if (isLoading) {
    return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Users} label="Colaboradores activos" value={String(activeUsers.length)} />
        <Kpi icon={UserPlus} label="Altas del mes" value={String(altasMes)} />
        <Kpi icon={FolderCheck} label="Expedientes completos" value={`${expCompletos}/${activeUsers.length}`} />
        <Kpi icon={ClipboardList} label="Avance cuestionarios" value={`${avancePct}%`} sub={`${activeQs.length} abierto(s)`} />
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={exportExpedientes}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> Exportar expedientes (Excel)
        </Button>
        <Button size="sm" variant="outline" onClick={exportResultados} disabled={exporting}>
          {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
          Exportar resultados (Excel)
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setGuiaOpen(true)}>
          <BookOpen className="mr-1.5 h-3.5 w-3.5" /> Guía de uso
        </Button>
      </div>
      <GuiaRHDialog open={guiaOpen} onOpenChange={setGuiaOpen} />

      {/* Pendientes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>Pendientes del equipo</span>
            <Badge variant="secondary" className="text-[10px]">{pendings.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pendings.length === 0 ? (
            <p className="text-sm text-muted-foreground">¡Todo al día! 🎉</p>
          ) : (
            pendings.map((p) => (
              <div key={p.userId} className="flex flex-wrap items-start gap-2 rounded-lg border p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{p.name}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {p.items.map((it, idx) => (
                      <li key={idx} className="text-xs text-muted-foreground">• {it}</li>
                    ))}
                  </ul>
                </div>
                <Button size="sm" variant="outline" onClick={() => remind(p)} disabled={!p.email || sendEmail.isPending}>
                  <Bell className="mr-1.5 h-3.5 w-3.5" /> Recordar
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Kpi({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg bg-muted p-2"><Icon className="h-5 w-5 text-muted-foreground" /></div>
        <div className="min-w-0">
          <p className="text-xl font-semibold leading-tight">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{label}{sub ? ` · ${sub}` : ""}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of arr) {
    const k = key(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return m;
}
