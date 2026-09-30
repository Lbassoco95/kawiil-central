import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Accessibility,
  BookOpen,
  Briefcase,
  Calendar,
  CheckSquare,
  FileText,
  FolderKanban,
  Handshake,
  Kanban,
  LayoutDashboard,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useClients } from "@/hooks/useClients";
import { useTasks } from "@/hooks/useTasks";
import { useDocuments } from "@/hooks/useDocuments";
import { useModulePermissions } from "@/hooks/useModulePermissions";
import {
  GLOBAL_SEARCH_MIN_LENGTH,
  useDebouncedValue,
  useGlobalSearch,
  type GlobalSearchEntity,
  type GlobalSearchHit,
} from "@/hooks/useGlobalSearch";
import { matchesSearch, searchRank } from "@/lib/searchMatch";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/lib/openCommandPalette";
import { openNewTaskModal } from "@/lib/openNewTaskModal";

type ViewLink = {
  label: string;
  to: string;
  icon: LucideIcon;
  moduleKey?: string;
  shortcut?: string;
  /** Sinónimos para que la vista se encuentre aunque no se escriba su nombre exacto. */
  keywords?: string;
};

const VIEWS: ViewLink[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard, keywords: "inicio panel" },
  { label: "Tareas", to: "/tareas", icon: CheckSquare, keywords: "pendientes" },
  { label: "Proyectos", to: "/proyectos", icon: FolderKanban },
  { label: "Juntas", to: "/juntas", icon: Calendar, keywords: "reuniones minutas muuch grabacion acuerdos" },
  { label: "Clientes", to: "/clientes", icon: Users, keywords: "cuentas empresas" },
  { label: "Pipeline", to: "/pipeline", icon: Kanban, moduleKey: "pipeline", keywords: "leads prospectos oportunidades" },
  { label: "Documentos", to: "/documentos", icon: FileText, keywords: "archivos" },
  { label: "Finanzas", to: "/finanzas", icon: Wallet, moduleKey: "finanzas", keywords: "facturas cobranza" },
  { label: "Calendario", to: "/microsoft365/calendario", icon: Calendar, moduleKey: "calendario", keywords: "agenda eventos" },
  { label: "Correo", to: "/microsoft365/correo", icon: Mail, moduleKey: "correo", keywords: "email outlook" },
  { label: "Slack", to: "/comunicacion", icon: MessageSquare, keywords: "comunicacion mensajes" },
  { label: "Kawiil AI", to: "/asistente", icon: Sparkles, moduleKey: "ai", keywords: "asistente" },
  { label: "Conocimiento", to: "/conocimiento", icon: BookOpen, moduleKey: "conocimiento" },
  { label: "Hub", to: "/hub", icon: Briefcase, moduleKey: "hub" },
  { label: "Accesibilidad", to: "/accesibilidad", icon: Accessibility },
  { label: "Configuración", to: "/configuracion", icon: Settings, moduleKey: "admin", keywords: "ajustes admin" },
];

const ENTITY_ICON: Record<GlobalSearchEntity, LucideIcon> = {
  client: Users,
  project: FolderKanban,
  task: CheckSquare,
  document: FileText,
  lead: Handshake,
};

const ENTITY_HEADING: Record<GlobalSearchEntity, string> = {
  client: "Clientes",
  project: "Proyectos",
  task: "Tareas",
  document: "Documentos",
  lead: "Pipeline",
};

/** Orden en el que se muestran los grupos de resultados. */
const ENTITY_ORDER: GlobalSearchEntity[] = ["client", "project", "task", "document", "lead"];

const MAX_PER_GROUP = 8;

/**
 * Une coincidencias locales (sobre lo ya cacheado, tolerante a acentos) con las
 * de la base de datos (que alcanzan registros nunca cargados en esta sesión),
 * sin repetir ids y respetando el tope por grupo.
 */
