import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { RefreshCw, Link2, RadioTower, Unlink, FileClock } from "lucide-react";
import { formatMX } from "@/lib/dateUtils";
import {
  useBuhoMonitoring,
  jurisdictionToEntidad,
  type BuhoCatalogItem,
} from "@/hooks/useBuhoMonitoring";

interface Props {
  projectId: string;
  jurisdiction?: string | null;
  defaultExpediente?: string | null;
  defaultNombre?: string | null;
  defaultAsunto?: string | null;
}

const ENTIDAD_OPTIONS = [
  { value: "cdmx", label: "Ciudad de México" },
  { value: "estado_mexico", label: "Estado de México" },
  { value: "federal", label: "Federal" },
];

export function BuhoMonitoringCard({ projectId, jurisdiction, defaultExpediente, defaultNombre, defaultAsunto }: Props) {
  const { link, acuerdos, isLoading, vincular, sincronizar, desvincular, getJuzgados } =
    useBuhoMonitoring(projectId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [entidad, setEntidad] = useState(jurisdictionToEntidad(jurisdiction) || "");
  const [expediente, setExpediente] = useState(defaultExpediente || "");
  const [nombre, setNombre] = useState(defaultNombre || "");
  const [asunto, setAsunto] = useState(defaultAsunto || "");
  const [notas, setNotas] = useState("");
  const [tipoExpediente, setTipoExpediente] = useState("");
  const [juzgadoId, setJuzgadoId] = useState("");
  const [juzgados, setJuzgados] = useState<BuhoCatalogItem[]>([]);
  const [loadingJuzgados, setLoadingJuzgados] = useState(false);

  const loadJuzgados = async (ent: string) => {
    if (!ent) return;
    setLoadingJuzgados(true);
    try {
      const list = await getJuzgados(ent);
      setJuzgados(Array.isArray(list) ? list : []);
    } catch {
      setJuzgados([]);
    } finally {
      setLoadingJuzgados(false);
    }
  };

  const openWizard = () => {
    const ent = jurisdictionToEntidad(jurisdiction) || "";
    setEntidad(ent);
    setExpediente(defaultExpediente || "");
    setNombre(defaultNombre || "");
    setAsunto(defaultAsunto || "");
    setNotas("");
    setTipoExpediente("");
    setJuzgadoId("");
    setJuzgados([]);
    setDialogOpen(true);
    if (ent) loadJuzgados(ent);
  };

  const submit = () => {
    vincular.mutate(
      {
        entidad,
        expediente,
        juzgado_id: Number(juzgadoId),
        tipo_expediente: entidad === "federal" ? tipoExpediente || undefined : undefined,
        nombre: nombre || undefined,
        asunto: asunto || undefined,
        notas: notas || undefined,
      },
      { onSuccess: () => setDialogOpen(false) },
    );
  };

  const nuevos = acuerdos.filter((a) => !a.seen).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <RadioTower className="h-4 w-4 text-primary" />
          Monitoreo Búho Legal
          {nuevos > 0 && <Badge className="text-[10px]">{nuevos} nuevo(s)</Badge>}
        </CardTitle>
        {link ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => sincronizar.mutate()} disabled={sincronizar.isPending}>
              <RefreshCw className={`h-3 w-3 mr-1 ${sincronizar.isPending ? "animate-spin" : ""}`} /> Sincronizar
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => desvincular.mutate()} disabled={desvincular.isPending}>
              <Unlink className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={openWizard}>
            <Link2 className="h-3 w-3 mr-1" /> Vincular monitoreo
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Cargando...</p>
        ) : !link ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Vincula este expediente con Búho Legal para recibir automáticamente los acuerdos publicados por el juzgado.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <Badge variant="secondary" className="text-[10px]">{link.entidad}</Badge>
              <span>Exp. {link.expediente}</span>
              {link.last_synced_at && (
                <span className="ml-auto">Última sync: {formatMX(new Date(link.last_synced_at), "dd MMM yyyy HH:mm")}</span>
              )}
            </div>
            {acuerdos.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-lg">
                Sin acuerdos aún. Se sincronizan automáticamente cada día; usa «Sincronizar» para forzar ahora.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                {acuerdos.map((a) => (
                  <div key={a.id} className={`rounded-md border px-3 py-2 ${a.seen ? "border-border/50" : "border-primary/40 bg-primary/5"}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <FileClock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium">{a.tipo_acuerdo || "Actuación"}</span>
                      {a.fecha_acuerdo && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {formatMX(new Date(a.fecha_acuerdo), "dd MMM yyyy")}
                        </span>
                      )}
                    </div>
                    {a.contenido && <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{a.contenido}</p>}
                    {a.juzgado && <p className="mt-1 text-[11px] text-muted-foreground/80">{a.juzgado}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Wizard de vinculación */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Vincular con monitoreo Búho Legal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Entidad / rama *</Label>
              <Select
                value={entidad}
                onValueChange={(v) => {
                  setEntidad(v);
                  setJuzgadoId("");
                  loadJuzgados(v);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Seleccionar entidad" /></SelectTrigger>
                <SelectContent>
                  {ENTIDAD_OPTIONS.map((e) => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>No. de expediente *</Label>
              <Input value={expediente} onChange={(e) => setExpediente(e.target.value)} placeholder="123/2025" />
            </div>

            <div className="space-y-2">
              <Label>Juzgado *</Label>
              <SearchableSelect
                options={juzgados.map((j) => ({ value: String(j.id), label: j.nombre }))}
                value={juzgadoId}
                onValueChange={setJuzgadoId}
                placeholder={loadingJuzgados ? "Cargando juzgados..." : "Seleccionar juzgado"}
                searchPlaceholder="Buscar juzgado..."
              />
            </div>

            {entidad === "federal" && (
              <div className="space-y-2">
                <Label>Tipo de expediente (federal)</Label>
                <Input value={tipoExpediente} onChange={(e) => setTipoExpediente(e.target.value)} placeholder="Ej: 60 (amparo indirecto)" />
              </div>
            )}

            <div className="space-y-2">
              <Label>Nombre / referencia</Label>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Referencia interna" />
            </div>

            <div className="space-y-2">
              <Label>Asunto</Label>
              <Input value={asunto} onChange={(e) => setAsunto(e.target.value)} placeholder="Asunto" />
            </div>

            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={submit} disabled={!entidad || !expediente || !juzgadoId || vincular.isPending}>
                {vincular.isPending ? "Vinculando..." : "Vincular"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
