import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  parseComunicadosFromRaw,
  parseNotificacionesFromRaw,
  type SatgoComunicadoItem,
  type SatgoNotificacionItem,
} from "@/lib/satgoBuzonParse";
import { ExternalLink, Inbox, Megaphone } from "lucide-react";

type Kind = "buzon_comunicados" | "buzon_notificaciones";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: Kind;
  rawResponse: unknown;
  consultedAt?: string | null;
}

function ComunicadoRow({ item }: { item: SatgoComunicadoItem }) {
  return (
    <li className="rounded-md border border-border/60 bg-background/50 p-3 space-y-1.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground leading-snug">{item.titulo}</p>
        {item.esLeido === false ? (
          <Badge className="text-[10px] bg-amber-500/15 text-amber-900 dark:text-amber-200 shrink-0">
            Sin leer
          </Badge>
        ) : item.esLeido === true ? (
          <Badge variant="secondary" className="text-[10px] shrink-0">
            Leído
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {item.fechaComunicado ? <span>Fecha: {item.fechaComunicado}</span> : null}
        {item.id ? (
          <span>
            Id: <code className="text-[10px]">{item.id}</code>
          </span>
        ) : null}
      </div>
      {item.enlace ? (
        <Button type="button" variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" asChild>
          <a href={item.enlace} target="_blank" rel="noopener noreferrer">
            Abrir acuse en SAT
            <ExternalLink className="h-3 w-3" />
          </a>
        </Button>
      ) : (
        <p className="text-[10px] text-muted-foreground">Sin enlace de acuse en la respuesta SATgo.</p>
      )}
    </li>
  );
}

function NotificacionRow({ item }: { item: SatgoNotificacionItem }) {
  return (
    <li className="rounded-md border border-border/60 bg-background/50 p-3 space-y-1.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground leading-snug">
          {item.acto || item.folio || "Notificación SAT"}
        </p>
        <Badge
          variant={item.grupo === "pendientes" ? "destructive" : "secondary"}
          className="text-[10px] shrink-0"
        >
          {item.grupo === "pendientes" ? "Pendiente" : "Notificada"}
        </Badge>
      </div>
      <dl className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
        {item.folio ? (
          <div>
            <dt className="inline text-muted-foreground/80">Folio: </dt>
            <dd className="inline font-medium text-foreground">{item.folio}</dd>
          </div>
        ) : null}
        {item.fecha ? (
          <div>
            <dt className="inline text-muted-foreground/80">Fecha: </dt>
            <dd className="inline">{item.fecha}</dd>
          </div>
        ) : null}
        {item.autoridad ? (
          <div className="sm:col-span-2">
            <dt className="inline text-muted-foreground/80">Autoridad: </dt>
            <dd className="inline">{item.autoridad}</dd>
          </div>
        ) : null}
        {item.pdfFileName ? (
          <div className="sm:col-span-2">
            <dt className="inline text-muted-foreground/80">PDF: </dt>
            <dd className="inline">
              {item.pdfFileName}
              {item.pdfDescargado ? " · descargado" : " · metadata (sin PDF en esta consulta)"}
            </dd>
          </div>
        ) : null}
      </dl>
    </li>
  );
}

export function SatgoBuzonDetailDialog({
  open,
  onOpenChange,
  kind,
  rawResponse,
  consultedAt,
}: Props) {
  const isComunicados = kind === "buzon_comunicados";
  const comunicados = isComunicados ? parseComunicadosFromRaw(rawResponse) : [];
  const notifs = !isComunicados ? parseNotificacionesFromRaw(rawResponse) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {isComunicados ? (
              <Megaphone className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Inbox className="h-4 w-4 text-muted-foreground" />
            )}
            {isComunicados ? "Comunicados del buzón" : "Notificaciones del buzón"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Detalle de la última consulta SATgo
            {consultedAt
              ? ` · ${new Date(consultedAt).toLocaleString("es-MX")}`
              : ""}
            . Cada ítem muestra lo que devolvió el SAT (título, fechas, folio, autoridad
            {isComunicados ? " y enlace al acuse" : ""}).
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto pr-1 -mr-1 flex-1 min-h-0">
          {isComunicados ? (
            comunicados.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No hay comunicados en esta consulta.
              </p>
            ) : (
              <ul className="space-y-2">
                {comunicados.map((c, i) => (
                  <ComunicadoRow key={c.id ?? `${c.titulo}-${i}`} item={c} />
                ))}
              </ul>
            )
          ) : notifs && notifs.all.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No hay notificaciones en esta consulta.
            </p>
          ) : notifs ? (
            <div className="space-y-4">
              {notifs.pendientes.length > 0 ? (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-foreground">
                    Pendientes ({notifs.pendientes.length})
                  </h4>
                  <ul className="space-y-2">
                    {notifs.pendientes.map((n, i) => (
                      <NotificacionRow key={`p-${n.folio ?? i}`} item={n} />
                    ))}
                  </ul>
                </div>
              ) : null}
              {notifs.notificadas.length > 0 ? (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-foreground">
                    Notificadas ({notifs.notificadas.length})
                  </h4>
                  <ul className="space-y-2">
                    {notifs.notificadas.map((n, i) => (
                      <NotificacionRow key={`n-${n.folio ?? i}`} item={n} />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
