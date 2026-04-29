import { supabase } from "@/integrations/supabase/client";

const BRACKET_TITLE = /^\[([^\]]+)\]\s*(.*)$/;

/**
 * Para tareas ya guardadas sin `phase_key` cuyo título sigue el patrón `[Nombre de fase] …`,
 * coincide el texto entre corchetes con `projects.phases[].name` y actualiza `phase_key` y el título sin prefijo.
 */
export async function reconcileBracketPhasesForProject(projectId: string): Promise<{ updated: number }> {
  const { data: proj, error } = await supabase.from("projects").select("phases").eq("id", projectId).single();
  if (error) throw error;

  const phases = Array.isArray(proj?.phases)
    ? (proj!.phases as { key: string; name: string }[]).filter((p) => p?.key && p?.name)
    : [];

  const labelToKey = new Map<string, string>();
  for (const p of phases) {
    const nameL = p.name.trim().toLowerCase();
    labelToKey.set(nameL, p.key);
    labelToKey.set(p.key.trim().toLowerCase(), p.key);
  }

  const { data: taskRows, error: tErr } = await supabase
    .from("tasks")
    .select("id, title, phase_key")
    .eq("project_id", projectId);

  if (tErr) throw tErr;

  let updated = 0;
  for (const t of taskRows || []) {
    if (t.phase_key) continue;
    const title = typeof t.title === "string" ? t.title : "";
    const m = title.match(BRACKET_TITLE);
    if (!m) continue;
    const rawLabel = m[1].trim();
    const rest = (m[2] ?? "").trim();
    const lk = rawLabel.toLowerCase();
    const key = labelToKey.get(lk);
    if (!key) continue;

    const newTitle = (rest || rawLabel).trim();
    const { error: uErr } = await supabase
      .from("tasks")
      .update({ phase_key: key, title: newTitle })
      .eq("id", t.id);
    if (!uErr) updated += 1;
  }

  return { updated };
}
