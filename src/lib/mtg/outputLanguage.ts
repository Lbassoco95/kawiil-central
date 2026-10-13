/** Idioma de salida de transcripción y resumen (default español). */

export type OutputLanguage = "es" | "en" | "zh";

export const OUTPUT_LANGUAGES: { value: OutputLanguage; label: string }[] = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
];

const KEY = "mtg-output-language";

export function getOutputLanguage(): OutputLanguage {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "zh" || v === "es") return v;
  } catch {
    /* sin storage */
  }
  return "es";
}

export function setOutputLanguage(v: OutputLanguage): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignore */
  }
}
