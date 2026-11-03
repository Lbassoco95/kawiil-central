import { Sparkles, ShieldQuestion, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CandidateConsent } from "@/lib/privacyNotice";

/** RF-04: indica si el candidato autorizó conservar sus datos en la base de talentos. */
export function TalentPoolBadge({
  consent,
  compact = false,
  className,
}: {
  consent: CandidateConsent | undefined;
  compact?: boolean;
  className?: string;
}) {
  const when = consent
    ? new Date(consent.consented_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })
    : null;
  let Icon = ShieldQuestion;
  let label = "Sin registro de consentimiento";
  let title = "Postulación anterior al aviso de privacidad o alta manual: no hay consentimiento registrado.";
  let tone = "border-border bg-muted/40 text-muted-foreground";
  if (consent?.talent_pool_accepted) {
    Icon = Sparkles;
    label = "Base de talentos";
    title = `Autorizó conservar sus datos para futuras vacantes · ${when} · aviso ${consent.notice_version}`;
    tone = "border-emerald-200 bg-emerald-50 text-emerald-700";
  } else if (consent) {
    Icon = ShieldCheck;
    label = "Solo este proceso";
    title = `No autorizó base de talentos: no contactar para otras vacantes · ${when} · aviso ${consent.notice_version}`;
    tone = "border-amber-200 bg-amber-50 text-amber-700";
  }
  return (
    <Badge variant="outline" title={title} className={cn("gap-1 text-[10px] font-normal", tone, className)}>
      <Icon className="h-3 w-3" />
      {compact ? (consent?.talent_pool_accepted ? "Talentos" : consent ? "Solo proceso" : "Sin registro") : label}
    </Badge>
  );
}
