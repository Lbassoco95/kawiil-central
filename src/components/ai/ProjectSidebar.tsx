import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Trash2, MessageSquare, FolderOpen, Folder, FolderPlus,
  MoreHorizontal, Pencil, FolderInput, ChevronDown, ChevronRight,
  BrainCircuit, ArrowLeft, Settings2, Users, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMX } from "@/lib/dateUtils";
import type { ChatConversation } from "@/hooks/useChat";
import type { AiProject } from "@/hooks/useAiProjects";

const FOLDER_PRESETS = [
  "Proyectos", "Contabilidad", "Legal", "Redaccion", "Consultas", "Ideas",
];

interface ProjectSidebarProps {
  activeProject: AiProject | null;
  aiProjects: AiProject[];
  activeAiProjectId: string | null;
  activeConversationId: string | null;
  filteredConversations: ChatConversation[];
  onSelectProject: (id: string | null) => void;
  onNewChat: () => void;
  onLoadConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onMoveConversation: (id: string, folder: string | null) => void;
  onCreateProject: () => void;
  onArchiveProject: (id: string) => void;
  onLeaveProject?: (id: string) => void;
  onUpdateInstructions: (id: string, instructions: string) => void;
  currentUserId?: string | null;
  onOpenMembers?: () => void;
}

