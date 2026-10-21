/**
 * Catálogo de frases suaves (modo zen). Reescribe el tono de los avisos sin tocar su significado:
 * el detalle técnico se conserva como descripción y los textos ya amables no se modifican.
 * Ver docs/direccion-visual-zen-glass.md.
 */

export type ToastKind = "success" | "error" | "warning" | "info";

export type SoftCopy = { message: string; description?: string };

const CALM_RETRY = "Inténtalo de nuevo en un momento.";

/** Éxitos frecuentes: texto exacto → versión cálida. */
const SUCCESS_PHRASES: Record<string, string> = {
  Guardado: "Guardado con calma",
  Listo: "Listo, todo en orden",
  "Cambios guardados": "Tus cambios ya están a salvo",
  "Progreso guardado": "Tu progreso ya está a salvo",
  "Copiado al portapapeles": "Copiado, listo para pegar",
  "Texto copiado": "Texto copiado, listo para pegar",
  "Link copiado": "Enlace copiado, listo para compartir",
  "Tarea completada": "Tarea completada, bien hecho",
  "Correo enviado": "Correo enviado, ya va en camino",
  "Borrador generado": "Tu borrador está listo",
  "Plantilla guardada": "Plantilla guardada con calma",
  "Nota agregada": "Nota agregada",
  "Estado actualizado": "Estado actualizado, todo al día",
  "Proyecto creado exitosamente": "Proyecto creado, a trabajar con calma",
  "Colaborador agregado": "Colaborador agregado, bienvenido al equipo",
};

/** Instrucciones de validación: se suavizan con una cortesía al inicio. */
const GENTLE_PROMPT = /^(Selecciona|Escribe|Elige|Ingresa|Completa|Agrega|Guarda primero|Indica|Captura|Adjunta)\b/;

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function splitDetail(rest: string): { subject: string; detail?: string } {
  const i = rest.indexOf(":");
  if (i === -1) return { subject: rest.trim() };
  const detail = rest.slice(i + 1).trim();
  return { subject: rest.slice(0, i).trim(), detail: detail || undefined };
}

export function softenCopy(kind: ToastKind, message: string, description?: string): SoftCopy {
  const text = message.trim();

  if (kind === "success") {
    const phrase = SUCCESS_PHRASES[text];
    return { message: phrase ?? message, description };
  }

  if (kind === "error" || kind === "warning") {
    // Título "Error" a secas (la descripción ya trae el detalle)
    if (text === "Error") {
      return { message: "Algo no salió como esperábamos", description: description ?? CALM_RETRY };
    }

    // "Error: detalle" → mensaje genérico amable + detalle
    const generic = /^Error:\s*(.*)$/s.exec(text);
    if (generic) {
      return {
        message: "Algo no salió como esperábamos",
        description: description ?? (generic[1] ? `${generic[1]} · ${CALM_RETRY}` : CALM_RETRY),
      };
    }

    // "Error al navegar Dropbox: detalle" → "No pudimos navegar Dropbox"
    const errorAl = /^Error al (.+)$/s.exec(text);
    if (errorAl) {
      const { subject, detail } = splitDetail(errorAl[1]);
      return {
        message: `No pudimos ${subject}`,
        description: description ?? (detail ? `${detail} · ${CALM_RETRY}` : CALM_RETRY),
      };
    }

    // "No se pudo actualizar: detalle" → "No pudimos actualizar"
    const noSePudo = /^No se pudo (.+)$/s.exec(text);
    if (noSePudo) {
      const { subject, detail } = splitDetail(noSePudo[1]);
      return {
        message: `No pudimos ${subject.replace(/\.$/, "")}`,
        description: description ?? (detail ? `${detail} · ${CALM_RETRY}` : CALM_RETRY),
      };
    }

    // Validaciones: "Escribe el acuerdo" → "Cuando puedas, escribe el acuerdo"
    if (GENTLE_PROMPT.test(text)) {
      return { message: `Cuando puedas, ${lowerFirst(text)}`, description };
    }
  }

  return { message, description };
}

type ToastFn = (message: unknown, data?: Record<string, unknown>) => unknown;
type ToastLike = Record<ToastKind, ToastFn>;

const INSTALLED = Symbol.for("kawiil.zenCopyInstalled");

/**
 * Envuelve toast.success/error/warning/info una sola vez. Como `toast` es el mismo objeto para
 * todos los importadores de "sonner", el tono se aplica a toda la app sin editar cada llamada.
 */
export function installZenCopy(toast: ToastLike): void {
  const marker = toast as unknown as Record<symbol, boolean>;
  if (marker[INSTALLED]) return;
  marker[INSTALLED] = true;

  (["success", "error", "warning", "info"] as const).forEach((kind) => {
    const original = toast[kind].bind(toast);
    toast[kind] = (message, data) => {
      if (typeof message !== "string") return original(message, data);
      const rawDescription = typeof data?.description === "string" ? (data.description as string) : undefined;
      if (data?.description !== undefined && rawDescription === undefined) return original(message, data);
      const soft = softenCopy(kind, message, rawDescription);
      return original(soft.message, soft.description ? { ...data, description: soft.description } : data);
    };
  });
}

type RadixToastProps = { title?: unknown; description?: unknown; variant?: string };

/**
 * Versión para `useToast` (Radix): suaviza título y descripción de texto plano.
 * Con variant "destructive" aplica el tono de error; el resto, el de éxito/información.
 */
export function softenRadixToast<T extends RadixToastProps>(props: T): T & RadixToastProps {
  if (typeof props.title !== "string") return props;
  if (props.description !== undefined && typeof props.description !== "string") return props;
  const kind: ToastKind = props.variant === "destructive" ? "error" : "success";
  const soft = softenCopy(kind, props.title, props.description as string | undefined);
  return soft.description !== undefined
    ? { ...props, title: soft.message, description: soft.description }
    : { ...props, title: soft.message };
}
