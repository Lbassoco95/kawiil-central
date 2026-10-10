import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Link2, Sparkles, Plus, CheckCircle2 } from "lucide-react";
import {
  useUnlinkedClients,
  useUnlinkedSavioCustomers,
  useLinkClientSavio,
  useCreateLocalFromSavio,
  useCreateSavioFromClient,
  suggestSavioMatch,
} from "@/hooks/useSavioLink";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SavioLinkWizard({ open, onOpenChange }: Props) {
  const { data: clients = [], isLoading: cl } = useUnlinkedClients();
  const { data: savio = [], isLoading: sl } = useUnlinkedSavioCustomers();
  const link = useLinkClientSavio();
  const createLocal = useCreateLocalFromSavio();
  const createSavio = useCreateSavioFromClient();

  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<Record<string, string>>({});

  const savioOptions = useMemo(
    () => savio.map((s) => ({ value: s.savio_id, label: `${s.name || s.savio_id.slice(0, 10)}${s.rfc ? ` · ${s.rfc}` : ""}` })),
    [savio],
  );

  const clientRows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return clients
      .filter((c) => !s || c.name.toLowerCase().includes(s) || (c.rfc ?? "").toLowerCase().includes(s))
      .map((c) => ({ client: c, suggestion: suggestSavioMatch(c, savio) }));
  }, [clients, savio, search]);

  const selectedFor = (clientId: string, suggested: string | undefined) =>
    selection[clientId] ?? suggested ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Enlace Kawiil ↔ Savio
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="locales" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="w-fit">
            <TabsTrigger value="locales" className="text-xs gap-1.5">
              Locales sin enlace <Badge variant="outline" className="text-[10px]">{clients.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="savio" className="text-xs gap-1.5">
              Savio sin ficha <Badge variant="outline" className="text-[10px]">{savio.length}</Badge>
            </TabsTrigger>
          </TabsList>

          {/* Locales → Savio */}
          <TabsContent value="locales" className="flex-1 overflow-hidden flex flex-col mt-3">
            <Input
              placeholder="Buscar cliente local…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs mb-2"
            />
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {cl || sl ? (
                [1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)
              ) : clientRows.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Todos los clientes locales están enlazados.
                </div>
              ) : (
                clientRows.map(({ client, suggestion }) => (
                  <div key={client.id} className="rounded-lg border border-border/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{client.name}</p>
                        <p className="text-[11px] text-muted-foreground">{client.rfc || "sin RFC"}</p>
                      </div>
                      {suggestion && (
                        <Badge variant="outline" className="shrink-0 gap-1 text-[10px] text-primary">
                          <Sparkles className="h-3 w-3" /> {suggestion.by === "rfc" ? "RFC" : "nombre"}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="min-w-[220px] flex-1">
                        <SearchableSelect
                          options={[{ value: "", label: "Seleccionar cliente Savio…" }, ...savioOptions]}
                          value={selectedFor(client.id, suggestion?.candidate.savio_id)}
                          onValueChange={(v) => setSelection((prev) => ({ ...prev, [client.id]: v }))}
                          placeholder="Cliente Savio…"
                        />
                      </div>
                      <Button
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        disabled={!selectedFor(client.id, suggestion?.candidate.savio_id) || link.isPending}
                        onClick={() =>
                          link.mutate({ clientId: client.id, savioId: selectedFor(client.id, suggestion?.candidate.savio_id) })
                        }
                      >
                        <Link2 className="h-3.5 w-3.5" /> Enlazar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1 text-xs"
                        disabled={createSavio.isPending}
                        onClick={() => createSavio.mutate(client)}
                        title="Crea este cliente en Savio (escritura externa) y guarda el vínculo"
                      >
                        <Plus className="h-3.5 w-3.5" /> Crear en Savio
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {/* Savio → Local */}
          <TabsContent value="savio" className="flex-1 overflow-hidden flex flex-col mt-3">
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {sl ? (
                [1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)
              ) : savio.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Todos los clientes de Savio tienen ficha.
                </div>
              ) : (
                savio.map((s) => (
                  <div key={s.savio_id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.name || s.savio_id.slice(0, 12)}</p>
                      <p className="text-[11px] text-muted-foreground">{s.rfc || "sin RFC"}{s.email ? ` · ${s.email}` : ""}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 text-xs shrink-0"
                      disabled={createLocal.isPending}
                      onClick={() => createLocal.mutate(s)}
                    >
                      <Plus className="h-3.5 w-3.5" /> Crear ficha local
                    </Button>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>

        <p className="text-[11px] text-muted-foreground border-t pt-2">
          El enlace es local e inmediato. «Crear en Savio» escribe en Savio (requiere permiso de escritura) y guarda el vínculo.
        </p>
      </DialogContent>
    </Dialog>
  );
}
