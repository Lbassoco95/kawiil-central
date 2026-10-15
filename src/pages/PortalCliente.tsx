import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, ChevronDown, Circle, Download, FileText, Loader2, Lock, Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/functions-js";
import { formatDateMX } from "@/lib/dateUtils";
import { LAWSUIT_TYPE_OPTIONS, statusMeta } from "@/lib/lawsuits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface PortalLawsuit {
  id: string;
  name: string;
  lawsuit_type: string | null;
  case_number: string | null;
  court: string | null;
  status: string;
  current_stage: string | null;
  filed_date: string | null;
  next_hearing_date: string | null;
  next_deadline_date: string | null;
  next_deadline_note: string | null;
  stages: { label: string; completed: boolean; completed_at: string | null }[];
  entries: { entry_date: string; content: string }[];
  documents: { id: string; name: string; size: number | null; created_at: string; url: string }[];
}

interface PortalData {
  client_name: string | null;
  project_name: string;
  lawsuits: PortalLawsuit[];
}

const codeStorageKey = (token: string) => `portal-code:${token}`;

/**
 * /portal/:token — consulta del cliente (solo lectura). Ruta pública: el control de acceso
 * (token + código) lo hace la Edge Function `client-portal`.
 */
export default function PortalCliente() {
  const { token } = useParams<{ token: string }>();
  const [code, setCode] = useState("");
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (c: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      const { data: res, error: err } = await supabase.functions.invoke<PortalData & { error?: string }>(
        "client-portal",
        { body: { token, code: c } },
      );
      if (err) {
        let message = "No se pudo cargar la información";
        if (err instanceof FunctionsHttpError) {
          try {
            const j = await err.context.json();
            if (j?.error) message = j.error;
          } catch {
            /* cuerpo no JSON */
          }
        }
        try {
          sessionStorage.removeItem(codeStorageKey(token));
        } catch {
          /* almacenamiento no disponible */
        }
        setData(null);
        setError(message);
      } else if (res) {
        setData(res);
        try {
          sessionStorage.setItem(codeStorageKey(token), c);
        } catch {
          /* almacenamiento no disponible */
        }
      }
      setLoading(false);
    },
    [token],
  );

  // Si ya se ingresó el código en esta pestaña, se recarga sin volver a pedirlo.
  useEffect(() => {
    if (!token) return;
    try {
      const saved = sessionStorage.getItem(codeStorageKey(token));
      if (saved) void load(saved);
    } catch {
      /* almacenamiento no disponible */
    }
  }, [token, load]);

  if (!data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-lg font-semibold">Consulta de tu asunto</h1>
            </div>
            <p className="text-sm text-muted-foreground">Ingresa el código de 6 dígitos que te compartió Kawiil.</p>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (/^\d{6}$/.test(code)) void load(code);
              }}
            >
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className="text-center text-xl tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ver mi asunto"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
        <header className="space-y-1">
          {data.client_name && <p className="text-xs text-muted-foreground">{data.client_name}</p>}
          <h1 className="text-xl font-semibold">{data.project_name}</h1>
          <p className="text-xs text-muted-foreground">
            {data.lawsuits.length === 0
              ? "Por ahora no hay asuntos para mostrar."
              : `${data.lawsuits.length} asunto${data.lawsuits.length === 1 ? "" : "s"} en seguimiento`}
          </p>
        </header>

        {data.lawsuits.map((l, i) => (
          <LawsuitSection key={l.id} lawsuit={l} defaultOpen={data.lawsuits.length === 1 || i === 0} />
        ))}

        <p className="pt-2 text-center text-[11px] text-muted-foreground">
          Información de solo lectura compartida por Kawiil. Para cualquier duda, contacta a tu responsable.
        </p>
      </div>
    </div>
  );
}

function LawsuitSection({ lawsuit, defaultOpen }: { lawsuit: PortalLawsuit; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { stages } = lawsuit;
  const status = statusMeta(lawsuit.status, lawsuit.lawsuit_type);
  const typeLabel = LAWSUIT_TYPE_OPTIONS.find((t) => t.value === lawsuit.lawsuit_type)?.label;
  const done = stages.filter((s) => s.completed).length;
  const percent = stages.length > 0 ? Math.round((done / stages.length) * 100) : 0;
  const currentLabel = stages.find((s) => !s.completed)?.label ?? lawsuit.current_stage;

  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          className="flex w-full items-start justify-between gap-3 p-4 text-left"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <div className="min-w-0 space-y-1.5">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Scale className="h-4 w-4 shrink-0" /> <span className="break-words">{lawsuit.name}</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className={status.className}>
                {status.label}
              </Badge>
              {typeLabel && <Badge variant="outline">{typeLabel}</Badge>}
              {lawsuit.case_number && <span>Exp. {lawsuit.case_number}</span>}
              {lawsuit.court && <span>· {lawsuit.court}</span>}
            </div>
            <p className="text-xs text-muted-foreground">
              Etapa actual: <span className="font-medium text-foreground">{currentLabel ?? "Concluido"}</span>
              {stages.length > 0 && ` · ${percent}%`}
            </p>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="space-y-4 border-t px-4 pb-4 pt-3">
            {stages.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                  <span>
                    {done} de {stages.length} etapas
                  </span>
                  <span>{percent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
                </div>
              </div>
            )}

            {(lawsuit.next_hearing_date || lawsuit.next_deadline_date) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {lawsuit.next_hearing_date && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" /> Próxima audiencia: {formatDateMX(lawsuit.next_hearing_date)}
                  </span>
                )}
                {lawsuit.next_deadline_date && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {lawsuit.next_deadline_note ? `${lawsuit.next_deadline_note}: ` : "Próximo plazo: "}
                    {formatDateMX(lawsuit.next_deadline_date)}
                  </span>
                )}
              </div>
            )}

            {stages.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Avance</h3>
                <ul className="space-y-1.5">
                  {stages.map((s, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      {s.completed ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                      ) : (
                        <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                      )}
                      <span
                        className={s.completed ? "text-muted-foreground" : s.label === currentLabel ? "font-medium" : ""}
                      >
                        {s.label}
                      </span>
                      {s.completed_at && (
                        <span className="ml-auto text-[11px] text-muted-foreground">{formatDateMX(s.completed_at)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-medium">Novedades</h3>
              {lawsuit.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aún no hay novedades para mostrar.</p>
              ) : (
                <ul className="space-y-2">
                  {lawsuit.entries.map((e, i) => (
                    <li key={i} className="rounded-lg border p-3">
                      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{formatDateMX(e.entry_date)}</p>
                      <p className="whitespace-pre-wrap text-sm">{e.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">Documentos</h3>
              {lawsuit.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aún no hay documentos compartidos.</p>
              ) : (
                <ul className="divide-y divide-border/50 rounded-lg border">
                  {lawsuit.documents.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{d.name}</p>
                        <p className="text-[11px] text-muted-foreground">{formatDateMX(d.created_at)}</p>
                      </div>
                      <Button asChild size="sm" variant="outline" className="h-7">
                        <a href={d.url} download={d.name}>
                          <Download className="mr-1 h-3.5 w-3.5" /> Descargar
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
