import { useEffect, useState } from "react";
import { FolderOpen, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { etiquetaOpcion, nombreAgente, type AgenteRegistro } from "@/lib/agentes/registro";
import { useCuentasAgente, useFuentesDocs } from "@/hooks/useAgenteConstructor";
import { ensenable } from "@/components/agentes/EnsenarAgente";
import { idDeEnlaceGoogle, validarFuentesDocs, type FuenteDocs } from "../../../supabase/functions/_shared/fuentesDocs";
import { FichaAgente } from "@/components/agentes/FichaAgente";

// «Documentos»: qué carpetas de Google Drive o Microsoft (SharePoint/OneDrive) puede LEER un agente. Solo lectura y solo
// dentro de cada carpeta; el cliente además tiene que haberla compartido con la identidad de la VM (ver FUENTES-DOCUMENTOS.md
// en kawiil-agents). Aquí solo se guardan identificadores, nunca credenciales.
export const fuentesDe = (a?: AgenteRegistro): FuenteDocs[] => {
  const f = (a?.config as { fuentes_docs?: unknown } | null | undefined)?.fuentes_docs;
  return Array.isArray(f) ? (f as FuenteDocs[]).filter((x) => x && (x.proveedor === "google" || x.proveedor === "microsoft" || x.proveedor === "dropbox") && typeof x.etiqueta === "string") : [];
};
const corto = (s: string) => (s.length > 18 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);

// Las fuentes de documentos son una clave aparte de la configuración (no tocan el prompt): se pueden dar a cualquier agente consultable activo.
// ¿Puede el agente leer correo y calendario de las cuentas vinculadas? (config.cuentas.activa; lo activa Dirección).
export const cuentasActivas = (a?: AgenteRegistro): boolean => (a?.config as { cuentas?: { activa?: unknown } } | null | undefined)?.cuentas?.activa === true;

export const documentable = (a: AgenteRegistro) => a.status !== "archived" && a.kind !== "system";

export function DocumentosAgente({ agentes, agenteInicial }: { agentes: AgenteRegistro[]; agenteInicial?: string }) {
  const lista = agentes.filter(documentable);
  const [agenteId, setAgenteId] = useState(agenteInicial ?? "");
  const agente = lista.find((a) => a.id === agenteId);
  const guardadas = fuentesDe(agente);
  const [prov, setProv] = useState<"google" | "microsoft" | "dropbox">("google");
  const [etiqueta, setEtiqueta] = useState("");
  const [carpeta, setCarpeta] = useState("");
  const [drive, setDrive] = useState("");
  const [tenant, setTenant] = useState("");
  const [errores, setErrores] = useState<string[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  const guardar = useFuentesDocs();
  const cuentas = useCuentasAgente();
  useEffect(() => { setErrores([]); setOk(null); guardar.reset(); cuentas.reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agenteId]);

  const enviar = (fuentes: FuenteDocs[], mensaje: string) => {
    if (!agente) return;
    guardar.mutate({ agent_id: agente.id, fuentes }, { onSuccess: () => setOk(mensaje) });
  };
  const agregar = () => {
    setOk(null);
    const nueva = prov === "dropbox" ? { proveedor: prov, etiqueta, carpeta_id: "raiz" } : prov === "google" ? { proveedor: prov, etiqueta, carpeta_id: carpeta } : { proveedor: prov, etiqueta, carpeta_id: carpeta, drive_id: drive, tenant_id: tenant };
    const v = validarFuentesDocs([...guardadas, nueva]);     // misma validación que el servidor
    if ("errores" in v) { setErrores(v.errores); return; }
    setErrores([]);
    enviar(v.fuentes, `Fuente «${etiqueta.trim()}» guardada. El agente la podrá leer desde su próxima tarea.`);
    setEtiqueta(""); setCarpeta(""); setDrive(""); setTenant("");
  };
  const quitar = (e: string) => { setOk(null); enviar(guardadas.filter((f) => f.etiqueta !== e), `Fuente «${e}» quitada.`); };

  return (
    <div className="space-y-3" data-testid="documentos">
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><FolderOpen className="h-4 w-4" />Elige qué carpetas puede leer un agente. Solo lectura, solo dentro de cada carpeta. El cliente además debe compartirlas con la identidad de la VM; quitar ese permiso lo revoca.</p>
      {lista.length === 0 ? <p className="zen-glass rounded-2xl p-4 text-sm text-muted-foreground" data-testid="documentos-vacio">Aún no hay agentes disponibles.</p> : (
        <>
          <label className="block space-y-1 text-sm">Agente
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={agenteId} onChange={(e) => setAgenteId(e.target.value)} data-testid="documentos-agente">
              <option value="">Elige un agente…</option>
              {lista.map((a) => <option key={a.id} value={a.id}>{etiquetaOpcion(a)} — {fuentesDe(a).length} fuentes</option>)}
            </select>
          </label>
          <FichaAgente agente={agente} />
          {agente && (
            <>
              <div className="zen-glass space-y-2 rounded-2xl p-3" data-testid="cuentas-agente">
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1" checked={cuentasActivas(agente)} disabled={cuentas.isPending} data-testid="cuentas-activa"
                    onChange={(e) => cuentas.mutate({ agent_id: agente.id, activa: e.target.checked })} />
                  <span><strong>Correo y calendario de las cuentas vinculadas</strong><br />
                    <span className="text-muted-foreground">Si lo activas, {nombreAgente(agente)} puede buscar y leer (solo leer) el correo y los eventos de las cuentas de Google y Microsoft que se vinculan en Kawiil Central. No envía, responde, archiva ni borra nada. Lo que lee se trata como información de terceros, nunca como instrucciones, y cada consulta queda en su bitácora.</span></span>
                </label>
                {cuentas.isError && <p role="alert" className="text-sm text-destructive">{(cuentas.error as Error).message}</p>}
              </div>
              <div className="zen-glass space-y-2 rounded-2xl p-3" data-testid="documentos-lista">
                <p className="text-xs font-medium text-muted-foreground">Fuentes de {nombreAgente(agente)}</p>
                {guardadas.length === 0 ? <p className="text-sm text-muted-foreground">Ninguna todavía.</p> : guardadas.map((f) => (
                  <div key={f.etiqueta} className="flex items-center justify-between gap-2 rounded-xl border border-border/50 p-2 text-sm" data-testid={`fuente-${f.etiqueta}`}>
                    <span><strong>{f.etiqueta}</strong> · {f.proveedor === "google" ? "Google Drive" : f.proveedor === "dropbox" ? "Dropbox" : `Microsoft (${f.tenant_id})`} · {f.proveedor === "dropbox" && f.carpeta_id === "raiz" ? "todas las carpetas de clientes" : `carpeta ${corto(f.carpeta_id)}`}</span>
                    <Button size="sm" variant="outline" onClick={() => quitar(f.etiqueta)} disabled={guardar.isPending} aria-label={`Quitar ${f.etiqueta}`} data-testid={`quitar-${f.etiqueta}`}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
              <div className="zen-glass space-y-3 rounded-3xl p-4">
                <p className="text-sm font-medium">Agregar una carpeta</p>
                <div className="flex gap-2 text-xs" role="group" aria-label="Proveedor">
                  {(["google", "microsoft", "dropbox"] as const).map((p) => (
                    <button key={p} type="button" aria-pressed={prov === p} data-testid={`prov-${p}`} onClick={() => { setProv(p); setErrores([]); }}
                      className={`rounded-full border px-3 py-1 ${prov === p ? "border-primary/60 bg-primary/10" : "border-border/60"}`}>{p === "google" ? "Google Drive" : p === "dropbox" ? "Dropbox (clientes)" : "Microsoft (SharePoint/OneDrive)"}</button>
                  ))}
                </div>
                <label className="block space-y-1 text-sm">Nombre de la fuente<Input value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Drive Vizum" data-testid="documentos-etiqueta" /></label>
                {prov === "dropbox" ? (
                  <p className="text-xs text-muted-foreground" data-testid="documentos-dropbox-aviso">Dropbox ya está conectado a Kawiil Central. El agente podrá leer, en solo lectura y incluyendo el contenido de los documentos, todo lo que cuelga de la carpeta de clientes (/Kawiil Mx/CLIENTES). Nada fuera de ella.</p>
                ) : (
                <label className="block space-y-1 text-sm">{prov === "google" ? "Enlace o id de la carpeta de Drive" : "Id de la carpeta (carpeta_id)"}
                  <Input value={carpeta} onChange={(e) => setCarpeta(e.target.value)} placeholder={prov === "google" ? "https://drive.google.com/drive/folders/…" : "01ABCDEF…"} data-testid="documentos-carpeta" /></label>
                )}
                {prov === "microsoft" && (
                  <>
                    <label className="block space-y-1 text-sm">Id de la biblioteca (drive_id)<Input value={drive} onChange={(e) => setDrive(e.target.value)} placeholder="b!…" data-testid="documentos-drive" /></label>
                    <label className="block space-y-1 text-sm">Tenant del cliente<Input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="contoso.onmicrosoft.com" data-testid="documentos-tenant" /></label>
                    <p className="text-xs text-muted-foreground">El drive_id y la carpeta_id se obtienen en la VM con <code>docs_cli.py microsoft-enlace</code>. Antes, un administrador del cliente debe autorizar la aplicación y dar permiso de lectura al sitio.</p>
                  </>
                )}
                {prov === "google" && carpeta && idDeEnlaceGoogle(carpeta) !== carpeta.trim() && <p className="text-xs text-muted-foreground">Id detectado: {idDeEnlaceGoogle(carpeta)}</p>}
                {errores.length > 0 && <ul role="alert" className="list-disc pl-5 text-sm text-destructive" data-testid="documentos-errores">{errores.map((e) => <li key={e}>{e}</li>)}</ul>}
                {guardar.isError && <p role="alert" className="text-sm text-destructive" data-testid="documentos-error">{(guardar.error as Error).message}</p>}
                {ok && <p role="status" className="text-sm" data-testid="documentos-ok">{ok}</p>}
                <Button onClick={agregar} disabled={guardar.isPending} data-testid="documentos-agregar">{guardar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Agregar fuente</Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
