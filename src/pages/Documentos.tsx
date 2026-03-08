import { useState, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDocuments, useDeleteDocument } from "@/hooks/useDocuments";
import { DocumentFormDialog } from "@/components/documents/DocumentFormDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { DocumentPreviewDialog } from "@/components/documents/DocumentPreviewDialog";
import { formatMX } from "@/lib/dateUtils";
import {
  Plus, Search, FileText, Link, ExternalLink, Trash2, Upload,
  Calendar, User, Eye, Folder, FolderOpen, ChevronLeft, Image,
  FileSpreadsheet, File, FileCode
} from "lucide-react";

function getFileIcon(name: string, source: string) {
  if (source === "dropbox") return <Link className="h-4 w-4 text-blue-500" />;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext))
    return <Image className="h-4 w-4 text-emerald-500" />;
  if (["xls", "xlsx", "csv"].includes(ext))
    return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
  if (["pdf"].includes(ext))
    return <FileText className="h-4 w-4 text-red-500" />;
  if (["xml", "json"].includes(ext))
    return <FileCode className="h-4 w-4 text-orange-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type BreadcrumbItem = { label: string; key: string };

const Documentos = () => {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; source: string; file_path: string | null } | null>(null);
  const [previewDoc, setPreviewDoc] = useState<any>(null);

  // Navigation state: null = root, string = client_id or "sin_cliente", "client:id/project:id"
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);

  const { data: documents, isLoading } = useDocuments({ search, source: sourceFilter });
  const deleteDocument = useDeleteDocument();

  // Build virtual folder structure
  const { clientFolders, currentPath, currentDocs, currentSubfolders } = useMemo(() => {
    const docs = documents || [];

    // Group by client
    const byClient = new Map<string, { name: string; id: string; docs: typeof docs }>();
    const unassigned: typeof docs = [];

    for (const doc of docs) {
      const clientId = doc.client_id;
      const clientName = (doc as any).clients?.name;
      if (clientId && clientName) {
        if (!byClient.has(clientId)) {
          byClient.set(clientId, { name: clientName, id: clientId, docs: [] });
        }
        byClient.get(clientId)!.docs.push(doc);
      } else {
        unassigned.push(doc);
      }
    }

    const clientFolders = [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name));

    let currentPath: BreadcrumbItem[] = [{ label: "Documentos", key: "root" }];
    let currentDocs: typeof docs = [];
    let currentSubfolders: { label: string; key: string; count: number }[] = [];

    if (!currentFolder) {
      // Root level: show client folders + unassigned folder
      currentSubfolders = clientFolders.map((c) => ({
        label: c.name,
        key: `client:${c.id}`,
        count: c.docs.length,
      }));
      if (unassigned.length > 0) {
        currentSubfolders.push({
          label: "Sin cliente",
          key: "unassigned",
          count: unassigned.length,
        });
      }
    } else if (currentFolder === "unassigned") {
      currentPath.push({ label: "Sin cliente", key: "unassigned" });
      currentDocs = unassigned;
    } else if (currentFolder.startsWith("client:") && !currentFolder.includes("/project:")) {
      const clientId = currentFolder.replace("client:", "");
      const client = byClient.get(clientId);
      if (client) {
        currentPath.push({ label: client.name, key: currentFolder });

        // Group by project within client
        const byProject = new Map<string, { name: string; id: string; docs: typeof docs }>();
        const clientUnassigned: typeof docs = [];

        for (const doc of client.docs) {
          const projectId = doc.project_id;
          const projectName = (doc as any).projects?.name;
          if (projectId && projectName) {
            if (!byProject.has(projectId)) {
              byProject.set(projectId, { name: projectName, id: projectId, docs: [] });
            }
            byProject.get(projectId)!.docs.push(doc);
          } else {
            clientUnassigned.push(doc);
          }
        }

        currentSubfolders = [...byProject.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => ({
            label: p.name,
            key: `${currentFolder}/project:${p.id}`,
            count: p.docs.length,
          }));

        currentDocs = clientUnassigned;
      }
    } else if (currentFolder.includes("/project:")) {
      const [clientPart, projectPart] = currentFolder.split("/project:");
      const clientId = clientPart.replace("client:", "");
      const client = byClient.get(clientId);
      if (client) {
        currentPath.push({ label: client.name, key: clientPart });
        const projectDocs = client.docs.filter((d) => d.project_id === projectPart);
        const projectName = (projectDocs[0] as any)?.projects?.name || "Proyecto";
        currentPath.push({ label: projectName, key: currentFolder });
        currentDocs = projectDocs;
      }
    }

    return { clientFolders, currentPath, currentDocs, currentSubfolders };
  }, [documents, currentFolder]);

  const goToFolder = (key: string | null) => {
    setCurrentFolder(key === "root" ? null : key);
  };

  const goBack = () => {
    if (!currentFolder) return;
    if (currentFolder.includes("/project:")) {
      // Go up to client
      setCurrentFolder(currentFolder.split("/project:")[0]);
    } else {
      setCurrentFolder(null);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Documentos</h1>
            <p className="text-sm text-muted-foreground">Explorador de documentos</p>
          </div>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo documento
          </Button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar documentos..."
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentFolder(null); }}
            />
          </div>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="supabase">Archivos subidos</SelectItem>
              <SelectItem value="dropbox">Enlaces Dropbox</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Breadcrumbs */}
        {!search && (
          <div className="flex items-center gap-1 text-sm">
            {currentFolder && (
              <Button variant="ghost" size="sm" className="h-7 px-2 mr-1" onClick={goBack}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            {currentPath.map((crumb, i) => (
              <span key={crumb.key} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground">/</span>}
                <button
                  onClick={() => goToFolder(crumb.key)}
                  className={`hover:underline ${
                    i === currentPath.length - 1
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {i === 0 && <FolderOpen className="h-3.5 w-3.5 inline mr-1" />}
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Cargando...</div>
        ) : !documents || documents.length === 0 ? (
          <Card>
            <CardContent className="p-6">
              <div className="text-center py-12">
                <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
                <h3 className="mt-4 text-lg font-medium text-foreground">Sin documentos aún</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sube un archivo o pega un enlace de Dropbox para comenzar.
                </p>
                <Button className="mt-4" onClick={() => setFormOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Nuevo documento
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : search ? (
          /* Search mode: flat list */
          <div className="border rounded-lg divide-y">
            {(documents || []).map((doc) => (
              <FileRow
                key={doc.id}
                doc={doc}
                onPreview={() => setPreviewDoc(doc)}
                onDelete={() => setDeleteTarget({ id: doc.id, source: doc.source, file_path: doc.file_path })}
              />
            ))}
          </div>
        ) : (
          /* Folder browser mode */
          <div className="border rounded-lg divide-y">
            {currentSubfolders.length === 0 && currentDocs.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">Carpeta vacía</p>
            )}
            {currentSubfolders.map((folder) => (
              <button
                key={folder.key}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                onClick={() => goToFolder(folder.key)}
              >
                <Folder className="h-5 w-5 text-primary shrink-0" />
                <span className="text-sm font-medium truncate flex-1">{folder.label}</span>
                <Badge variant="secondary" className="text-xs shrink-0">
                  {folder.count} {folder.count === 1 ? "doc" : "docs"}
                </Badge>
              </button>
            ))}
            {currentDocs.map((doc) => (
              <FileRow
                key={doc.id}
                doc={doc}
                onPreview={() => setPreviewDoc(doc)}
                onDelete={() => setDeleteTarget({ id: doc.id, source: doc.source, file_path: doc.file_path })}
              />
            ))}
          </div>
        )}
      </div>

      <DocumentFormDialog open={formOpen} onOpenChange={setFormOpen} />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={() => {
          if (deleteTarget) {
            deleteDocument.mutate(deleteTarget);
            setDeleteTarget(null);
          }
        }}
        title="Eliminar documento"
        description="¿Estás seguro de que deseas eliminar este documento? Esta acción no se puede deshacer."
      />

      <DocumentPreviewDialog
        open={!!previewDoc}
        onOpenChange={(o) => { if (!o) setPreviewDoc(null); }}
        document={previewDoc}
      />
    </AppLayout>
  );
};

function FileRow({
  doc,
  onPreview,
  onDelete,
}: {
  doc: any;
  onPreview: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer group"
      onClick={onPreview}
    >
      <div className="shrink-0">{getFileIcon(doc.name, doc.source)}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-foreground">{doc.name}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          {doc.document_type && <span>{doc.document_type}</span>}
          <span>{formatMX(doc.created_at, "dd MMM yyyy")}</span>
          {doc.file_size ? <span>{formatFileSize(doc.file_size)}</span> : null}
          {doc.uploader_profile && <span>{doc.uploader_profile.full_name}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
        >
          <Eye className="h-4 w-4" />
        </Button>
        {doc.source === "dropbox" && doc.external_path && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-primary"
            onClick={(e) => { e.stopPropagation(); window.open(doc.external_path, "_blank"); }}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default Documentos;
