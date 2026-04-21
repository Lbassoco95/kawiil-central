/** Clave estable para comparar nombres de archivo (trim + minúsculas). */
export function filenameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Genera un nombre «archivo (2).ext» que no colisione con `usedKeys` (claves ya normalizadas).
 */
export function nextDistinctFilename(originalName: string, usedKeys: Set<string>): string {
  const trimmed = originalName.trim();
  const dot = trimmed.lastIndexOf(".");
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const ext = dot > 0 ? trimmed.slice(dot) : "";
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (usedKeys.has(filenameKey(candidate))) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  usedKeys.add(filenameKey(candidate));
  return candidate;
}

/** Nuevo `File` con otro nombre, conservando el último modificado donde sea posible. */
export function fileWithName(file: File, newName: string): File {
  try {
    return new File([file], newName, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