export function ProjectSidebar({
  activeProject, aiProjects, activeAiProjectId, activeConversationId,
  filteredConversations, onSelectProject, onNewChat, onLoadConversation,
  onDeleteConversation, onRenameConversation, onMoveConversation,
  onCreateProject, onArchiveProject, onLeaveProject, onUpdateInstructions,
  currentUserId, onOpenMembers,
}: ProjectSidebarProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["__none__"]));
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [editInstructions, setEditInstructions] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  const groupedConversations = (() => {
    const groups: Record<string, ChatConversation[]> = {};
    filteredConversations.forEach((c) => {
      const key = c.folder || "__none__";
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    return groups;
  })();

  const folders = [...new Set([...Object.keys(groupedConversations).filter(f => f !== "__none__"), ...customFolders])].sort();

  const toggleFolder = (f: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  };

  const handleRename = (id: string) => {
    if (renameValue.trim()) {
      onRenameConversation(id, renameValue.trim());
    }
    setRenamingId(null);
  };

  const renderConversation = (c: ChatConversation) => (
    <div
      key={c.id}
      className={cn(
        "group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm cursor-pointer transition-colors",
        activeConversationId === c.id
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      )}
      onClick={() => onLoadConversation(c.id)}
    >
      {c.ai_project_id ? (
        <span title="Chat de proyecto IA" className="inline-flex">
          <BrainCircuit className="h-3 w-3 shrink-0 text-primary" />
        </span>
      ) : (
        <MessageSquare className="h-3 w-3 shrink-0" />
      )}
      {renamingId === c.id ? (
        <input
          ref={renameRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => handleRename(c.id)}
          onKeyDown={(e) => { if (e.key === "Enter") handleRename(c.id); if (e.key === "Escape") setRenamingId(null); }}
          className="flex-1 text-[12px] bg-transparent outline-none border-b border-primary/50"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="flex-1 min-w-0">
          <p className="text-[9px] text-muted-foreground tabular-nums">
            {formatMX(c.updated_at, "d MMM yyyy")}
          </p>
          <span className="block truncate text-[12px] leading-tight">{c.title}</span>
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity shrink-0"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setRenamingId(c.id); setRenameValue(c.title); }}>
            <Pencil className="h-3 w-3 mr-2" /> Renombrar
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><FolderInput className="h-3 w-3 mr-2" /> Mover a...</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {[...new Set([...FOLDER_PRESETS, ...customFolders])].map((f) => (
                <DropdownMenuItem key={f} onClick={(e) => { e.stopPropagation(); onMoveConversation(c.id, f); }}>
                  {f}
                </DropdownMenuItem>
              ))}
              {c.folder && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onMoveConversation(c.id, null); }}>
                    Sin carpeta
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteConversation(c.id); }}>
            <Trash2 className="h-3 w-3 mr-2" /> Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div className="w-64 shrink-0 border-r border-border/40 flex flex-col bg-secondary/10">
      {/* New conversation CTA */}
      <div className="p-2 border-b border-border/30">
        <button
          type="button"
          onClick={onNewChat}
          className="group flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium text-white shadow-sm transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)",
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Nueva conversación
        </button>
      </div>

      {/* Project header or project list */}
      {activeProject ? (
        <div className="border-b border-border/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <BrainCircuit className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-xs font-semibold truncate">{activeProject.name}</span>
              {currentUserId && activeProject.user_id !== currentUserId && (
                <span className="text-[8px] bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1 rounded shrink-0">Compartido</span>
              )}
            </div>
            <div className="flex items-center shrink-0">
              {onOpenMembers && (
                <Button size="sm" variant="ghost" onClick={onOpenMembers} className="h-6 w-6 p-0" title="Miembros">
                  <Users className="h-3 w-3" />
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onSelectProject(null)} className="h-6 w-6 p-0" title="Salir del proyecto">
                <ArrowLeft className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {activeProject.description && (
            <p className="text-[10px] text-muted-foreground leading-relaxed">{activeProject.description}</p>
          )}

          {/* Instructions - always visible */}
          <div className="rounded-md bg-secondary/40 p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                <Settings2 className="h-2.5 w-2.5" /> Instrucciones
              </span>
              {!editingInstructions && currentUserId && activeProject.user_id === currentUserId && (
                <button
                  onClick={() => {
                    setEditInstructions(activeProject.instructions || "");
                    setEditingInstructions(true);
                  }}
                  className="text-[9px] text-primary hover:underline"
                >
                  {activeProject.instructions ? "Editar" : "Agregar"}
                </button>
              )}
            </div>
            {editingInstructions ? (
              <div className="space-y-1.5">
                <Textarea
                  value={editInstructions}
                  onChange={(e) => setEditInstructions(e.target.value)}
                  placeholder="Instrucciones para la IA en este proyecto..."
                  rows={3}
                  className="text-[11px] resize-none"
                  autoFocus
                />
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="h-5 text-[9px] flex-1"
                    onClick={() => {
                      onUpdateInstructions(activeProject.id, editInstructions);
                      setEditingInstructions(false);
                    }}
                  >
                    Guardar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 text-[9px]"
                    onClick={() => setEditingInstructions(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : activeProject.instructions ? (
              <p className="text-[10px] text-foreground/80 leading-relaxed whitespace-pre-wrap line-clamp-6">
                {activeProject.instructions}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground/50 italic">
                Sin instrucciones. Agrega indicaciones para personalizar la IA.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="border-b border-border/30">
          <div className="p-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <BrainCircuit className="h-3 w-3" /> Proyectos IA
            </span>
            <Button size="sm" variant="ghost" onClick={onCreateProject} className="h-7 w-7 p-0">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="px-2 pb-2 space-y-0.5">
            {aiProjects.length === 0 ? (
              <p className="text-[10px] text-muted-foreground/60 px-2 py-1">
                Crea un proyecto para dar contexto persistente a la IA
              </p>
            ) : (
              aiProjects.map((proj) => (
                <div
                  key={proj.id}
                  className={cn(
                    "group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm cursor-pointer transition-colors",
                    activeAiProjectId === proj.id
                      ? "bg-primary/15 text-foreground ring-1 ring-primary/30"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  )}
                  onClick={() => onSelectProject(activeAiProjectId === proj.id ? null : proj.id)}
                >
                  <BrainCircuit className="h-3 w-3 shrink-0 text-primary/70" />
                  <span className="truncate flex-1 text-[12px]">{proj.name}</span>
                  {currentUserId && proj.user_id !== currentUserId && (
                    <span className="text-[7px] uppercase tracking-tighter text-amber-700 dark:text-amber-400 shrink-0">Eq.</span>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity shrink-0">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      {currentUserId && proj.user_id === currentUserId && (
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchiveProject(proj.id); }}>
                          <Trash2 className="h-3 w-3 mr-2" /> Archivar
                        </DropdownMenuItem>
                      )}
                      {currentUserId && proj.user_id !== currentUserId && onLeaveProject && (
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onLeaveProject(proj.id); }}>
                          <LogOut className="h-3 w-3 mr-2" /> Salir del proyecto
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Conversations header */}
      <div className="p-3 flex items-center justify-between border-b border-border/30">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {activeProject ? "Conversaciones" : "Chats"}
        </span>
        <div className="flex items-center gap-0.5">
          <Button size="sm" variant="ghost" onClick={() => setShowNewFolder(true)} className="h-7 w-7 p-0" title="Nueva carpeta">
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onNewChat} className="h-7 w-7 p-0" title="Nueva conversacion">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {showNewFolder && (
        <div className="px-3 py-2 border-b border-border/30 flex gap-1.5">
          <Input
            placeholder="Nombre de carpeta..."
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newFolderName.trim()) { const name = newFolderName.trim(); setCustomFolders((prev) => prev.includes(name) ? prev : [...prev, name]); setExpandedFolders((prev) => new Set([...prev, name])); setShowNewFolder(false); setNewFolderName(""); } if (e.key === "Escape") setShowNewFolder(false); }}
            className="h-7 text-xs"
            autoFocus
          />
        </div>
      )}

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredConversations.length === 0 ? (
          <div className="text-center py-8 px-3">
            <FolderOpen className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Sin conversaciones</p>
          </div>
        ) : (
          <>
            {folders.map(folder => (
              <div key={folder}>
                <button
                  className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/40 transition-colors"
                  onClick={() => toggleFolder(folder)}
                >
                  {expandedFolders.has(folder) ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                  <Folder className="h-3 w-3 shrink-0" />
                  <span className="truncate flex-1 text-left">{folder}</span>
                  <span className="text-[10px] text-muted-foreground/60">{groupedConversations[folder]?.length}</span>
                </button>
                {expandedFolders.has(folder) && (
                  <div className="ml-3 pl-2 border-l border-border/30 space-y-0.5 mt-0.5">
                    {groupedConversations[folder]?.map(renderConversation)}
                  </div>
                )}
              </div>
            ))}

            {groupedConversations["__none__"]?.length > 0 && (
              <div>
                {folders.length > 0 && (
                  <button
                    className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/40 transition-colors"
                    onClick={() => toggleFolder("__none__")}
                  >
                    {expandedFolders.has("__none__") ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    <MessageSquare className="h-3 w-3 shrink-0" />
                    <span className="truncate flex-1 text-left">General</span>
                    <span className="text-[10px] text-muted-foreground/60">{groupedConversations["__none__"]?.length}</span>
                  </button>
                )}
                {(expandedFolders.has("__none__") || folders.length === 0) && (
                  <div className={folders.length > 0 ? "ml-3 pl-2 border-l border-border/30 space-y-0.5 mt-0.5" : "space-y-0.5"}>
                    {groupedConversations["__none__"]?.map(renderConversation)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
