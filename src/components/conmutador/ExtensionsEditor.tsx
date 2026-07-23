import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Save, Trash2 } from "lucide-react";
import {
  useDeleteExtension,
  useExtensions,
  useOrgProfiles,
  useUpsertExtension,
} from "@/hooks/useConmutador";

export function ExtensionsEditor() {
  const { data: extensions, isLoading } = useExtensions();
  const { data: profiles } = useOrgProfiles();
  const upsert = useUpsertExtension();
  const del = useDeleteExtension();

  const [userId, setUserId] = useState("");
  const [extension, setExtension] = useState("");
  const [sip, setSip] = useState("");

  const reset = () => {
    setUserId("");
    setExtension("");
    setSip("");
  };

  const save = () => {
    if (!userId || !extension.trim()) return;
    upsert.mutate(
      { input: { user_id: userId, extension, sip_endpoint: sip || null } },
      { onSuccess: reset },
    );
  };

  const editRow = (uid: string, ext: string, endpoint: string | null) => {
    setUserId(uid);
    setExtension(ext);
    setSip(endpoint ?? "");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Asignar / editar extensión</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[1fr_120px_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label>Persona</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona…" />
                </SelectTrigger>
                <SelectContent>
                  {(profiles ?? []).map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ext">Extensión</Label>
              <Input
                id="ext"
                value={extension}
                onChange={(e) => setExtension(e.target.value)}
                placeholder="101"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sip">Endpoint SIP (interno)</Label>
              <Input
                id="sip"
                value={sip}
                onChange={(e) => setSip(e.target.value)}
                placeholder="sip:kawiiler101@sip.telnyx.com"
              />
            </div>
            <Button onClick={save} disabled={upsert.isPending || !userId || !extension.trim()}>
              <Save className="mr-1.5 h-4 w-4" />
              {upsert.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            El endpoint SIP es interno (softphone del colaborador); nunca se muestra al llamante.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !extensions || extensions.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Aún no hay extensiones asignadas.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Extensión</TableHead>
                    <TableHead>Persona</TableHead>
                    <TableHead>Endpoint SIP</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="w-[100px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {extensions.map((e) => (
                    <TableRow key={e.user_id}>
                      <TableCell className="font-mono">{e.extension}</TableCell>
                      <TableCell>{e.nombre || "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {e.sip_endpoint || "— sin endpoint —"}
                      </TableCell>
                      <TableCell>
                        {e.is_active ? (
                          <Badge variant="outline">Activa</Badge>
                        ) : (
                          <Badge variant="secondary">Inactiva</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => editRow(e.user_id, e.extension, e.sip_endpoint)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => del.mutate({ userId: e.user_id })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
    </div>
  );
}
