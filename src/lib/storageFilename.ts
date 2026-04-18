// Supabase Storage acepta en sus keys solo: alfanumericos y ! - _ . * ' ( ) /.
// Cualquier otro caracter (acentos, enies, espacios, etc.) provoca "Invalid key".
// Este helper sanea unicamente el segmento de nombre de archivo que se concatena
// a la ruta del objeto; el nombre original debe conservarse en la base de datos
// para que el usuario lo siga viendo tal cual lo subio.

const ALLOWED = /[^A-Za-z0-9._\-()!*'+]/g;

export function sanitizeStorageFileName(name: string): string {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = normalized
    .replace(ALLOWED, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 180) || "archivo";
}
