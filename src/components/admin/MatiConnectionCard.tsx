import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useMatiList, useMatiStatus, type MatiRow } from "@/hooks/useMatiGateway";

type Section = "users" | "modules" | "tickets";

const SECTIONS: Record<Section, { label: string; columns: { key: string; label: string }[] }> = {
  users: {
    label: "Usuarios",
    columns: [
      { key: "nombre_completo", label: "Nombre" },
      { key: "email", label: "Correo" },
      { key: "area", label: "Área" },
      { key: "nivel", label: "Nivel" },
      { key: "activo", label: "Activo" },
    ],
  },
  modules: {
    label: "Módulos",
    columns: [
      { key: "nombre", label: "Módulo" },
      { key: "clave", label: "Clave" },
      { key: "activo", label: "Activo" },
    ],
  },
  tickets: {
    label: "Tickets",
    columns: [
      { key: "asunto", label: "Asunto" },
      { key: "estado", label: "Estado" },
      { key: "prioridad", label: "Prioridad" },
      { key: "area", label: "Área" },
    ],
  },
};

function cell(row: MatiRow, key: string): string {
  // Algunos sistemas llaman `titulo` al `asunto`.
  const v = row[key] ?? (key === "asunto" ? row["titulo"] : undefined);
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  return String(v);
}

/** Conexión de solo lectura con MATI / Kit-to-Drive, vía el gateway de Kawiil. */
export function MatiConnectionCard() {
  const status = useMatiStatus();
  const [section, setSection] = useState<Section | null>(null);
  const configured = status.data?.configured === true;
  const list = useMatiList(section ?? "users", configured && section !== null);

  const rows = list.data?.data ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-sky-600" />
          MATI / Kit-to-Drive
          <Badge variant="outline" className="text-[10px]">Solo lectura</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1 text-xs"
            onClick={() => {
              void status.refetch();
              if (section) void list.refetch();
            }}
            disabled={status.isFetching || list.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${status.isFetching || list.isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.isLoading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando conexión…
          </p>
        )}

        {status.isError && (
          <p className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="h-3.5 w-3.5" /> {(status.error as Error).message}
          </p>
        )}

        {status.data && !configured && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200">
            <p className="font-medium">Conexión no configurada</p>
            <p className="mt-1">
              Faltan estos secretos en Supabase → Edge Functions:{" "}
              <code className="font-mono">{(status.data.problems ?? []).join(", ") || "—"}</code>
            </p>
          </div>
        )}

        {configured && (
          <>
            <p className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              Conexión configurada
              {status.data?.data?.version ? ` · versión ${status.data.data.version}` : ""}
              {status.data?.data?.empresa_nombre ? ` · ${status.data.data.empresa_nombre}` : ""}
            </p>

            <div className="flex flex-wrap gap-2">
              {(Object.keys(SECTIONS) as Section[]).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={section === s ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setSection(section === s ? null : s)}
                >
                  {SECTIONS[s].label}
                </Button>
              ))}
            </div>

            {section && list.isLoading && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
              </p>
            )}
            {section && list.isError && (
              <p className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="h-3.5 w-3.5" /> {(list.error as Error).message}
              </p>
            )}
            {section && list.data && (
              rows.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">Sin registros.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {SECTIONS[section].columns.map((c) => (
                          <TableHead key={c.key} className="text-[11px]">{c.label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r, i) => (
                        <TableRow key={String(r.id ?? r.clave ?? i)}>
                          {SECTIONS[section].columns.map((c) => (
                            <TableCell key={c.key} className="text-xs">{cell(r, c.key)}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            )}
          </>
        )}

        <p className="text-[10px] text-muted-foreground">
          Los datos pasan por Kawiil (nunca directo desde tu navegador a MATI), se muestran con los
          correos enmascarados, solo viven en memoria y cada consulta queda en la bitácora.
        </p>
      </CardContent>
    </Card>
  );
}
