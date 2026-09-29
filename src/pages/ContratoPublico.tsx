import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ContractWizard } from "@/components/contracts/ContractWizard";
import {
  fetchContractByToken,
  patchContractByToken,
} from "@/hooks/useContractEngagements";
import type { ContractAnswers, ContractPackageKind } from "@/types/contracts";
import { PACKAGE_KIND_LABEL } from "@/types/contracts";
import { Badge } from "@/components/ui/badge";

/**
 * Vista pública del cliente: /contrato/:token
 * Sin login; misma verdad que el wizard staff (D2).
 */
export default function ContratoPublico() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [packageKind, setPackageKind] = useState<ContractPackageKind>("backoffice_pm");
  const [status, setStatus] = useState<string>("");
  const [answers, setAnswers] = useState<ContractAnswers>({});
  const [updatedByRole, setUpdatedByRole] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [signed, setSigned] = useState(false);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const data = await fetchContractByToken(token);
      if (!data?.ok) {
        setError(String(data?.error || "Link inválido o expirado"));
        setLoading(false);
        return;
      }
      const eng = data.engagement as Record<string, unknown>;
      setPackageKind(eng.package_kind as ContractPackageKind);
      setStatus(String(eng.status || ""));
      setAnswers((eng.answers as ContractAnswers) || {});
      setUpdatedByRole((eng.answers_updated_by_role as string) || null);
      setUpdatedAt((eng.answers_updated_at as string) || null);
      setSigned(!!eng.signed_confirmed_at || eng.status === "signed_confirmed");
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el contrato");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [reload]);

  const onChange = (patch: ContractAnswers) => {
    setAnswers((prev) => ({ ...prev, ...patch }));
  };

  const save = async () => {
    if (!token || signed) return;
    setSaving(true);
    try {
      const res = await patchContractByToken(token, answers, "client");
      setAnswers((res.answers as ContractAnswers) || answers);
      setUpdatedByRole((res.answers_updated_by_role as string) || "client");
      setUpdatedAt((res.answers_updated_at as string) || null);
      setStatus(String(res.status || status));
      toast.success("Guardado");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#0f172a] text-white">
        <div className="flex items-center gap-2 text-sm text-white/80">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando tu contrato…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#0f172a] px-4">
        <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-xl">
          <h1 className="text-lg font-semibold">Link no disponible</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-100">
      <div className="mx-auto max-w-xl px-4 pb-16 pt-10">
        <div className="mb-6 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200/90">Kawiil</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Integración de expediente contractual</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge className="bg-white/15 text-white border-white/20">
              {PACKAGE_KIND_LABEL[packageKind]}
            </Badge>
            {status ? (
              <Badge variant="outline" className="border-white/30 text-white/90">
                {status}
              </Badge>
            ) : null}
          </div>
          <p className="mt-3 text-sm text-white/75">
            Completa estos datos con calma. El equipo Kawiil puede ayudarte en paralelo; todo lo que escriban
            aparecerá aquí.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-xl sm:p-7">
          {signed ? (
            <p className="text-sm text-emerald-700">
              Este contrato ya fue confirmado como firmado. Si necesitas un cambio, Kawiil emitirá una adenda
              nueva (el documento original no se modifica).
            </p>
          ) : (
            <ContractWizard
              packageKind={packageKind}
              answers={answers}
              updatedByRole={updatedByRole}
              updatedAt={updatedAt}
              mode="client"
              saving={saving}
              onChange={onChange}
              onSave={() => void save()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
