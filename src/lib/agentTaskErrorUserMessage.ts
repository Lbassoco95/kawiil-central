/**
 * Convierte `error_message` crudo de agent_tasks / VM en texto útil para el usuario.
 * No sustituye el arreglo en kawiil-agents (recorte de contexto); solo clarifica en UI.
 */
export function humanizeAgentErrorMessage(error: string | null): {
  title: string;
  /** Texto original para soporte / copiar, opcional en UI */
  raw?: string;
} {
  if (!error?.trim()) {
    return { title: "Error desconocido" };
  }
  const t = error.trim();
  const lower = t.toLowerCase();

  const tokenTooLong =
    lower.includes("prompt is too long") ||
    (lower.includes("invalid_request_error") && lower.includes("too long") && lower.includes("token")) ||
    /\b1\d{5,}\s*tokens?\s*>\s*200[,\s]*000/.test(t);

  if (tokenTooLong) {
    return {
      title:
        "El contexto de esta tarea supera el límite del modelo (aprox. 200.000 tokens). " +
        "Suele pasar con muchos documentos de conocimiento, adjuntos o un hilo muy largo metido en un solo envío. " +
        "Prueba: reducir documentos en el proyecto, dividir en varias tareas o pedir al equipo que recorte " +
        "el contexto en el servidor (kawiil-agents).",
      raw: t,
    };
  }

  return { title: t, raw: t.length > 400 ? t : undefined };
}
