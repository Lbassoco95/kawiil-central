import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, Loader2, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { useImportCandidates, type ImportCandidateRow } from "@/hooks/useRecruitment";
import type { EducationStatus } from "@/lib/recruitment";

interface FieldDef {
  key: keyof ImportCandidateRow;
  label: string;
  required?: boolean;
  guess: string[];
}

const FIELDS: FieldDef[] = [
  { key: "full_name", label: "Nombre completo", required: true, guess: ["nombre", "name", "candidat"] },
  { key: "email", label: "Correo", guess: ["correo", "email", "mail"] },
  { key: "phone", label: "Teléfono", guess: ["tel", "phone", "celular", "movil"] },
  { key: "source", label: "Fuente", guess: ["fuente", "origen", "source", "canal"] },
  { key: "university", label: "Universidad", guess: ["universidad", "institucion", "escuela"] },
  { key: "degree", label: "Carrera", guess: ["carrera", "licenciatura", "grado", "degree"] },
  { key: "education_status", label: "Titulación", guess: ["titul", "estatus academico", "education"] },
  { key: "skills", label: "Software / habilidades", guess: ["software", "habilidad", "skill", "herramient"] },
  { key: "years_experience", label: "Años de experiencia", guess: ["experiencia", "anios", "years"] },
  { key: "salary_expectation", label: "Pretensión salarial", guess: ["pretension", "sueldo", "salario", "salary"] },
  { key: "available_from", label: "Disponible desde", guess: ["disponib", "inicio", "available"] },
  { key: "linkedin_url", label: "LinkedIn", guess: ["linkedin"] },
  { key: "portfolio_url", label: "Portafolio", guess: ["portafolio", "portfolio", "web"] },
];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDateISO(raw: string): string | null {
  const v = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function parseEducation(raw: string): EducationStatus | null {
  const v = norm(raw);
  if (v.includes("titul")) return "titulado";
  if (v.includes("pasante")) return "pasante";
  if (v.includes("trunc")) return "trunco";
  return null;
}

function coerce(key: keyof ImportCandidateRow, raw: string): unknown {
  const v = (raw ?? "").toString().trim();
  if (!v) return key === "skills" ? [] : null;
  switch (key) {
    case "skills": return v.split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
    case "years_experience":
    case "salary_expectation": return parseNumber(v);
    case "available_from": return parseDateISO(v);
    case "education_status": return parseEducation(v);
    default: return v;
  }
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  processId: string;
  firstStageId: string | null;
  defaultStateId: string | null;
}

export function CandidateImportDialog({ open, onOpenChange, processId, firstStageId, defaultStateId }: Props) {
  const importer = useImportCandidates();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});

  function reset() {
    setFileName(""); setHeaders([]); setRows([]); setMapping({});
  }

  async function handleFile(file: File) {
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" }) as unknown[][];
      const hdrs = (aoa[0] ?? []).map((c) => String(c).trim());
      const data = aoa.slice(1).map((r) => r.map((c) => String(c))).filter((r) => r.some((c) => c.trim() !== ""));
      if (hdrs.length === 0 || data.length === 0) {
        toast.error("El archivo no tiene filas de datos.");
        return;
      }
      // Auto-mapeo por nombre de columna.
      const guessed: Record<string, number> = {};
      FIELDS.forEach((f) => {
        const idx = hdrs.findIndex((h) => f.guess.some((g) => norm(h).includes(g)));
        if (idx >= 0) guessed[f.key] = idx;
      });
      setFileName(file.name);
      setHeaders(hdrs);
      setRows(data);
      setMapping(guessed);
    } catch (e) {
      toast.error((e as Error).message || "No se pudo leer el archivo");
    } finally {
      setParsing(false);
    }
  }

  function handleImport() {
    if (mapping.full_name == null) {
      toast.error("Mapea la columna del nombre completo.");
      return;
    }
    const parsed: ImportCandidateRow[] = rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (const f of FIELDS) {
        const idx = mapping[f.key];
        if (idx == null) continue;
        obj[f.key] = coerce(f.key, row[idx] ?? "");
      }
      return obj as ImportCandidateRow;
    });
    importer.mutate(
      { processId, stageId: firstStageId, stateId: defaultStateId, rows: parsed },
      { onSuccess: () => { onOpenChange(false); reset(); } },
    );
  }

  const validCount = headers.length
    ? rows.filter((r) => mapping.full_name != null && (r[mapping.full_name] ?? "").trim() !== "").length
    : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Importar candidatos (CSV o Excel)</DialogTitle></DialogHeader>

        {headers.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Sube un archivo <strong>.csv</strong> o <strong>.xlsx</strong> (por ejemplo, una exportación de Worky).
              La primera fila debe contener los encabezados de columna.
            </p>
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={parsing}>
              {parsing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
              Elegir archivo
            </Button>
            <input
              ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{fileName}</span>
              <span className="text-muted-foreground">· {rows.length} fila(s)</span>
            </p>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Relaciona cada campo con una columna del archivo:</Label>
              {FIELDS.map((f) => (
                <div key={f.key} className="grid grid-cols-2 items-center gap-2">
                  <span className="text-sm">
                    {f.label}{f.required && <span className="text-red-600"> *</span>}
                  </span>
                  <Select
                    value={mapping[f.key] != null ? String(mapping[f.key]) : "none"}
                    onValueChange={(v) =>
                      setMapping((m) => {
                        const next = { ...m };
                        if (v === "none") delete next[f.key];
                        else next[f.key] = Number(v);
                        return next;
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Ignorar —</SelectItem>
                      {headers.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>{h || `Columna ${i + 1}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Se importarán <strong>{validCount}</strong> candidato(s) con nombre. Entrarán en la primera fase y el estado inicial.
            </p>
          </div>
        )}

        <DialogFooter>
          {headers.length > 0 && (
            <Button variant="ghost" onClick={reset}>Cambiar archivo</Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {headers.length > 0 && (
            <Button onClick={handleImport} disabled={importer.isPending || validCount === 0}>
              {importer.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Importar {validCount > 0 ? `(${validCount})` : ""}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
