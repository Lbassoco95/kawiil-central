import {
  FileText,
  Eye,
  Users,
  Handshake,
  Receipt,
  BarChart3,
  FileType2,
  FileSpreadsheet,
  Presentation,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getTemplateMeta,
  FORMAT_LABEL,
  type KawiilTemplateKey,
  type KawiilOutputFormat,
} from "@/lib/ai-templates";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_SOFT_BG } from "@/lib/kawiilAi";

interface ArtifactCardProps {
  artifactId: string;
  title: string;
  /** Formato del marcador: "kawiil:{template}:{format}" | "office:{kind}" | contentType. */
  contentType: string;
  onView: (id: string) => void;
}

/**
 * Tarjeta inline dentro del chat que representa un artifact generado.
 *
 * Interpreta 3 formatos del marcador [artifact:...|contentType]:
 *  - "kawiil:{template_key}:{primary_format}" → card v2.5 con icono por template.
 *  - "office:{kind}"                         → card legacy para docs Office anteriores.
 *  - cualquier otra cosa                     → card genérica de markdown.
 */
export function ArtifactCard({ artifactId, title, contentType, onView }: ArtifactCardProps) {
  const [rawTag, ...rest] = contentType.split(":");
  const kind = rawTag || contentType;

  // Caso 1: artifact Kawiil con template + formato primario.
  if (kind === "kawiil" && rest.length >= 2) {
    const [templateKey, primaryFormat] = rest as [KawiilTemplateKey, KawiilOutputFormat];
    const meta = getTemplateMeta(templateKey);
    const TemplateIcon = iconFor(meta?.icon || "FileType2");

    return (
      <div
        className="my-2 rounded-lg border border-sky-200 p-3 flex items-center gap-3"
        style={{ background: KAWIIL_AI_SOFT_BG }}
      >
        <div
          className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 text-white shadow-sm"
          style={{ background: KAWIIL_AI_GRADIENT }}
        >
          <TemplateIcon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold truncate">{title}</p>
            <Badge variant="secondary" className="text-[9px] h-4 px-1.5 bg-white border-sky-200 text-sky-700">
              {(FORMAT_LABEL[primaryFormat] || primaryFormat.toUpperCase())}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground">
            KAWIIL AI · {meta?.shortLabel || "Documento"}
          </p>
        </div>
        <Button size="sm" variant="default" className="h-7 text-xs gap-1 bg-sky-600 hover:bg-sky-700" onClick={() => onView(artifactId)}>
          <Eye className="h-3 w-3" /> Abrir
        </Button>
      </div>
    );
  }

  // Caso 2: legacy office.
  if (kind === "office") {
    const officeKind = rest[0];
    const officeLabel = officeKind === "spreadsheet"
      ? "Excel"
      : officeKind === "presentation"
      ? "PowerPoint"
      : officeKind === "word_document"
      ? "Word"
      : "Office";
    const OfficeIcon = officeKind === "spreadsheet"
      ? FileSpreadsheet
      : officeKind === "presentation"
      ? Presentation
      : FileType2;

    return (
      <div className="my-2 rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <OfficeIcon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          <p className="text-[10px] text-muted-foreground">{officeLabel}</p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onView(artifactId)}>
          <Eye className="h-3 w-3" /> Ver
        </Button>
      </div>
    );
  }

  // Caso 3: artifact genérico markdown/code/html/csv/pdf.
  return (
    <div className="my-2 rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-center gap-3">
      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <FileText className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-[10px] text-muted-foreground">{contentType}</p>
      </div>
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onView(artifactId)}>
        <Eye className="h-3 w-3" /> Ver
      </Button>
    </div>
  );
}

function iconFor(name: string) {
  switch (name) {
    case "FileText":
      return FileText;
    case "Users":
      return Users;
    case "Handshake":
      return Handshake;
    case "Receipt":
      return Receipt;
    case "BarChart3":
      return BarChart3;
    case "FileType2":
    default:
      return FileType2;
  }
}
