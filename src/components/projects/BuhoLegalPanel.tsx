import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Gavel,
  CheckCircle2,
  RefreshCw,
  Loader2,
  Link2,
  Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatMX } from "@/lib/dateUtils";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import {
  useBuhoLegal,
  type BuhoJuzgado,
  type BuhoTipoExpediente,
  type BuhoAcuerdo,
} from "@/hooks/useBuhoLegal";

interface BuhoLegalPanelProps {
  projectId: string;
  projectName: string; // para pre-llenar nombre_alerta
  numeroExpediente?: string; // si ya existe en el proyecto
}

// Slugs de Búho Legal -> nombre legible (estados, fueros y materias especiales).
const ENTIDAD_LABELS: Record<string, string> = {
  aguascalientes: "Aguascalientes",
  bc: "Baja California",
  bcs: "Baja California Sur",
  campeche: "Campeche",
  chiapas: "Chiapas",
  chihuahua: "Chihuahua",
  cdmx: "CDMX (Fuero Común)",
  coahuila: "Coahuila",
  colima: "Colima",
  durango: "Durango",
  federal: "Federal",
  guanajuato: "Guanajuato",
  guerrero: "Guerrero",
  hidalgo: "Hidalgo",
  jalisco: "Jalisco",
  mexico: "Estado de México",
  michoacan: "Michoacán",
  morelos: "Morelos",
  nayarit: "Nayarit",
  nl: "Nuevo León",
  oaxaca: "Oaxaca",
  puebla: "Puebla",
  queretaro: "Querétaro",
  qroo: "Quintana Roo",
  slp: "San Luis Potosí",
  sinaloa: "Sinaloa",
  sonora: "Sonora",
  tabasco: "Tabasco",
  tamaulipas: "Tamaulipas",
  tlaxcala: "Tlaxcala",
  veracruz: "Veracruz",
  yucatan: "Yucatán",
  zacatecas: "Zacatecas",
  juntafederal: "Junta Federal de Conciliación",
  fedcontadmin: "Tribunal Federal de Justicia Administrativa",
  federal_agrario: "Tribunales Agrarios (Federal)",
  sonoralaboral: "Tribunal Laboral (Sonora)",
  guanajuatolaboral: "Tribunal Laboral (Guanajuato)",
  slp_laboral: "Tribunal Laboral (San Luis Potosí)",
  df_local: "CDMX (Local)",
  jalisco_admin: "Tribunal Administrativo (Jalisco)",
  cdmx_admin: "Tribunal Administrativo (CDMX)",
  aguascalientes_admin: "Tribunal Administrativo (Aguascalientes)",
  veracruz_admin: "Tribunal Administrativo (Veracruz)",
  guanajuato_admin: "Tribunal Administrativo (Guanajuato)",
  michoacan_admin: "Tribunal Administrativo (Michoacán)",
  queretaro_admin: "Tribunal Administrativo (Querétaro)",
  sinaloa_admin: "Tribunal Administrativo (Sinaloa)",
  coahuila_local: "Coahuila (Local)",
  tfca: "Tribunal Federal de Conciliación y Arbitraje",
};

const ENTIDAD_OPTIONS = Object.entries(ENTIDAD_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, "es"));

// Entidades que requieren `tipo_expediente` al crear la alerta.
// Se calcula dinámicamente vía catálogo; este set es sólo un fallback inicial.

interface AlertaRow {
  id: string;
  project_id: string;
  entidad: string;
  buholegal_id: number;
  numero_expediente: string;
  nombre_alerta: string;
  juzgado_id: number | null;
  tipo_expediente_id: number | null;
  last_sync_at: string | null;
}

interface AcuerdoRow {
  id: string;
  fecha: string | null;
  actor: string | null;
  demandado: string | null;
  acuerdo: string | null;
}

