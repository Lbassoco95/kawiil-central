import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SendToSignDialog } from "@/components/documents/SendToSignDialog";
import { MySignatureCard } from "@/components/esign/MySignatureCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { esignDb, invokeEsign, ESIGN_STATUS_LABEL, type EsignRequestRow, type EsignSignerRow } from "@/lib/esign";
import { formatMX } from "@/lib/dateUtils";
import { toast } from "sonner";
import { PenTool, Plus, Download, Bell, Ban, Link2, Loader2, CheckCircle2, Clock } from "lucide-react";

type Tab = "por_firmar" | "enviados" | "completados" | "mi_firma";
type InboxRow = EsignSignerRow & { esign_requests: EsignRequestRow & { created_by_name?: string } };
type SentRow = EsignRequestRow & { esign_signers: EsignSignerRow[] };

export default function Firmas() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("por_firmar");
  const [sendOpen, setSendOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const inbox = useQuery({
    queryKey: ["esign-inbox", user?.id],
    enabled: !!user,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await esignDb
        .from("esign_signers")
        .select("*, esign_requests(*)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as InboxRow[];
    },
  });

  const sent = useQuery({
    queryKey: ["esign-sent", user?.id],
    enabled: !!user,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await esignDb
        .from("esign_requests")
        .select("*, esign_signers(*)")
        .eq("created_by", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SentRow[];
    },
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["esign-inbox"] });
    void qc.invalidateQueries({ queryKey: ["esign-sent"] });
  };

  const porFirmar = (inbox.data ?? []).filter((r) => {
    const q = r.esign_requests;
    return r.status === "pending" && q?.status === "pending" && new Date(q.expires_at) > new Date();
  });
  const completados = [
    ...(inbox.data ?? []).filter((r) => r.esign_requests?.status === "completed").map((r) => ({
      id: r.esign_requests.id, title: r.esign_requests.title, at: r.esign_requests.completed_at,
    })),
    ...(sent.data ?? []).filter((r) => r.status === "completed").map((r) => ({ id: r.id, title: r.title, at: r.completed_at })),
  ].filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusyId(null);
    }
  };

  const openFile = (requestId: string, which: "signed" | "original") =>
    run(requestId, async () => {
      const r = await invokeEsign<{ url: string }>({ action: "download", request_id: requestId, which });
      window.open(r.url, "_blank", "noopener");
    });

  const copyLink = async (token: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/firmar/${token}`);
    toast.success("Link copiado");
  };

  return (
    <AppLayout>
      <div className="space-y-4 p-4 md:p-6">
        <PageHeader
          title="Firmas"
          description="Firma electrónica simple: cartas y documentos internos. Contratos → WeTrust."
          icon={<PenTool className="h-5 w-5" />}
          actions={<Button onClick={() => setSendOpen(true)} className="gap-1"><Plus className="h-4 w-4" /> Enviar a firma</Button>}
        />

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="por_firmar">Por firmar{porFirmar.length ? ` (${porFirmar.length})` : ""}</TabsTrigger>
            <TabsTrigger value="enviados">Enviados</TabsTrigger>
            <TabsTrigger value="completados">Completados</TabsTrigger>
            <TabsTrigger value="mi_firma">Mi firma</TabsTrigger>
          </TabsList>
        </Tabs>

        {(inbox.isLoading || sent.isLoading) && <Loader2 className="h-4 w-4 animate-spin" />}
        {(inbox.error || sent.error) && (
          <p className="text-sm text-destructive">
            No se pudieron cargar las firmas: {((inbox.error || sent.error) as Error).message}
          </p>
        )}

        {tab === "por_firmar" && (
          <div className="space-y-2">
            {porFirmar.length === 0 && !inbox.isLoading && (
              <p className="text-sm text-muted-foreground">No tienes documentos pendientes de firma.</p>
            )}
            {porFirmar.map((r) => (
              <Card key={r.id}>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.esign_requests.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Recibido {formatMX(r.esign_requests.created_at, "d MMM yyyy")} · vence {formatMX(r.esign_requests.expires_at, "d MMM yyyy")}
                    </p>
                  </div>
                  <Button asChild size="sm" className="gap-1">
                    <Link to={`/firmar/${r.token}`}><PenTool className="h-3.5 w-3.5" /> Revisar y firmar</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {tab === "enviados" && (
          <div className="space-y-2">
            {(sent.data ?? []).length === 0 && !sent.isLoading && (
              <p className="text-sm text-muted-foreground">Aún no has enviado documentos a firma.</p>
            )}
            {(sent.data ?? []).map((r) => (
              <Card key={r.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.title}</p>
                      <p className="text-xs text-muted-foreground">Enviado {formatMX(r.created_at, "d MMM yyyy")}</p>
                    </div>
                    <Badge variant={r.status === "completed" ? "default" : "secondary"}>{ESIGN_STATUS_LABEL[r.status]}</Badge>
                  </div>
                  <div className="space-y-1">
                    {[...r.esign_signers].sort((a, b) => a.sign_order - b.sign_order).map((s) => (
                      <div key={s.id} className="flex items-center gap-2 text-xs">
                        {s.status === "signed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span>{s.name}</span>
                        <span className="text-muted-foreground">{s.email}</span>
                        {s.status === "pending" && !s.user_id && r.status === "pending" && (
                          <button className="ml-auto flex items-center gap-1 text-primary hover:underline" onClick={() => copyLink(s.token)}>
                            <Link2 className="h-3 w-3" /> Copiar link
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" size="sm" className="gap-1" disabled={busyId === r.id} onClick={() => openFile(r.id, r.status === "completed" ? "signed" : "original")}>
                      <Download className="h-3.5 w-3.5" /> {r.status === "completed" ? "Firmado" : "Original"}
                    </Button>
                    {r.status === "pending" && (
                      <>
                        <Button variant="outline" size="sm" className="gap-1" disabled={busyId === r.id}
                          onClick={() => run(r.id, async () => { await invokeEsign({ action: "remind", request_id: r.id }); toast.success("Recordatorio enviado"); })}>
                          <Bell className="h-3.5 w-3.5" /> Recordar
                        </Button>
                        <Button variant="ghost" size="sm" className="gap-1 text-destructive" disabled={busyId === r.id}
                          onClick={() => run(r.id, async () => { await invokeEsign({ action: "cancel", request_id: r.id }); toast.success("Solicitud cancelada"); refresh(); })}>
                          <Ban className="h-3.5 w-3.5" /> Cancelar
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {tab === "completados" && (
          <div className="space-y-2">
            {completados.length === 0 && <p className="text-sm text-muted-foreground">Sin documentos completados todavía.</p>}
            {completados.map((c) => (
              <Card key={c.id}>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.title}</p>
                    <p className="text-xs text-muted-foreground">Completado {c.at ? formatMX(c.at, "d MMM yyyy") : ""}</p>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1" disabled={busyId === c.id} onClick={() => openFile(c.id, "signed")}>
                    <Download className="h-3.5 w-3.5" /> Descargar firmado
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {tab === "mi_firma" && <div className="max-w-xl"><MySignatureCard /></div>}
      </div>

      <SendToSignDialog open={sendOpen} onClose={() => setSendOpen(false)} onSent={refresh} />
    </AppLayout>
  );
}