function mergeHits(local: GlobalSearchHit[], remote: GlobalSearchHit[]): GlobalSearchHit[] {
  const seen = new Set<string>();
  const merged: GlobalSearchHit[] = [];
  for (const hit of [...local, ...remote]) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    merged.push(hit);
    if (merged.length >= MAX_PER_GROUP) break;
  }
  return merged;
}

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { hasModule } = useModulePermissions();
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  const { data: documents = [] } = useDocuments();

  const query = search.trim();
  const debouncedQuery = useDebouncedValue(query, 200);
  const { data: remote, isFetching } = useGlobalSearch(debouncedQuery, {
    includeLeads: hasModule("pipeline"),
    limitPerEntity: MAX_PER_GROUP,
  });

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      setOpen((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const visibleViews = useMemo(
    () =>
      VIEWS.filter((v) => !v.moduleKey || hasModule(v.moduleKey)).filter((v) =>
        matchesSearch(query, [v.label, v.keywords]),
      ),
    [hasModule, query],
  );

  /**
   * Coincidencias sobre lo que ya está en caché. Se filtra la lista COMPLETA y
   * se recorta después; recortar antes de filtrar era justo el defecto que hacía
   * invisible a cualquier cliente que no estuviera entre los más recientes.
   */
  const localHits = useMemo(() => {
    const empty: Record<GlobalSearchEntity, GlobalSearchHit[]> = {
      client: [],
      project: [],
      task: [],
      document: [],
      lead: [],
    };
    if (!query) return empty;

    empty.client = clients
      .filter((c) => matchesSearch(query, [c.name, c.rfc, c.email, c.contact_name, c.phone]))
      .sort((a, b) => searchRank(query, a.name) - searchRank(query, b.name))
      .slice(0, MAX_PER_GROUP)
      .map((c) => ({
        id: c.id,
        entity: "client" as const,
        title: c.name,
        subtitle: c.rfc || c.contact_name || c.email || null,
        to: `/clientes/${c.id}`,
      }));

    empty.task = tasks
      .filter((t) => matchesSearch(query, [t.title, t.description, t.clients?.name, t.projects?.name]))
      .sort((a, b) => searchRank(query, a.title) - searchRank(query, b.title))
      .slice(0, MAX_PER_GROUP)
      .map((t) => ({
        id: t.id,
        entity: "task" as const,
        title: t.title,
        subtitle: t.clients?.name ?? t.status ?? null,
        to: `/tareas?id=${t.id}`,
      }));

    empty.document = documents
      .filter((d) => matchesSearch(query, [d.name, d.clients?.name, d.projects?.name]))
      .sort((a, b) => searchRank(query, a.name) - searchRank(query, b.name))
      .slice(0, MAX_PER_GROUP)
      .map((d) => ({
        id: d.id,
        entity: "document" as const,
        title: d.name,
        subtitle: d.clients?.name ?? null,
        to: `/documentos?id=${d.id}`,
      }));

    return empty;
  }, [clients, tasks, documents, query]);

  const groups = useMemo(
    () =>
      ENTITY_ORDER.map((entity) => ({
        entity,
        hits: mergeHits(localHits[entity], remote?.[entity] ?? []),
      })).filter((g) => g.hits.length > 0),
    [localHits, remote],
  );

  const resultCount =
    visibleViews.length + groups.reduce((total, g) => total + g.hits.length, 0);
  const searching = isFetching && query.length >= GLOBAL_SEARCH_MIN_LENGTH;
  const tooShort = query.length > 0 && query.length < GLOBAL_SEARCH_MIN_LENGTH;

  return (
    <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
      <CommandInput
        placeholder="Buscar clientes, proyectos, tareas, documentos…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        {resultCount === 0 && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {searching ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando…
              </span>
            ) : tooShort ? (
              `Escribe al menos ${GLOBAL_SEARCH_MIN_LENGTH} caracteres.`
            ) : (
              `Sin resultados para “${query}”.`
            )}
          </div>
        )}

        {!query && (
          <>
            <CommandGroup heading="Acciones">
              <CommandItem
                value="accion-nueva-tarea"
                onSelect={() => {
                  setOpen(false);
                  openNewTaskModal();
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Nueva tarea
                <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem value="accion-kawiil-ai" onSelect={() => go("/asistente")}>
                <Sparkles className="mr-2 h-4 w-4" />
                Preguntar a Kawiil AI
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {groups.map(({ entity, hits }, index) => {
          const Icon = ENTITY_ICON[entity];
          return (
            <Fragment key={entity}>
              {index > 0 && <CommandSeparator />}
              <CommandGroup heading={ENTITY_HEADING[entity]}>
                {hits.map((hit) => (
                  <CommandItem
                    key={`${entity}-${hit.id}`}
                    value={`${entity}-${hit.id}`}
                    onSelect={() => go(hit.to)}
                  >
                    <Icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{hit.title}</span>
                    {hit.subtitle && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {hit.subtitle}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </Fragment>
          );
        })}

        {visibleViews.length > 0 && (
          <>
            {groups.length > 0 && <CommandSeparator />}
            <CommandGroup heading="Vistas">
              {visibleViews.map((v) => (
                <CommandItem key={v.to} value={`vista-${v.to}`} onSelect={() => go(v.to)}>
                  <v.icon className="mr-2 h-4 w-4" />
                  {v.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {searching && resultCount > 0 && (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Buscando más resultados…
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
