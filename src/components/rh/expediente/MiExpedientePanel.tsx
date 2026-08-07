import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, FileText, Trash2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  DOC_STATUS_LABEL,
  DOC_STATUS_STYLE,
  EXPEDIENTE_DOC_TYPES,
  expedienteProgress,
  type EmployeeDocument,
} from "@/lib/expediente";
import {
  useEmployeeProfile,
  useUpsertEmployeeProfile,
  useEmployeeDocuments,
  useUploadEmployeeDocument,
  useDeleteEmployeeDocument,
  getExpedienteSignedUrl,
} from "@/hooks/useExpediente";
import { WelcomeChecklist } from "./WelcomeChecklist";
import { EmployeeAbsenceHistory } from "./EmployeeAbsenceHistory";
import { toast } from "sonner";

const EMPTY = {
  rfc: "", curp: "", nss: "", clabe: "", bank_name: "", birth_date: "",
  address: "", postal_code: "", emergency_contact_name: "", emergency_contact_phone: "",
};

export function MiExpedientePanel() {
  const { user } = useAuth();
  const { data: profile, isLoading } = useEmployeeProfile(user?.id ?? null);
  const { data: docs = [] } = useEmployeeDocuments(user?.id ?? null);
  const upsert = useUpsertEmployeeProfile();

  const [form, setForm] = useState(EMPTY);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current || isLoading) return;
    loadedRef.current = true;
    if (profile) {
      setForm({
        rfc: profile.rfc ?? "", curp: profile.curp ?? "", nss: profile.nss ?? "",
        clabe: profile.clabe ?? "", bank_name: profile.bank_name ?? "",
        birth_date: profile.birth_date ?? "", address: profile.address ?? "",
        postal_code: profile.postal_code ?? "",
        emergency_contact_name: profile.emergency_contact_name ?? "",
        emergency_contact_phone: profile.emergency_contact_phone ?? "",
      });
    }
  }, [profile, isLoading]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const progress = expedienteProgress(docs);
  const docByType = new Map(docs.map((d) => [d.doc_type, d]));

  function saveProfile() {
    upsert.mutate({
      rfc: form.rfc.trim() || null,
      curp: form.curp.trim() || null,
      nss: form.nss.trim() || null,
      clabe: form.clabe.trim() || null,
      bank_name: form.bank_name.trim() || null,
      birth_date: form.birth_date || null,
      address: form.address.trim() || null,
      postal_code: form.postal_code.trim() || null,
      emergency_contact_name: form.emergency_contact_name.trim() || null,
      emergency_contact_phone: form.emergency_contact_phone.trim() || null,
    });
  }

  return (
    <div className="space-y-5">
      {/* Avance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>Avance del expediente</span>
            <span className="text-muted-foreground">{progress.verified}/{progress.total} verificados</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {progress.uploaded}/{progress.total} documentos cargados · {progress.verified} verificados por RH
          </p>
        </CardContent>
      </Card>

      {/* Lista de bienvenida */}
      {user?.id && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Mi lista de bienvenida</CardTitle></CardHeader>
          <CardContent><WelcomeChecklist userId={user.id} /></CardContent>
        </Card>
      )}

      {/* Datos fiscales y personales */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Datos fiscales y personales</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="RFC"><Input value={form.rfc} onChange={set("rfc")} className="h-8 text-sm" /></Field>
            <Field label="CURP"><Input value={form.curp} onChange={set("curp")} className="h-8 text-sm" /></Field>
            <Field label="NSS (IMSS)"><Input value={form.nss} onChange={set("nss")} className="h-8 text-sm" /></Field>
            <Field label="Fecha de nacimiento"><Input type="date" value={form.birth_date} onChange={set("birth_date")} className="h-8 text-sm" /></Field>
            <Field label="CLABE interbancaria"><Input value={form.clabe} onChange={set("clabe")} className="h-8 text-sm" /></Field>
            <Field label="Banco"><Input value={form.bank_name} onChange={set("bank_name")} className="h-8 text-sm" /></Field>
            <Field label="Domicilio" className="sm:col-span-2"><Input value={form.address} onChange={set("address")} className="h-8 text-sm" /></Field>
            <Field label="Código postal"><Input value={form.postal_code} onChange={set("postal_code")} className="h-8 text-sm" /></Field>
            <Field label="Contacto de emergencia"><Input value={form.emergency_contact_name} onChange={set("emergency_contact_name")} className="h-8 text-sm" /></Field>
            <Field label="Tel. de emergencia"><Input value={form.emergency_contact_phone} onChange={set("emergency_contact_phone")} className="h-8 text-sm" /></Field>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={saveProfile} disabled={upsert.isPending}>
              {upsert.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Guardar datos
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Documentos */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Documentos</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {EXPEDIENTE_DOC_TYPES.map((t) => (
            <DocRow key={t.key} docType={t.key} label={t.label} hint={t.hint} doc={docByType.get(t.key)} />
          ))}
        </CardContent>
      </Card>

      {/* Mis solicitudes y permisos */}
      {user?.id && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Mis solicitudes y permisos</CardTitle></CardHeader>
          <CardContent><EmployeeAbsenceHistory userId={user.id} /></CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function DocRow({ docType, label, hint, doc }: { docType: string; label: string; hint?: string; doc?: EmployeeDocument }) {
  const upload = useUploadEmployeeDocument();
  const del = useDeleteEmployeeDocument();
  const fileRef = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState(false);

  async function view() {
    if (!doc) return;
    setOpening(true);
    const url = await getExpedienteSignedUrl(doc.file_path);
    setOpening(false);
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("No se pudo abrir el documento.");
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {doc ? (
            <Badge variant="outline" className={cn("text-[10px]", DOC_STATUS_STYLE[doc.status])}>
              {doc.status === "verified" && <CheckCircle2 className="mr-1 h-3 w-3" />}
              {DOC_STATUS_LABEL[doc.status]}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">Pendiente</Badge>
          )}
        </div>
        {hint && !doc && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        {doc?.status === "rejected" && doc.note && (
          <p className="text-[11px] text-red-600">Motivo: {doc.note}</p>
        )}
      </div>

      {doc && (
        <Button size="sm" variant="outline" onClick={view} disabled={opening}>
          {opening ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1.5 h-3.5 w-3.5" />}
          Ver
        </Button>
      )}
      <Button size="sm" variant={doc ? "ghost" : "default"} onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
        {upload.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
        {doc ? "Reemplazar" : "Subir"}
      </Button>
      {doc && doc.status !== "verified" && (
        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={() => del.mutate(doc)} disabled={del.isPending}>
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
      <input
        ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate({ docType, file: f }); e.target.value = ""; }}
      />
    </div>
  );
}
