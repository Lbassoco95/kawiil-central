import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Mic, PhoneOff } from "lucide-react";
import { useSwitchboardCalls, type CallFilters } from "@/hooks/useConmutador";
import {
  CELULA_CODES,
  CELULA_LABELS,
  formatFechaHora,
  severityEmoji,
  urgenciaBadgeVariant,
  URGENCIA_LABELS,
  type SwitchboardCall,
} from "@/lib/conmutador";

export function CallInbox() {
  const [filters, setFilters] = useState<CallFilters>({ celula: "all", urgencia: "all" });
  const { data: calls, isLoading } = useSwitchboardCalls(filters);
  const [selected, setSelected] = useState<SwitchboardCall | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.celula}
          onValueChange={(v) => setFilters((f) => ({ ...f, celula: v as CallFilters["celula"] }))}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Célula" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las células</SelectItem>
            {CELULA_CODES.map((c) => (
              <SelectItem key={c} value={c}>
                {c} · {CELULA_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.urgencia}
          onValueChange={(v) => setFilters((f) => ({ ...f, urgencia: v as CallFilters["urgencia"] }))}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Urgencia" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda urgencia</SelectItem>
            <SelectItem value="urgent">🔴 Urgente</SelectItem>
            <SelectItem value="medium">🟡 Media</SelectItem>
            <SelectItem value="standard">🟢 Estándar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !calls || calls.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Aún no hay llamadas registradas con estos filtros.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Folio</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Urgencia</TableHead>
                    <TableHead>Célula</TableHead>
                    <TableHead>Llamante</TableHead>
                    <TableHead>Enlaces</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(c)}
                    >
                      <TableCell className="font-mono text-xs">{c.folio ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatFechaHora(c.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={urgenciaBadgeVariant(c.urgencia)}>
                          {severityEmoji(c.urgencia)} {URGENCIA_LABELS[c.urgencia]}
                        </Badge>
                        {c.ruta === "urgente" && !c.transferido && (
                          <span title="Transferencia no conectada">
                            <PhoneOff className="ml-1 inline h-3.5 w-3.5 text-destructive" />
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.celula ? `${c.celula} · ${CELULA_LABELS[c.celula]}` : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.llamante || "—"}
                        {c.empresa && (
                          <span className="text-muted-foreground"> · {c.empresa}</span>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          {c.transcript_url && (
                            <Button asChild size="icon" variant="ghost" className="h-7 w-7">
                              <a href={c.transcript_url} target="_blank" rel="noreferrer" title="Transcripción">
                                <FileText className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                          {c.recording_url && (
                            <Button asChild size="icon" variant="ghost" className="h-7 w-7">
                              <a href={c.recording_url} target="_blank" rel="noreferrer" title="Grabación">
                                <Mic className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CallDetailDialog call={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function CallDetailDialog({ call, onClose }: { call: SwitchboardCall | null; onClose: () => void }) {
  return (
    <Dialog open={!!call} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {call && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span>{severityEmoji(call.urgencia)}</span>
                <span className="font-mono text-sm">{call.folio}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Célula" value={call.celula ? `${call.celula} · ${CELULA_LABELS[call.celula]}` : "—"} />
                <Field label="Urgencia" value={URGENCIA_LABELS[call.urgencia]} />
                <Field label="Llamante" value={call.llamante || "—"} />
                <Field label="Empresa" value={call.empresa || "—"} />
                <Field label="Teléfono" value={call.telefono || "—"} />
                <Field label="Correo" value={call.correo || "—"} />
                <Field label="¿Cliente?" value={call.es_cliente == null ? "—" : call.es_cliente ? "Sí" : "Primer contacto"} />
                <Field label="Transferido" value={call.transferido ? "Sí" : "No"} />
                {call.cartera_estado && (
                  <Field label="Cartera" value={call.cartera_estado === "vencido" ? "⚠️ Vencido" : "Al día"} />
                )}
              </div>
              {call.brief && (
                <div>
                  <p className="mb-1 font-medium text-muted-foreground">Brief</p>
                  <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{call.brief}</pre>
                </div>
              )}
              <div className="flex gap-2">
                {call.transcript_url && (
                  <Button asChild size="sm" variant="outline">
                    <a href={call.transcript_url} target="_blank" rel="noreferrer">
                      <FileText className="mr-1.5 h-4 w-4" /> Transcripción
                    </a>
                  </Button>
                )}
                {call.recording_url && (
                  <Button asChild size="sm" variant="outline">
                    <a href={call.recording_url} target="_blank" rel="noreferrer">
                      <Mic className="mr-1.5 h-4 w-4" /> Grabación
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}
