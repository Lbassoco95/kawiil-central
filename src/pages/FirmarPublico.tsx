import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, PenTool, CheckCircle2, XCircle, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/esign/SignaturePad";
import { invokeEsign, type EsignError } from "@/lib/esign";
import { PdfPages } from "@/components/esign/PdfPages";
import type { SignField } from "@/lib/esignPdf";

interface GetResponse {
  request: { id: string; title: string; message: string | null; file_name: string; status: string; created_by_name: string; expires_at: string };
  signer: { name: string; email: string; status: string; signed_at: string | null; internal: boolean; can_sign: boolean; fields?: SignField[] };
  progress: Array<{ name: string; status: string }>;
  document_url: string | null;
  saved_signature_url: string | null;
}

/**
 * /firmar/:token — firma de un documento (externos por link; internos con sesión).
 * Ruta pública: el control de acceso lo hace la Edge Function `esign`.
 */
export default function FirmarPublico() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<GetResponse | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [png, setPng] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [useSaved, setUseSaved] = useState(true);
  const [done, setDone] = useState<"signed" | "declined" | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await invokeEsign<GetResponse>({ action: "get", token });
      setData(r);
      setError(null);
    } catch (e) {
      const err = e as EsignError;
      setError({ message: err.message, code: err.code });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const sign = async () => {
    setBusy(true);
    try {
      const saved = !!data?.saved_signature_url && useSaved;
      await invokeEsign({ action: "sign", token, consent, use_saved: saved, signature_png: saved ? undefined : png });
      setDone("signed");
      toast.success("Documento firmado");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo firmar");
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await invokeEsign({ action: "decline", token, reason });
      setDone("declined");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo rechazar");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <XCircle className="mx-auto h-10 w-10 text-destructive" />
          <p className="font-medium">{error?.message ?? "No se pudo cargar el documento"}</p>
          {error?.code === "login_required" && (
            <Button asChild>
              <Link to={`/login?redirect=${encodeURIComponent(`/firmar/${token}`)}`}>Iniciar sesión</Link>
            </Button>
          )}
        </div>
      </div>
    );
  }

  const { request, signer } = data;
  const finished = request.status === "completed";
  const hasSaved = !!data.saved_signature_url;
  const needsDrawing = !(hasSaved && useSaved);
  const canSubmit = consent && (!needsDrawing || !!png);

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1fr_380px]">
        <div className="rounded-lg border bg-background overflow-hidden min-h-[60vh]">
          {data.document_url && signer.can_sign && (signer.fields?.length ?? 0) > 0 ? (
            <div className="h-[80vh] overflow-y-auto bg-muted/40 p-3">
              <PdfPages
                source={{ url: data.document_url }}
                mode="view"
                fields={(signer.fields ?? []).map((f, i) => ({
                  id: `f${i}`, ...f, color: "#0ea5e9", label: "Tu firma aquí",
                }))}
              />
            </div>
          ) : data.document_url ? (
            <iframe title={request.title} src={data.document_url} className="h-[80vh] w-full" />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">No se pudo mostrar el documento.</p>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border bg-background p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="font-semibold leading-tight">{request.title}</h1>
                <p className="text-xs text-muted-foreground">Enviado por {request.created_by_name}</p>
              </div>
              <Badge variant={finished ? "default" : "secondary"}>
                {finished ? "Firmado" : request.status === "pending" ? "Pendiente" : request.status}
              </Badge>
            </div>
            {request.message && <p className="text-sm whitespace-pre-line text-muted-foreground">{request.message}</p>}
            <div className="space-y-1 text-xs">
              {data.progress.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  {p.status === "signed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="h-3.5 w-3.5 rounded-full border" />}
                  <span>{p.name}</span>
                </div>
              ))}
            </div>
          </div>

          {done === "signed" || signer.status === "signed" ? (
            <div className="rounded-lg border bg-background p-4 space-y-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Ya firmaste este documento
              </p>
              {finished ? (
                <Button asChild variant="outline" size="sm" className="gap-1">
                  <a href={data.document_url ?? "#"} target="_blank" rel="noreferrer"><Download className="h-3.5 w-3.5" /> Descargar copia firmada</a>
                </Button>
              ) : (
                <p className="text-muted-foreground">Recibirás la copia firmada por correo cuando todos terminen.</p>
              )}
              {signer.internal && <Button asChild variant="ghost" size="sm"><Link to="/firmas">Ir a mi bandeja</Link></Button>}
            </div>
          ) : done === "declined" || signer.status === "declined" ? (
            <div className="rounded-lg border bg-background p-4 text-sm">Rechazaste firmar este documento.</div>
          ) : !signer.can_sign ? (
            <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
              {request.status === "pending" ? "Aún no es tu turno de firmar. Te avisaremos por correo." : "Esta solicitud ya no está vigente."}
            </div>
          ) : declining ? (
            <div className="rounded-lg border bg-background p-4 space-y-3">
              <p className="text-sm font-medium">Rechazar firma</p>
              <Textarea rows={3} placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeclining(false)} disabled={busy}>Volver</Button>
                <Button variant="destructive" onClick={decline} disabled={busy}>Rechazar</Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border bg-background p-4 space-y-3">
              <p className="flex items-center gap-2 text-sm font-medium"><PenTool className="h-4 w-4" /> Firmar como {signer.name}</p>
              {hasSaved && useSaved ? (
                <div className="space-y-2">
                  <div className="rounded-md border bg-white p-2"><img src={data.saved_signature_url!} alt="Mi firma" className="mx-auto max-h-24" /></div>
                  <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setUseSaved(false)}>Usar otra firma</Button>
                </div>
              ) : (
                <SignaturePad onChange={setPng} defaultTypedName={signer.name} />
              )}
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                Declaro que revisé el documento y acepto firmarlo electrónicamente. Reconozco que mi firma, correo, fecha, hora e IP quedarán registrados como evidencia.
              </label>
              <div className="flex justify-between gap-2">
                <Button variant="ghost" onClick={() => setDeclining(true)} disabled={busy}>Rechazar</Button>
                <Button onClick={sign} disabled={!canSubmit || busy}>
                  {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Firmar documento
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
