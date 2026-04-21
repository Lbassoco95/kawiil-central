/**
 * Marcas opacas en `File` para ZIP diferidos al servidor o archivos extraídos del ZIP en cliente.
 * No se serializan; solo viven en memoria de la sesión.
 */

export type ZipIntakeMarker =
  | { kind: "server_deferred"; entryCount?: number }
  | { kind: "from_expanded_zip"; zipBaseName: string };

const zipMarkers = new WeakMap<File, ZipIntakeMarker>();

export function setZipIntakeMarker(file: File, marker: ZipIntakeMarker): void {
  zipMarkers.set(file, marker);
}

export function getZipIntakeMarker(file: File): ZipIntakeMarker | undefined {
  return zipMarkers.get(file);
}

export function copyZipMarker(from: File, to: File): void {
  const m = zipMarkers.get(from);
  if (m) zipMarkers.set(to, m);
}
