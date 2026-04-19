import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Briefcase,
  Calendar,
  CheckSquare,
  FileText,
  FolderKanban,
  Handshake,
  Kanban,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
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
import { OPEN_COMMAND_PALETTE_EVENT } from "@/lib/openCommandPalette";
import { openNewTaskModal } from "@/lib/openNewTaskModal";

type ViewLink = {
  label: string;
  to: string;
  icon: any;
  moduleKey?: string;
  shortcut?: string;
};

const VIEWS: ViewLink[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Tareas", to: "/tareas", icon: CheckSquare },
  { label: "Proyectos", to: "/proyectos", icon: FolderKanban },
  { label: "Clientes", to: "/clientes", icon: Users },
  { label: "Pipeline", to: "/pipeline", icon: Kanban, moduleKey: "pipeline" },
  { label: "Documentos", to: "/documentos", icon: FileText },
  { label: "Finanzas", to: "/finanzas", icon: Wallet, moduleKey: "finanzas" },
  { label: "Calendario", to: "/microsoft365/calendario", icon: Calendar, moduleKey: "calendario" },
  { label: "Correo", to: "/microsoft365/correo", icon: Mail, moduleKey: "correo" },
  { label: "Slack", to: "/comunicacion", icon: MessageSquare },
  { label: "Kawiil AI", to: "/asistente", icon: Sparkles, moduleKey: "ai" },
  { label: "Conocimiento", to: "/conocimiento", icon: BookOpen, moduleKey: "conocimiento" },
  { label: "Hub", to: "/hub", icon: Briefcase, moduleKey: "hub" },
  { label: "Configuración", to: "/configuracion", icon: Settings, moduleKey: "admin" },
];

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { hasModule } = useModulePermissions();
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  const { data: documents = [] } = useDocuments();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "k") return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) {
          if (!open) {
            // Allow opening from any context
          }
        }
      }
      e.preventDefault();
      setOpen((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const visibleViews = VIEWS.filter((v) => !v.moduleKey || hasModule(v.moduleKey));

  // Limit data lists for performance and relevance.
  const clientsLimited = clients.slice(0, 12);
  const tasksLimited = tasks.slice(0, 12);
  const documentsLimited = documents.slice(0, 12);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Buscar clientes, tareas, documentos, vistas…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>Sin resultados para “{search}”.</CommandEmpty>

        <CommandGroup heading="Acciones">
          <CommandItem
            value="acción nueva tarea crear"
            onSelect={() => {
              setOpen(false);
              openNewTaskModal();
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nueva tarea
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="kawiil ai asistente"
            onSelect={() => go("/asistente")}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Preguntar a Kawiil AI
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Vistas">
          {visibleViews.map((v) => (
            <CommandItem key={v.to} value={`vista ${v.label}`} onSelect={() => go(v.to)}>
              <v.icon className="mr-2 h-4 w-4" />
              {v.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {clientsLimited.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Clientes">
              {clientsLimited.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`cliente ${c.name} ${c.rfc ?? ""}`}
                  onSelect={() => go(`/clientes/${c.id}`)}
                >
                  <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{c.name}</span>
                  {c.rfc && (
                    <span className="ml-2 truncate text-xs text-muted-foreground">{c.rfc}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {tasksLimited.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tareas">
              {tasksLimited.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`tarea ${t.title}`}
                  onSelect={() => go(`/tareas?id=${t.id}`)}
                >
                  <CheckSquare className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{t.title}</span>
                  {t.status && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t.status}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {documentsLimited.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Documentos">
              {documentsLimited.map((d) => (
                <CommandItem
                  key={d.id}
                  value={`documento ${d.name}`}
                  onSelect={() => go(`/documentos?id=${d.id}`)}
                >
                  <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{d.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Pipeline">
          <CommandItem value="oportunidades pipeline lead" onSelect={() => go("/pipeline")}>
            <Handshake className="mr-2 h-4 w-4" />
            Ver oportunidades del pipeline
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
