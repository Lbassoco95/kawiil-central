import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, MapPin, Ticket, ExternalLink } from "lucide-react";
import { useMisInvitaciones, type MiInvitacion } from "@/hooks/useActivityExtras";
import { formatDateMX } from "@/lib/dateUtils";

const ESTADO: Record<string, { label: string; cls: string }> = {
  si: { label: "Confirmada", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  no: { label: "Dijiste que no puedes", cls: "bg-rose-100 text-rose-800 border-rose-200" },
  pendiente: { label: "Por confirmar", cls: "bg-muted text-muted-foreground border-border" },
};

const EXTRA: Record<string, string> = {
  solicitado: "en revisión", aprobado: "aprobados", rechazado: "no aprobados",
};

function InvitacionCard({ i }: { i: MiInvitacion }) {
  const estado = ESTADO[i.confirmed] ?? ESTADO.pendiente;
  const plusLine = i.confirmed === "no"
    ? null
    : i.has_plus_one ? "Tu +1 está incluido." : "Vas sin +1.";
  return (
    <Card>
      <CardContent className="space-y-3 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">{i.activity_name}</h3>
          <Badge variant="outline" className={estado.cls}>{estado.label}</Badge>
        </div>
        <div className="space-y-1 text-sm text-muted-foreground">
          {i.event_date && (
            <p className="flex items-center gap-2"><Calendar className="h-4 w-4" />{formatDateMX(i.event_date)}</p>
          )}
          {i.event_time && (
            <p className="flex items-center gap-2"><Clock className="h-4 w-4" />{i.event_time.slice(0, 5)} h</p>
          )}
          {i.location && (
            <p className="flex items-center gap-2"><MapPin className="h-4 w-4" />{i.location}</p>
          )}
        </div>
        {i.announcement && (
          <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{i.announcement}</p>
        )}
        {(plusLine || i.extra_guests_requested > 0) && (
          <p className="text-sm">
            {plusLine}
            {i.extra_guests_requested > 0 && i.confirmed !== "no" && (
              <> {i.extra_guests_requested} {i.extra_guests_requested === 1 ? "invitado extra" : "invitados extra"}: {EXTRA[i.extra_guests_status] ?? i.extra_guests_status}.</>
            )}
          </p>
        )}
        <Button asChild size="sm" variant="outline">
          <a href={`/invitacion/${i.rsvp_token}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            {i.responded ? "Cambiar mi respuesta" : "Responder"}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

const MisInvitaciones = () => {
  const { data, isLoading } = useMisInvitaciones();
  const list = data ?? [];
  return (
    <AppLayout>
      <div className="kwv24 space-y-6 animate-fade-in">
        <PageHeader
          variant="hero"
          icon={<Ticket />}
          breadcrumb={["Kawiil OS", "Trabajo", "Mis invitaciones"]}
          title="Mis invitaciones"
          description="Tus invitaciones a los festejos y actividades del equipo."
        />
        {isLoading ? (
          <p className="py-12 text-center text-muted-foreground">Cargando...</p>
        ) : list.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Por ahora no tienes invitaciones.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {list.map((i) => <InvitacionCard key={i.attendee_id} i={i} />)}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default MisInvitaciones;
