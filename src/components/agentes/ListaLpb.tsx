import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, Loader2, Search, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useDetallePersonaLpb, useExportarLpb, useListaLpb, useResumenLpb, useRevisarLpb } from "@/hooks/useLpb";
import { ETIQUETA_ESTADO, ETIQUETA_FILTRO, FILTROS, MAX_REVISION, type FiltroLpb, type PersonaLpb } from "../../../supabase/functions/_shared/lpb";

// Lista maestra de Personas Bloqueadas (transmisores de dinero) y cola de visto bueno. Lo que el agente registra entra «por revisar»: aquí Dirección
// lo verifica contra el PDF y lo aprueba, o lo devuelve con una nota. Solo se escribe la revisión; nombre, RFC y estado los mantiene el agente.
const fecha = (f: string | null) => (f ? f.split("-").reverse().join("/") : "—");

function Detalle({ id }: { id: string }) {
  const d = useDetallePersonaLpb(id);
  if (d.isLoading) return <p className="p-3 text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Cargando…</p>;
  if (d.error || !d.data) return <p className="p-3 text-sm text-destructive">No se pudo cargar el detalle.</p>;
  const { persona: p, movimientos } = d.data;
  return (
    <div className="space-y-2 bg-muted/40 p-3 text-sm">
      {p.rfc_dudoso && <p className="flex items-start gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />El RFC no pasa la fecha o el dígito verificador. Puede ser el dato del propio oficio: compáralo con el PDF antes de decidir.</p>}
      {p.revision_nota && <p><span className="font-medium">Nota de revisión:</span> {p.revision_nota}</p>}
      {p.notas && <p><span className="font-medium">Notas del agente:</span> {p.notas}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground"><tr><th className="pr-3">Movimiento</th><th className="pr-3">Oficio</th><th className="pr-3">Fecha</th><th className="pr-3">Archivo en Dropbox</th><th>Fuente</th></tr></thead>
          <tbody>
            {movimientos.length === 0 && <tr><td colSpan={5} className="py-1 text-muted-foreground">Sin movimientos registrados.</td></tr>}
            {movimientos.map((m) => (
              <tr key={m.id}><td className="pr-3">{m.tipo.replace(/_/g, " ")}</td><td className="pr-3">{m.oficio ?? "—"}</td><td className="pr-3">{fecha(m.fecha_oficio)}</td><td className="pr-3 break-all">{m.archivo ?? "—"}</td><td>{m.fuente.replace(/_/g, " ")}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Busca el archivo por su nombre en Dropbox (carpeta «Expedientes - Personas Bloqueadas») para verificarlo contra el PDF.</p>
    </div>
  );
}

export function ListaLpb() {
  const [filtro, setFiltro] = useState<FiltroLpb>("por_revisar");
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(0);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const resumen = useResumenLpb();
  const lista = useListaLpb(filtro, q, pagina);
  const revisar = useRevisarLpb();
  const exportar = useExportarLpb();

  useEffect(() => { const t = setTimeout(() => { setQ(texto); setPagina(0); }, 350); return () => clearTimeout(t); }, [texto]);
  useEffect(() => { setMarcadas(new Set()); setAbierta(null); }, [filtro, q, pagina]);

  const personas = lista.data?.personas ?? [];
  const total = lista.data?.total ?? 0;
  const limite = lista.data?.limite ?? 50;
  const todas = personas.length > 0 && personas.every((p) => marcadas.has(p.id));
  const alternar = (id: string) => setMarcadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < MAX_REVISION) n.add(id); return n; });
  const resolver = (decision: "aprobar" | "devolver") => {
    setAviso(null);
    revisar.mutate({ ids: [...marcadas], decision, nota }, {
      onSuccess: (r) => { setAviso(decision === "aprobar" ? `${r.actualizadas} persona(s) aprobadas.` : `${r.actualizadas} persona(s) devueltas para corregir.`); setMarcadas(new Set()); setNota(""); },
    });
  };
  const descargar = () => exportar.mutate({ filtro, q }, {
    onSuccess: (r) => {
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = `LPB_${filtro}.csv`; a.click(); URL.revokeObjectURL(url);
      setAviso(r.truncado ? `Se exportaron las primeras ${r.filas} filas (hay más: afina el filtro).` : `Se exportaron ${r.filas} filas.`);
    },
  });
  const cifra = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("es-MX"));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Total", resumen.data?.total], ["Vigentes", resumen.data?.vigentes], ["Eliminadas", resumen.data?.eliminadas], ["Por revisar", resumen.data?.por_revisar], ["Por corregir", resumen.data?.por_corregir], ["RFC dudoso", resumen.data?.dudosos], ["Datos incompletos", resumen.data?.incompletos], ["Revisadas", resumen.data?.revisadas]].map(([t, n]) => (
          <div key={String(t)} className="rounded-md border p-2"><p className="text-xs text-muted-foreground">{t}</p><p className="text-lg font-semibold">{cifra(n as number | undefined)}</p></div>
        ))}
      </div>
      {resumen.error && <p className="text-sm text-destructive">{(resumen.error as Error).message}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => <Button key={f} size="sm" variant={f === filtro ? "default" : "outline"} onClick={() => { setFiltro(f); setPagina(0); }}>{ETIQUETA_FILTRO[f]}</Button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Buscar por nombre o RFC" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Buscar por nombre o RFC" /></div>
        <Button variant="outline" onClick={descargar} disabled={exportar.isPending}>{exportar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}Exportar CSV</Button>
      </div>
      {exportar.error && <p className="text-sm text-destructive">{(exportar.error as Error).message}</p>}

      {marcadas.size > 0 && (
        <div className="space-y-2 rounded-md border bg-muted/40 p-3">
          <p className="text-sm font-medium">{marcadas.size} seleccionada(s) (máximo {MAX_REVISION} por vez)</p>
          <Textarea value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (obligatoria si la devuelves: qué no coincide con el PDF)" rows={2} maxLength={500} aria-label="Nota de revisión" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => resolver("aprobar")} disabled={revisar.isPending}><CheckCircle2 className="mr-1 h-4 w-4" />Dar visto bueno</Button>
            <Button variant="outline" onClick={() => resolver("devolver")} disabled={revisar.isPending || nota.trim().length < 3}><Undo2 className="mr-1 h-4 w-4" />Devolver para corregir</Button>
          </div>
          <p className="text-xs text-muted-foreground">«Visto bueno» significa que verificaste esas personas contra el PDF del oficio. Si no lo has hecho, no lo des.</p>
        </div>
      )}
      {revisar.error && <p className="text-sm text-destructive">{(revisar.error as Error).message}</p>}
      {aviso && <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">{aviso}</p>}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr><th className="w-8 p-2"><Checkbox checked={todas} onCheckedChange={(c) => setMarcadas(c ? new Set(personas.slice(0, MAX_REVISION).map((p) => p.id)) : new Set())} aria-label="Seleccionar la página" /></th><th className="w-6" /><th className="p-2">Nombre</th><th className="p-2">RFC</th><th className="p-2">Estado</th><th className="p-2">Alta</th><th className="p-2">Revisión</th></tr>
          </thead>
          <tbody>
            {lista.isLoading && <tr><td colSpan={7} className="p-4 text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Cargando…</td></tr>}
            {lista.error && <tr><td colSpan={7} className="p-4 text-destructive">{(lista.error as Error).message}</td></tr>}
            {!lista.isLoading && !lista.error && personas.length === 0 && <tr><td colSpan={7} className="p-4 text-muted-foreground">No hay personas con este filtro.</td></tr>}
            {personas.map((p: PersonaLpb) => (
              <FilaPersona key={p.id} p={p} marcada={marcadas.has(p.id)} abierta={abierta === p.id} onMarcar={() => alternar(p.id)} onAbrir={() => setAbierta(abierta === p.id ? null : p.id)} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total.toLocaleString("es-MX")} resultado(s)</span>
        <span className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</Button>
          Página {pagina + 1} de {Math.max(1, Math.ceil(total / limite))}
          <Button size="sm" variant="outline" disabled={(pagina + 1) * limite >= total} onClick={() => setPagina(pagina + 1)}>Siguiente</Button>
        </span>
      </div>
    </div>
  );
}

function FilaPersona({ p, marcada, abierta, onMarcar, onAbrir }: { p: PersonaLpb; marcada: boolean; abierta: boolean; onMarcar: () => void; onAbrir: () => void }) {
  return (
    <>
      <tr className="border-t align-top">
        <td className="p-2"><Checkbox checked={marcada} onCheckedChange={onMarcar} aria-label={`Seleccionar ${p.nombre}`} /></td>
        <td><button className="p-1" onClick={onAbrir} aria-label={abierta ? "Ocultar detalle" : "Ver detalle"}>{abierta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
        <td className="p-2">{p.nombre}</td>
        <td className="p-2 font-mono text-xs">{p.rfc ?? <span className="text-muted-foreground">sin RFC</span>}{p.rfc_dudoso && <Badge variant="outline" className="ml-1 border-amber-500 text-amber-700 dark:text-amber-400">dudoso</Badge>}</td>
        <td className="p-2">{ETIQUETA_ESTADO[p.estado] ?? p.estado}</td>
        <td className="p-2">{fecha(p.fecha_alta)}</td>
        <td className="p-2">{p.revisado ? <Badge variant="secondary">Revisada</Badge> : p.por_corregir ? <Badge variant="destructive">Por corregir</Badge> : <Badge variant="outline">Por revisar</Badge>}{p.datos_incompletos && <Badge variant="outline" className="ml-1">incompleta</Badge>}</td>
      </tr>
      {abierta && <tr><td colSpan={7} className="p-0"><Detalle id={p.id} /></td></tr>}
    </>
  );
}
