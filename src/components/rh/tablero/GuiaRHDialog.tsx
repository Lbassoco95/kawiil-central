import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Section = { title: string; steps: string[] };

const USER_SECTIONS: Section[] = [
  {
    title: "Mi jornada",
    steps: [
      "Inicia tu jornada eligiendo modalidad: 🏢 oficina, 🏠 home office o 🚶 comisión.",
      "Usa Ir a comer 🍴, Descanso ☕ y Terminar jornada.",
      "🚗 En trayecto: tócalo al ir en camino (sigues trabajando); al llegar, “Llegué”.",
    ],
  },
  {
    title: "Mi estado en Slack (no verbal)",
    steps: [
      "Se actualiza solo: 🏢 oficina · 🏠 home office · 🚶 comisión · 🍴 comida · ☕ descanso · 🚗 trayecto.",
      "🗓️ En reunión aparece solo cuando tienes un evento en curso en tu Outlook.",
      "Requiere conectar Slack (y Outlook para reuniones) en tus ajustes.",
    ],
  },
  {
    title: "Solicitudes",
    steps: [
      "Pide vacaciones, permiso, día personal, evento o incapacidad.",
      "Día de burnout 😮‍💨: un día, se aprueba al instante, 2 al año.",
    ],
  },
  {
    title: "Mi expediente",
    steps: [
      "Captura tus datos (RFC, CURP, NSS, CLABE, domicilio, contacto de emergencia).",
      "Sube tus 8 documentos; verás su estado (En revisión / Verificado / Rechazado con motivo).",
      "Entra cuando quieras a actualizar tu información.",
    ],
  },
  {
    title: "Cuestionarios",
    steps: [
      "Responde los cuestionarios abiertos (NOM-035, clima).",
      "Tus respuestas son confidenciales: solo se reportan de forma agregada.",
    ],
  },
];

const G4_SECTIONS: Section[] = [
  {
    title: "Reclutamiento",
    steps: [
      "Crea vacantes (traen fases, estados y rúbrica).",
      "Agrega/importa candidatos, califica la rúbrica y manda correos con plantillas.",
      "Convertir a colaborador: crea la cuenta, envía el correo de acceso e inicia la bienvenida.",
    ],
  },
  {
    title: "Expedientes",
    steps: [
      "Revisa los datos y verifica/rechaza cada documento (el rechazo lleva motivo).",
      "Edita la “Plantilla de bienvenida” que reciben los nuevos.",
    ],
  },
  {
    title: "Resultados RH (cuestionarios)",
    steps: [
      "Activa/cierra cuestionarios; con “Editar” ajustas ítems y marcas inversos (valida NOM-035 vs DOF).",
      "Ves resultados agregados con semáforo; nunca respuestas individuales.",
    ],
  },
  {
    title: "Tablero RH",
    steps: [
      "Indicadores del equipo y lista de pendientes.",
      "“Recordar” envía correo al colaborador; exporta expedientes y resultados a Excel.",
    ],
  },
  {
    title: "Estados de Slack del equipo",
    steps: [
      "Se sincronizan solos con jornada y calendario; 🗓️ “En reunión” usa el Outlook de cada quien.",
      "Cada persona debe tener Slack (y Outlook) conectado para que se le fije el estado.",
    ],
  },
];

export function GuiaRHDialog({ open, onOpenChange, isG4 = false }: { open: boolean; onOpenChange: (v: boolean) => void; isG4?: boolean }) {
  const sections = isG4 ? [...USER_SECTIONS, ...G4_SECTIONS] : USER_SECTIONS;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Guía de uso · RH {isG4 ? "(G4)" : ""}</DialogTitle>
          <DialogDescription>
            {isG4 ? "Lo tuyo como colaborador más las pestañas de gestión." : "Lo que puedes hacer en Recursos Humanos."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {sections.map((s) => (
            <div key={s.title}>
              <p className="text-sm font-semibold">{s.title}</p>
              <ul className="mt-1 space-y-1">
                {s.steps.map((st, i) => (
                  <li key={i} className="text-sm text-muted-foreground">• {st}</li>
                ))}
              </ul>
            </div>
          ))}
          {isG4 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
              NOM-035: valida texto, ítems inversos y rangos contra el documento oficial del DOF antes de aplicarlo formalmente.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
