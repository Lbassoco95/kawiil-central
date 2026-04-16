import { FileText, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ArtifactCardProps {
  artifactId: string;
  title: string;
  contentType: string;
  onView: (id: string) => void;
}

export function ArtifactCard({ artifactId, title, contentType, onView }: ArtifactCardProps) {
  const isOffice = contentType.startsWith("office");
  const officeLabel = contentType === "office:spreadsheet"
    ? "Excel"
    : contentType === "office:presentation"
      ? "PowerPoint"
      : contentType === "office:word_document"
        ? "Word"
        : "Office";

  return (
    <div className="my-2 rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-center gap-3">
      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <FileText className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-[10px] text-muted-foreground">{isOffice ? officeLabel : contentType}</p>
      </div>
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onView(artifactId)}>
        <Eye className="h-3 w-3" /> Ver
      </Button>
    </div>
  );
}
