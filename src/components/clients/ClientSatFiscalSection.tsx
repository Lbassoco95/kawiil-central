import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calculator, ExternalLink, KeyRound } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Client = Tables<"clients">;
type Project = Tables<"projects">;

interface ClientSatFiscalSectionProps {
  client: Client;
  projects: Project[];
}

export function ClientSatFiscalSection({ client, projects }: ClientSatFiscalSectionProps) {
  const navigate = useNavigate();

  const accountingProjects = useMemo(
    () =>
      projects.filter(
        (p) =>
          (p.area === "contabilidad" || p.area === "softlanding") && p.status !== "cancelado"
      ),
    [projects]
  );

  const managedByFirm = client.sat_fiel_managed_by_firm !== false;

  return (
    <section className="glass-card p-5 md:col-span-2">
      <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
        <Calculator className="h-3.5 w-3.5" />
        Constancia, opinión y 69-B (SAT)
      </h2>
      <div className="space-y-3 text-[13px] text-muted-foreground leading-relaxed">
        <p>
          En <strong className="text-foreground font-medium">Hub → Finanzas</strong> integración{" "}
          <strong className="text-foreground font-medium">Savio</strong> es para cobranza y facturación. Las consultas de{" "}
          <strong className="text-foreground font-medium">constancia de situación fiscal</strong>,{" "}
          <strong className="text-foreground font-medium">opinión de cumplimiento</strong> y{" "}
          <strong className="text-foreground font-medium">lista 69-B</strong> se ejecutan desde el{" "}
          <strong className="text-foreground font-medium">proyecto de Contabilidad</strong> del cliente (integración Moffin),
          usando el <strong className="text-foreground font-medium">RFC</strong> de esta ficha.
        </p>
        <p className="text-[12px]">
          Uso habitual en despacho: <span className="text-foreground">constancia mensual</span>,{" "}
          <span className="text-foreground">opinión semanal</span>. La app aún no programa recordatorios automáticos; puedes
          lanzar consultas cuando corresponda desde la pestaña Contabilidad del proyecto.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-muted-foreground">RFC:</span>
          {client.rfc ? (
            <code className="text-[11px] bg-muted/60 px-1.5 py-0.5 rounded">{client.rfc}</code>
          ) : (
            <span className="text-amber-700 dark:text-amber-400">Agrega el RFC en Editar cliente.</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          {managedByFirm ? (
            <Badge variant="secondary" className="text-[10px] gap-1 font-normal">
              <KeyRound className="h-3 w-3" />
              e.firma custodiada por el despacho
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] font-normal">
              e.firma no marcada como custodia del despacho
            </Badge>
          )}
        </div>
        {client.sat_fiel_location_hint ? (
          <p className="text-[12px] border-l-2 border-primary/30 pl-3">
            <span className="text-muted-foreground">Referencia interna: </span>
            <span className="text-foreground whitespace-pre-wrap">{client.sat_fiel_location_hint}</span>
          </p>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          No guardamos contraseñas ni archivos de llave en Kawiil. Si Moffin pide credenciales para descargar un PDF, usa tu
          flujo seguro habitual (por ejemplo contraseña fuera de la app).
        </p>
        {accountingProjects.length === 0 ? (
          <p className="text-[12px] text-amber-700 dark:text-amber-400">
            No hay proyecto de contabilidad (o softlanding) activo para este cliente. Activa el servicio o crea el proyecto
            para ver el panel Moffin.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {accountingProjects.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-[12px]"
                onClick={() => navigate(`/proyectos/${p.id}?tab=contabilidad`)}
              >
                Ir a consultas — {p.name}
                <ExternalLink className="h-3 w-3 opacity-70" />
              </Button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
