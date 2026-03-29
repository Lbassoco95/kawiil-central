import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  BookOpen, Database, FileText, MessageSquare, BrainCircuit,
  FolderSync, Loader2, Search, RefreshCcw, Plus, Sparkles,
  BarChart3, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { useAiProjects } from "@/hooks/useAiProjects";

const BaseConocimiento = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { projects, createProject } = useAiProjects();

  const [dropboxPath, setDropboxPath] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formInstructions, setFormInstructions] = useState("");

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["embedding-stats"],
    queryFn: async () => {
      const orgRes = await supabase.rpc("get_user_org_id" as any, { _user_id: user!.id });
      const { data, error } = await supabase.rpc("embedding_stats" as any, { org_id: orgRes.data });
      if (error) throw error;
      return data as { source_type: string; chunk_count: number; avg_tokens: number }[];
    },
    enabled: !!user,
  });

  const totalChunks = stats?.reduce((s, r) => s + (r.chunk_count || 0), 0) ?? 0;

  const handleIndexDropbox = async () => {
    if (!dropboxPath.trim()) return;
    setIndexing(true);
    try {
      const orgRes = await supabase.rpc("get_user_org_id" as any, { _user_id: user!.id });
      const { data, error } = await supabase.functions.invoke("index-dropbox", {
        body: { folder_path: dropboxPath.trim(), organization_id: orgRes.data, recursive: true },
      });
      if (error) throw error;
      toast.success(`Indexado: ${data.registered} archivos nuevos, ${data.embedded_chunks} chunks creados`);
      qc.invalidateQueries({ queryKey: ["embedding-stats"] });
    } catch (err: any) {
      toast.error(`Error al indexar: ${err.message}`);
    } finally {
      setIndexing(false);
    }
  };

  const processExisting = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("process-embeddings", { body: { batch_size: 50 } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Procesado: ${data?.total_embedded ?? 0} chunks nuevos creados`);
      qc.invalidateQueries({ queryKey: ["embedding-stats"] });
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  const handleCreateProject = async () => {
    if (!formName.trim()) return;
    try {
      const proj = await createProject.mutateAsync({
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        instructions: formInstructions.trim() || undefined,
      });
      setShowCreateProject(false);
      setFormName("");
      setFormDesc("");
      setFormInstructions("");
      toast.success("Proyecto creado");
      navigate(`/asistente?project=${proj.id}`);
    } catch {
      toast.error("Error al crear proyecto");
    }
  };

  const sourceIcon = (type: string) => {
    switch (type) {
      case "document": return <FileText className="h-4 w-4 text-blue-500" />;
      case "extracted_data": return <Database className="h-4 w-4 text-green-500" />;
      case "chat_message": return <MessageSquare className="h-4 w-4 text-purple-500" />;
      case "procedure": return <BookOpen className="h-4 w-4 text-orange-500" />;
      case "comunicado": return <BarChart3 className="h-4 w-4 text-pink-500" />;
      case "memory": return <BrainCircuit className="h-4 w-4 text-cyan-500" />;
      case "artifact": return <Sparkles className="h-4 w-4 text-amber-500" />;
      default: return <Database className="h-4 w-4 text-gray-500" />;
    }
  };

  const sourceLabel = (type: string) => {
    const labels: Record<string, string> = {
      document: "Documentos",
      extracted_data: "Datos extraidos",
      chat_message: "Conversaciones",
      procedure: "Procedimientos",
      comunicado: "Comunicados",
      memory: "Memorias",
      artifact: "Artifacts",
    };
    return labels[type] || type;
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-primary" />
              Base de Conocimiento
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Dashboard del conocimiento de la IA: embeddings, proyectos y acciones globales
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => processExisting.mutate()}
              disabled={processExisting.isPending}
            >
              {processExisting.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
              Reindexar contenido
            </Button>
            <Button size="sm" onClick={() => setShowCreateProject(true)}>
              <Plus className="h-4 w-4 mr-2" /> Nuevo proyecto IA
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {statsLoading ? (
            <Card className="col-span-full flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Database className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Total chunks</span>
                  </div>
                  <p className="text-2xl font-bold">{totalChunks}</p>
                </CardContent>
              </Card>
              {stats?.map((s) => (
                <Card key={s.source_type}>
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-center gap-2 mb-1">
                      {sourceIcon(s.source_type)}
                      <span className="text-xs text-muted-foreground">{sourceLabel(s.source_type)}</span>
                    </div>
                    <p className="text-2xl font-bold">{s.chunk_count}</p>
                    <p className="text-[10px] text-muted-foreground">~{Math.round(s.avg_tokens)} tokens/chunk</p>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </div>

        {/* Dropbox indexing */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderSync className="h-4 w-4" /> Indexar desde Dropbox
            </CardTitle>
            <CardDescription>
              Escanea una carpeta de Dropbox, registra los archivos y genera embeddings automaticamente
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="/Kawiil/Clientes/NombreCliente"
                value={dropboxPath}
                onChange={(e) => setDropboxPath(e.target.value)}
                className="flex-1"
              />
              <Button onClick={handleIndexDropbox} disabled={indexing || !dropboxPath.trim()}>
                {indexing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                Indexar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* AI Projects - link cards */}
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" /> Proyectos de IA
          </h2>
          {projects.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <BrainCircuit className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No tienes proyectos de IA</p>
                <p className="text-xs text-muted-foreground/60 mt-1 mb-4">
                  Crea proyectos para dar contexto persistente a Kawiil AI
                </p>
                <Button size="sm" onClick={() => setShowCreateProject(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Crear primer proyecto
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((proj) => (
                <Card
                  key={proj.id}
                  className="cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all group"
                  onClick={() => navigate(`/asistente?project=${proj.id}`)}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BrainCircuit className="h-4 w-4 text-primary" />
                      {proj.name}
                      <ArrowRight className="h-3.5 w-3.5 ml-auto text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </CardTitle>
                    {proj.description && (
                      <CardDescription className="text-xs line-clamp-2">{proj.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="pt-0 pb-3">
                    {proj.instructions && (
                      <p className="text-[11px] text-muted-foreground bg-secondary/40 rounded px-2 py-1 line-clamp-2">
                        {proj.instructions}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Creado {new Date(proj.created_at).toLocaleDateString("es-MX")}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Project Dialog */}
      <Dialog open={showCreateProject} onOpenChange={setShowCreateProject}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-primary" /> Nuevo Proyecto de IA
            </DialogTitle>
            <DialogDescription>
              Crea un espacio con instrucciones personalizadas para que la IA tenga contexto persistente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Nombre</label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ej: Cumplimiento PLD" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Descripcion</label>
              <Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Proposito del proyecto" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Instrucciones para la IA</label>
              <Textarea value={formInstructions} onChange={(e) => setFormInstructions(e.target.value)} placeholder="Ej: Siempre referencia la ley de PLD..." rows={3} className="resize-none" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateProject(false)}>Cancelar</Button>
            <Button onClick={handleCreateProject} disabled={!formName.trim() || createProject.isPending}>
              {createProject.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default BaseConocimiento;
