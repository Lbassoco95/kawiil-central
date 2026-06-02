import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const SECTIONS: { title: string; steps: string[] }[] = [
  {
    title: "1 · Reclutamiento (ATS)",
    steps: [
      "Crea una vacante (trae fases, estados y rúbrica por defecto).",
      "Agrega candidatos o impórtalos por CSV/Excel; adjunta su CV.",
      "Arrastra las tarjetas entre fases; en la ficha califica la rúbrica y manda correos con plantillas.",
      "Con “Entrevistadores” asignas evaluadores que solo ven esa vacante.",
    ],
  },
  {
    title: "2 · De candidato a colaborador",
    steps: [
      "En la ficha del candidato (G4): “Convertir a colaborador”.",
      "Eliges rol; se crea la cuenta, se envía el correo de acceso y se queda “Contratado”.",
      "Se inicia automáticamente su lista de bienvenida.",
    ],
  },
  {
    title: "3 · Checklist de bienvenida",
    steps: [
      "G4 define los pasos en “Plantilla de bienvenida” (pestaña Expedientes).",
      "Cada colaborador la ve y marca en “Mi expediente”; G4 también la marca.",
    ],
  },
  {
    title: "4 · Expediente digital",
    steps: [
      "El colaborador captura sus datos y sube sus 8 documentos en “Mi expediente”.",
      "G4 revisa y verifica o rechaza cada documento (el rechazo lleva motivo).",
    ],
  },
  {
    title: "5 · Cuestionarios (NOM-035 y clima)",
    steps: [
      "G4 activa el cuestionario en “Resultados RH”; puede editar ítems y marcar inversos.",
      "El colaborador responde en “Cuestionarios” (confidencial).",
      "G4 ve resultados agregados con semáforo; nunca respuestas individuales.",
    ],
  },
  {
    title: "6 · Tablero RH",
    steps: [
      "Indicadores del equipo y lista de pendientes.",
      "“Recordar” envía un correo al colaborador con lo que le falta.",
      "Exporta expedientes y resultados a Excel.",
    ],
  },
];

export function GuiaRHDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Guía de uso · RH</DialogTitle>
          <DialogDescription>Flujo de reclutamiento → contratación → bienvenida → expediente → cuestionarios.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <p className="text-sm font-semibold">{s.title}</p>
              <ul className="mt-1 space-y-1">
                {s.steps.map((st, i) => (
                  <li key={i} className="text-sm text-muted-foreground">• {st}</li>
                ))}
              </ul>
            </div>
          ))}
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            NOM-035: el contenido es editable; valida texto, ítems inversos y rangos contra el documento oficial del DOF antes de aplicarlo formalmente.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
