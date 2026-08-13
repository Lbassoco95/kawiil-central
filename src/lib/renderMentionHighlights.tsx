import type { ReactNode } from "react";

/**
 * Resaltado de @menciones en textos de comentarios (tareas, proyecto, pasos, etc.).
 *
 * Debe alinearse con la detección en MentionTextarea, donde una mención se inserta
 * como `@Nombre Completo `. El problema a evitar es que, como los nombres llevan
 * espacios, un patrón "voraz" termina resaltando toda la frase que sigue a la
 * mención (p. ej. "@Habib Fernando ya solamente nos falta…"). Por eso acotamos la
 * mención al nombre real:
 *   1) Si se conocen los nombres del directorio (`knownNames`), se resalta
 *      exactamente el nombre más largo que coincida tras la `@`.
 *   2) Si no, se usa una heurística conservadora: la primera palabra y las
 *      siguientes solo mientras vengan capitalizadas (o sean partículas de
 *      nombre como "de"/"la" seguidas de otra palabra capitalizada).
 */

export type RenderMentionHighlightsOptions = {
  /** Por defecto `text-primary font-bold`. Útil en burbujas oscuras (p. ej. usuario en chat). */
  mentionClassName?: string;
  /** Nombres del directorio para acotar la mención exactamente al nombre real. */
  knownNames?: string[];
};

const DEFAULT_MENTION_CLASS = "text-primary font-bold";

const WORD_CHAR = /[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ0-9_]/;
const FIRST_WORD = /^[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ0-9_]+/;
const NEXT_WORD = /^\s+([a-zA-ZáéíóúñÁÉÍÓÚÑüÜ0-9_]+)/;

// Partículas en minúscula que forman parte de nombres compuestos ("Juan de la Cruz").
const NAME_PARTICLES = new Set([
  "de", "del", "la", "las", "los", "y", "e",
  "da", "das", "do", "dos", "di", "van", "von", "san", "santa",
]);

function isWordChar(ch: string | undefined): boolean {
  return !!ch && WORD_CHAR.test(ch);
}

function isCapitalized(word: string): boolean {
  const first = word[0];
  return !!first && first === first.toUpperCase() && first !== first.toLowerCase();
}

/**
 * Devuelve el texto del nombre mencionado (sin la `@`) que empieza en `rest`,
 * o `null` si no hay una mención plausible.
 */
function matchMentionName(rest: string, knownNames: string[]): string | null {
  // 1) Coincidencia exacta contra el directorio (nombre más largo primero),
  //    acotada a un límite de palabra para no cortar dentro de una palabra.
  for (const name of knownNames) {
    if (
      rest.length >= name.length &&
      rest.slice(0, name.length).toLowerCase() === name.toLowerCase() &&
      !isWordChar(rest[name.length])
    ) {
      return rest.slice(0, name.length); // conserva las mayúsculas originales del texto
    }
  }

  // 2) Heurística conservadora sin directorio.
  const first = FIRST_WORD.exec(rest);
  if (!first) return null;

  let committedEnd = first[0].length; // fin confirmado (última palabra capitalizada)
  let cursor = committedEnd;
  while (true) {
    const next = NEXT_WORD.exec(rest.slice(cursor));
    if (!next) break;
    const word = next[1];
    const wordEnd = cursor + next[0].length;
    if (isCapitalized(word)) {
      committedEnd = wordEnd; // confirma hasta esta palabra capitalizada
      cursor = wordEnd;
    } else if (NAME_PARTICLES.has(word.toLowerCase())) {
      cursor = wordEnd; // partícula tentativa: solo se confirma si sigue una capitalizada
    } else {
      break; // palabra en minúscula normal → fin del nombre
    }
  }
  return rest.slice(0, committedEnd);
}

/**
 * Resalta cada @mención con el estilo de mención (sin exigir que exista en el directorio).
 */
export function renderTextWithMentionHighlights(
  text: string,
  keyPrefix: string,
  options?: RenderMentionHighlightsOptions,
): ReactNode[] {
  if (!text) return [];
  const mentionClassName = options?.mentionClassName ?? DEFAULT_MENTION_CLASS;
  const knownNames = (options?.knownNames ?? [])
    .filter((n): n is string => !!n && n.trim().length > 0)
    .slice()
    .sort((a, b) => b.length - a.length);

  const nodes: ReactNode[] = [];
  let buffer = "";
  let key = 0;
  let i = 0;

  const flushBuffer = () => {
    if (buffer) {
      nodes.push(<span key={`${keyPrefix}-t-${key++}`}>{buffer}</span>);
      buffer = "";
    }
  };

  while (i < text.length) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : " ";
    // Una mención inicia si la '@' no está pegada a una palabra: así se evita
    // tratar correos ("correo@dominio.com") como menciones, pero se permite que
    // vaya precedida de signos como "(", "¿", comillas o guion.
    const atBoundary = !isWordChar(prev);

    if (ch === "@" && atBoundary && isWordChar(text[i + 1])) {
      const name = matchMentionName(text.slice(i + 1), knownNames);
      if (name) {
        flushBuffer();
        nodes.push(
          <span key={`${keyPrefix}-m-${key++}`} className={mentionClassName}>
            {`@${name}`}
          </span>,
        );
        i += 1 + name.length;
        continue;
      }
    }

    buffer += ch;
    i++;
  }

  flushBuffer();
  return nodes;
}
