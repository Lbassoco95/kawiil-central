import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDocuments, useDeleteDocument } from "@/hooks/useDocuments";
import { DocumentFormDialog } from "@/components/documents/DocumentFormDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { formatMX } from "@/lib/dateUtils";
import {
  Plus, Search, FileText, Link, ExternalLink, Trash2, Upload,
  Calendar, User, FolderOpen
} from "lucide-react";

const Documentos = () => {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; source: string; file_path: string | null } | null>(null);

  const { data: documents, isLoading } = useDocuments({ search, source: sourceFilter });
  const deleteDocument = useDeleteDocument();

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Documentos</h1>
            <p className="text-sm text-muted-foreground">Repositorio de documentos internos</p>
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
              onChange={(e) => setSearch(e.target.value)}
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
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <Card key={doc.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {doc.source === "dropbox" ? (
                        <Link className="h-5 w-5 text-blue-500" />
                      ) : (
                        <Upload className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-foreground truncate">
                          {doc.name}
                        </span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {doc.source === "dropbox" ? "Dropbox" : "Archivo"}
                        </Badge>
                        {doc.document_type && (
                          <Badge variant="secondary" className="text-xs shrink-0">
                            {doc.document_type}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        {(doc as any).clients?.name && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {(doc as any).clients.name}
                          </span>
                        )}
                        {(doc as any).projects?.name && (
                          <span className="flex items-center gap-1">
                            <FolderOpen className="h-3 w-3" />
                            {(doc as any).projects.name}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatMX(doc.created_at, "dd MMM yyyy")}
                        </span>
                        {doc.uploader_profile && (
                          <span>por {doc.uploader_profile.full_name}</span>
                        )}
                        {doc.file_size && (
                          <span>{(doc.file_size / 1024).toFixed(0)} KB</span>
                        )}
                      </div>

                      {doc.source === "dropbox" && doc.external_path && (
                        <a
                          href={doc.external_path}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1 truncate"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {doc.external_path}
                        </a>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget({ id: doc.id, source: doc.source, file_path: doc.file_path })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
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
    </AppLayout>
  );
};

export default Documentos;
