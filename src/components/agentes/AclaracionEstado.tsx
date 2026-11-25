import { ACLARACIONES, type EstadoAclarable } from "@/lib/agentes/aclaraciones";

// «Qué significa …»: separa lo que Kawiil hace valer de lo que depende de la VM. Siempre visible como texto (plegado), nunca solo en un tooltip.
export function AclaracionEstado({ estado, id }: { estado: EstadoAclarable; id: string }) {
  const a = ACLARACIONES[estado];
  return (
    <details className="text-xs" data-testid={`aclaracion-${estado}-${id}`}>
      <summary className="min-h-11 cursor-pointer select-none py-3 font-medium underline decoration-dotted md:min-h-0 md:py-0.5">Qué significa «{a.titulo}»</summary>
      <div className="mt-1 space-y-1 rounded-xl border border-border/50 bg-background/60 p-2">
        <p className="font-medium">Lo que Kawiil hace valer</p>
        <ul className="list-disc pl-4 text-muted-foreground">{a.kawiil.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="font-medium">Lo que depende de la VM (no está garantizado desde aquí)</p>
        <ul className="list-disc pl-4 text-muted-foreground">{a.vm.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
    </details>
  );
}