export function BuhoLegalPanel({
  projectId,
  projectName,
  numeroExpediente,
}: BuhoLegalPanelProps) {
  const { user } = useAuth();
  const {
    getJuzgados,
    getTiposExpediente,
    crearAlerta,
    getAcuerdos,
    eliminarAlerta,
  } = useBuhoLegal();

  const [loadingAlerta, setLoadingAlerta] = useState(true);
  const [alerta, setAlerta] = useState<AlertaRow | null>(null);
  const [acuerdos, setAcuerdos] = useState<AcuerdoRow[]>([]);

  // ── Form (Estado A) ──
  const [entidad, setEntidad] = useState<string>("");
  const [juzgados, setJuzgados] = useState<BuhoJuzgado[]>([]);
  const [loadingJuzgados, setLoadingJuzgados] = useState(false);
  const [juzgadoId, setJuzgadoId] = useState<string>("");
  const [tipos, setTipos] = useState<BuhoTipoExpediente[]>([]);
  const [loadingTipos, setLoadingTipos] = useState(false);
  const [tipoId, setTipoId] = useState<string>("");
  const [numExpediente, setNumExpediente] = useState<string>(
    numeroExpediente || "",
  );
  const [nombreAlerta, setNombreAlerta] = useState<string>(projectName);
  const [registering, setRegistering] = useState(false);

  // ── Estado B ──
  const [syncing, setSyncing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const entidadLabel = (slug: string) => ENTIDAD_LABELS[slug] || slug;

  const loadAcuerdos = useCallback(async (alertaId: string) => {
    const { data, error } = await (supabase as any)
      .from("buholegal_acuerdos")
      .select("id, fecha, actor, demandado, acuerdo")
      .eq("alerta_id", alertaId)
      .order("fecha", { ascending: false });
    if (error) {
      toast.error("Error al cargar acuerdos: " + error.message);
      return;
    }
    setAcuerdos((data as AcuerdoRow[]) || []);
  }, []);

  const loadAlerta = useCallback(async () => {
    setLoadingAlerta(true);
    const { data, error } = await (supabase as any)
      .from("buholegal_alertas")
      .select(
        "id, project_id, entidad, buholegal_id, numero_expediente, nombre_alerta, juzgado_id, tipo_expediente_id, last_sync_at",
      )
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) {
      toast.error("Error al cargar Búho Legal: " + error.message);
      setLoadingAlerta(false);
      return;
    }
    const row = data as AlertaRow | null;
    setAlerta(row);
    if (row) await loadAcuerdos(row.id);
    setLoadingAlerta(false);
  }, [projectId, loadAcuerdos]);

  useEffect(() => {
    void loadAlerta();
  }, [loadAlerta]);

  // Pre-llenar nombre de alerta cuando cambie el proyecto y aún no se haya tocado.
  useEffect(() => {
    setNombreAlerta(projectName);
  }, [projectName]);
  useEffect(() => {
    if (numeroExpediente) setNumExpediente(numeroExpediente);
  }, [numeroExpediente]);

  // Al elegir entidad, cargar juzgados y (si aplica) tipos de expediente.
  const handleEntidadChange = useCallback(
    async (slug: string) => {
      setEntidad(slug);
      setJuzgadoId("");
      setJuzgados([]);
      setTipos([]);
      setTipoId("");
      if (!slug) return;
      setLoadingJuzgados(true);
      try {
        const list = await getJuzgados(slug);
        setJuzgados(Array.isArray(list) ? list : []);
      } catch (e) {
        toast.error(
          "No se pudieron cargar los juzgados: " +
            (e instanceof Error ? e.message : String(e)),
        );
      } finally {
        setLoadingJuzgados(false);
      }
      // Tipos de expediente: si la entidad no los usa, la API suele devolver vacío.
      setLoadingTipos(true);
      try {
        const list = await getTiposExpediente(slug);
        setTipos(Array.isArray(list) ? list : []);
      } catch {
        setTipos([]); // entidad sin tipos: silencioso
      } finally {
        setLoadingTipos(false);
      }
    },
    [getJuzgados, getTiposExpediente],
  );

  const requiereTipo = tipos.length > 0;

  const canRegister = useMemo(
    () =>
      !!entidad &&
      !!juzgadoId &&
      !!numExpediente.trim() &&
      !!nombreAlerta.trim() &&
      (!requiereTipo || !!tipoId),
    [entidad, juzgadoId, numExpediente, nombreAlerta, requiereTipo, tipoId],
  );

  const handleRegister = async () => {
    if (!canRegister || !user) return;
    setRegistering(true);
    try {
      const payload = {
        nombre_alerta: nombreAlerta.trim(),
        numero_expediente: numExpediente.trim(),
        juzgado: Number(juzgadoId),
        ...(requiereTipo && tipoId ? { tipo_expediente: Number(tipoId) } : {}),
      };
      const created = await crearAlerta(entidad, payload);
      if (!created?.id) {
        throw new Error("Búho Legal no devolvió el id de la alerta.");
      }
      const { data: inserted, error } = await (supabase as any)
        .from("buholegal_alertas")
        .insert({
          project_id: projectId,
          entidad,
          buholegal_id: created.id,
          numero_expediente: numExpediente.trim(),
          nombre_alerta: nombreAlerta.trim(),
          juzgado_id: Number(juzgadoId),
          tipo_expediente_id: requiereTipo && tipoId ? Number(tipoId) : null,
        })
        .select(
          "id, project_id, entidad, buholegal_id, numero_expediente, nombre_alerta, juzgado_id, tipo_expediente_id, last_sync_at",
        )
        .single();
      if (error) throw error;
      setAlerta(inserted as AlertaRow);
      setAcuerdos([]);
      toast.success("Expediente registrado en Búho Legal");
    } catch (e) {
      toast.error(
        "Error al registrar: " + (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setRegistering(false);
    }
  };

  const handleSync = async () => {
    if (!alerta) return;
    setSyncing(true);
    try {
      const fetched = await getAcuerdos(alerta.entidad, alerta.buholegal_id);
      const list: BuhoAcuerdo[] = Array.isArray(fetched) ? fetched : [];
      if (list.length > 0) {
        const rows = list.map((a) => ({
          alerta_id: alerta.id,
          fecha: a.fecha ?? null,
          actor: a.actor ?? null,
          demandado: a.demandado ?? null,
          acuerdo: a.acuerdo ?? null,
        }));
        const { error: upErr } = await (supabase as any)
          .from("buholegal_acuerdos")
          .upsert(rows, { onConflict: "alerta_id,fecha,acuerdo" });
        if (upErr) throw upErr;
      }
      await (supabase as any)
        .from("buholegal_alertas")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("id", alerta.id);
      await loadAcuerdos(alerta.id);
      setAlerta({ ...alerta, last_sync_at: new Date().toISOString() });
      toast.success(
        list.length > 0
          ? `Sincronización completa (${list.length} acuerdo(s))`
          : "Sin acuerdos nuevos por ahora",
      );
    } catch (e) {
      toast.error(
        "Error al sincronizar: " + (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleUnlink = async () => {
    if (!alerta) return;
    setUnlinking(true);
    try {
      // Intentar eliminar en Búho Legal; si falla, igual desvinculamos local.
      try {
        await eliminarAlerta(alerta.entidad, alerta.buholegal_id);
      } catch (e) {
        toast.warning(
          "No se pudo eliminar en Búho Legal (se desvincula localmente): " +
            (e instanceof Error ? e.message : String(e)),
        );
      }
      const { error } = await (supabase as any)
        .from("buholegal_alertas")
        .delete()
        .eq("id", alerta.id);
      if (error) throw error;
      setAlerta(null);
      setAcuerdos([]);
      setConfirmUnlink(false);
      toast.success("Expediente desvinculado");
    } catch (e) {
      toast.error(
        "Error al desvincular: " + (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setUnlinking(false);
    }
  };

  if (loadingAlerta) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Gavel className="h-4 w-4" /> Búho Legal · Expediente digital
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  // ── Estado B: vinculado ──
  if (alerta) {
    const juzgadoLabel =
      juzgados.find((j) => j.id === alerta.juzgado_id)?.nombre ??
      (alerta.juzgado_id != null ? `Juzgado #${alerta.juzgado_id}` : "—");
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Gavel className="h-4 w-4" /> Búho Legal · Expediente digital
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1">
                <CheckCircle2 className="h-3 w-3" /> Vinculado
              </Badge>
              <Badge variant="outline">{entidadLabel(alerta.entidad)}</Badge>
              <span className="text-xs text-muted-foreground">
                Exp. {alerta.numero_expediente} · {juzgadoLabel}
              </span>
            </div>
            {alerta.last_sync_at && (
              <p className="text-[11px] text-muted-foreground">
                Última sincronización:{" "}
                {formatMX(new Date(alerta.last_sync_at), "dd MMM yyyy HH:mm")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
              {syncing ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Consultando Búho Legal...
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3 mr-1" /> Sincronizar acuerdos
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {acuerdos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-lg">
              Aún no hay acuerdos registrados. Sincroniza para traer los últimos.
            </p>
          ) : (
            <Accordion type="multiple" className="space-y-1">
              {acuerdos.map((ac) => (
                <AccordionItem
                  key={ac.id}
                  value={ac.id}
                  className="border rounded-md px-3"
                >
                  <AccordionTrigger className="py-2.5 hover:no-underline">
                    <div className="flex items-center gap-2 flex-wrap text-left">
                      <Badge variant="outline" className="text-xs shrink-0">
                        {ac.fecha
                          ? formatMX(new Date(ac.fecha), "dd MMM yyyy")
                          : "Sin fecha"}
                      </Badge>
                      <span className="text-sm font-medium">
                        {ac.actor || "—"}
                        <span className="text-muted-foreground font-normal"> vs </span>
                        {ac.demandado || "—"}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="text-sm whitespace-pre-wrap text-muted-foreground pb-3">
                    {ac.acuerdo || "Sin texto del acuerdo."}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}

          {/* Placeholder próximo sprint: antecedentes de la contraparte */}
          <div className="flex items-center justify-between pt-3 border-t border-border gap-2 flex-wrap">
            <Button
              size="sm"
              variant="ghost"
              className="text-xs gap-1"
              disabled
              title="Disponible en el siguiente sprint (busquedas-dashboard.buholegal.com)"
            >
              <Search className="h-3 w-3" /> Buscar antecedentes de contraparte (próximamente)
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => setConfirmUnlink(true)}
            >
              <Link2 className="h-3 w-3 mr-1" /> Desvincular
            </Button>
          </div>
        </CardContent>

        <DeleteConfirmDialog
          open={confirmUnlink}
          onOpenChange={(o) => {
            if (!o) setConfirmUnlink(false);
          }}
          title="¿Desvincular de Búho Legal?"
          description="Se eliminará la alerta en Búho Legal y se borrarán los acuerdos cacheados en Kawiil. Esta acción no se puede deshacer."
          onConfirm={handleUnlink}
          isPending={unlinking}
        />
      </Card>
    );
  }

  // ── Estado A: sin vincular ──
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Gavel className="h-4 w-4" /> Búho Legal · Expediente digital
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Registra el expediente en Búho Legal para monitorear automáticamente los
          acuerdos publicados por el juzgado.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Entidad / Fuero *</Label>
            <Select value={entidad} onValueChange={handleEntidadChange}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar entidad" />
              </SelectTrigger>
              <SelectContent>
                {ENTIDAD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Juzgado *</Label>
            <Select
              value={juzgadoId}
              onValueChange={setJuzgadoId}
              disabled={!entidad || loadingJuzgados || juzgados.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !entidad
                      ? "Elige una entidad primero"
                      : loadingJuzgados
                        ? "Cargando juzgados..."
                        : juzgados.length === 0
                          ? "Sin juzgados disponibles"
                          : "Seleccionar juzgado"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {juzgados.map((j) => (
                  <SelectItem key={j.id} value={String(j.id)}>
                    {j.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {requiereTipo && (
            <div className="space-y-2">
              <Label>Tipo de expediente *</Label>
              <Select
                value={tipoId}
                onValueChange={setTipoId}
                disabled={loadingTipos}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      loadingTipos ? "Cargando tipos..." : "Seleccionar tipo"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {tipos.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.descripcion}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Número de expediente *</Label>
            <Input
              placeholder="EXP-123/2026"
              value={numExpediente}
              onChange={(e) => setNumExpediente(e.target.value)}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Nombre de la alerta *</Label>
            <Input
              placeholder="Nombre descriptivo de la alerta"
              value={nombreAlerta}
              onChange={(e) => setNombreAlerta(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleRegister} disabled={!canRegister || registering}>
            {registering ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Registrando...
              </>
            ) : (
              "Registrar en Búho Legal"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
