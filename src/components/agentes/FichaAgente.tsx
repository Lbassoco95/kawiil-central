import { descripcionAgente, nombreAgente, rolCorto, type AgenteRegistro } from "@/lib/agentes/registro";

type Cfg = Record<string, unknown>;
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// Lo que el agente puede usar, leído de su configuración (solo conteos y etiquetas; nunca referencias de 1Password ni contenido).
export function capacidadesAgente(a: Pick<AgenteRegistro, "config">): string[] {
  const c = (a.config ?? {}) as Cfg;
  const out: string[] = [];
  const sitios = lista((c.internet as { dominios_permitidos?: unknown } | undefined)?.dominios_permitidos).length;
  if (sitios > 0) out.push(`Internet: ${sitios} ${sitios === 1 ? "sitio permitido" : "sitios permitidos"}`);
  const accesos = lista(c.credenciales_1password).length;
  if (accesos > 0) out.push(`1Password: ${accesos} ${accesos === 1 ? "acceso" : "accesos"}`);
  const docs = lista(c.fuentes_docs).length;
  if (docs > 0) out.push(`Documentos: ${docs} ${docs === 1 ? "fuente" : "fuentes"}`);
  const habs = lista(c.habilidades).filter((h) => (h as { estado?: unknown } | null)?.estado === "aprobada").length;
  if (habs > 0) out.push(`${habs} ${habs === 1 ? "habilidad aprobada" : "habilidades aprobadas"}`);
  if ((c.programacion as { activa?: unknown } | undefined)?.activa === true) out.push("Con tarea programada");
  return out;
}

// Ficha corta del agente elegido: quién es, qué hace y qué puede usar. Solo lectura.
export function FichaAgente({ agente }: { agente: AgenteRegistro | undefined }) {
  if (!agente) return null;
  const desc = descripcionAgente(agente), rol = rolCorto(agente, 60), caps = capacidadesAgente(agente);
  return (
    <div className="space-y-1 rounded-2xl border border-border/60 bg-background/40 p-3 text-sm" data-testid="ficha-agente">
      <p className="font-medium">{nombreAgente(agente)}{rol && <span className="font-normal text-muted-foreground"> · {rol}</span>}</p>
      <p className="text-muted-foreground" data-testid="ficha-descripcion">{desc || "Este agente aún no tiene descripción en el registro."}</p>
      {caps.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 pt-1 text-xs" aria-label="Lo que puede usar">
          {caps.map((t) => <li key={t} className="rounded-full border border-border/50 px-2 py-0.5">{t}</li>)}
        </ul>
      )}
    </div>
  );
}
