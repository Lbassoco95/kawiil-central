import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Moon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  SILENCIO_FIN_POR_DEFECTO,
  SILENCIO_INICIO_POR_DEFECTO,
  describirHorario,
  normalizarHora,
  validarHorario,
} from "@/lib/horarioSilencio";

type Prefs = { push_quiet_enabled: boolean; push_quiet_start: string; push_quiet_end: string };

/**
 * Horario de silencio de los avisos al celular (hora de Ciudad de México). Por defecto de 10:00 pm a 7:00 am.
 * Durante el silencio no suena el celular; todo queda esperando en la campana. Las solicitudes por aprobar
 * sí pueden avisar. La regla que aplica el silencio vive en supabase/functions/_shared/webPush.ts.
 */
export function HorarioSilencioCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const queryKey = ["profile-quiet-hours", user?.id];

  const { data, isLoading } = useQuery({
    queryKey,
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<Prefs> => {
      const { data: row, error } = await supabase
        .from("profiles")
        .select("push_quiet_enabled, push_quiet_start, push_quiet_end")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return row as Prefs;
    },
  });

  const [inicio, setInicio] = useState(SILENCIO_INICIO_POR_DEFECTO);
  const [fin, setFin] = useState(SILENCIO_FIN_POR_DEFECTO);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setInicio(normalizarHora(data.push_quiet_start) ?? SILENCIO_INICIO_POR_DEFECTO);
    setFin(normalizarHora(data.push_quiet_end) ?? SILENCIO_FIN_POR_DEFECTO);
  }, [data]);

  const guardar = useMutation({
    mutationFn: async (patch: Partial<Prefs>) => {
      const { error } = await supabase.from("profiles").update(patch).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Tu horario de silencio quedó guardado");
    },
    onError: () => toast.error("No pudimos guardar tu horario. Inténtalo de nuevo en un momento."),
  });

  if (!user) return null;

  const activo = data?.push_quiet_enabled !== false;
  const bloqueado = isLoading || guardar.isPending;

  const cambiarHora = (campo: "push_quiet_start" | "push_quiet_end", valor: string) => {
    const nuevoInicio = campo === "push_quiet_start" ? valor : inicio;
    const nuevoFin = campo === "push_quiet_end" ? valor : fin;
    if (campo === "push_quiet_start") setInicio(valor);
    else setFin(valor);
    const r = validarHorario(nuevoInicio, nuevoFin);
    if (!r.ok) {
      setAviso(r.motivo);
      return;
    }
    setAviso(null);
    guardar.mutate({ push_quiet_start: r.inicio, push_quiet_end: r.fin });
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Moon className="h-4 w-4" /> Horario de silencio
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">No avisarme al celular de noche</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Mientras descansas, los avisos esperan en la campana de Kawiil y tu celular no suena.
              Hora de Ciudad de México.
            </p>
          </div>
          <Switch
            checked={activo}
            disabled={bloqueado}
            onCheckedChange={(v) => guardar.mutate({ push_quiet_enabled: v })}
            aria-label="Activar el horario de silencio"
          />
        </div>

        {activo && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label htmlFor="silencio-desde" className="text-xs text-muted-foreground">
                  Desde
                </Label>
                <Input
                  id="silencio-desde"
                  type="time"
                  value={inicio}
                  disabled={bloqueado}
                  onChange={(e) => cambiarHora("push_quiet_start", e.target.value)}
                  className="w-32"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="silencio-hasta" className="text-xs text-muted-foreground">
                  Hasta
                </Label>
                <Input
                  id="silencio-hasta"
                  type="time"
                  value={fin}
                  disabled={bloqueado}
                  onChange={(e) => cambiarHora("push_quiet_end", e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
            {aviso ? (
              <p className="text-xs text-muted-foreground" role="status">
                {aviso}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {describirHorario(inicio, fin)}. Si prefieres que te avisen más tarde, mueve la hora de inicio.
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Las solicitudes de vacaciones y permisos por aprobar sí pueden avisarte de noche, porque no pueden esperar.
        </p>
      </CardContent>
    </Card>
  );
}
