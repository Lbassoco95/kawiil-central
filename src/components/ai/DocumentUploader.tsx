import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";

interface DocumentUploaderProps {
  onUpload: (file: File) => void;
  uploading: boolean;
  progress: string;
}

export function DocumentUploader({ onUpload, uploading, progress }: DocumentUploaderProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      e.target.value = "";
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept=".pdf,.xml,.txt,.md,.docx,.xlsx,.csv,.json,.png,.jpg,.jpeg"
        onChange={handleChange}
      />
      <Button
        size="sm"
        variant="outline"
        className="w-full h-8 text-xs gap-1.5"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            {progress || "Subiendo..."}
          </>
        ) : (
          <>
            <Upload className="h-3 w-3" /> Subir archivo
          </>
        )}
      </Button>
    </>
  );
}
