/**
 * Conteo de comida de una actividad: personas confirmadas (asistentes + acompañantes),
 * quienes faltan por confirmar y restricciones alimentarias agrupadas.
 * Funciones puras, sin dependencias, para poder probarlas aparte.
 */

export interface FoodAttendee {
  name: string;
  confirmed: string; // si | no | pendiente
  dietary_restriction: string | null;
  has_plus_one: boolean;
  plus_one_name: string | null;
  plus_one_confirmed: string;
  plus_one_dietary: string | null;
}

export type FoodPersonKind = "asistente" | "acompañante";
export type FoodPersonStatus = "confirmado" | "pendiente";

export interface FoodPerson {
  name: string;
  kind: FoodPersonKind;
  status: FoodPersonStatus;
  dietary: string | null;
}

export interface FoodRestrictionGroup {
  label: string;
  count: number;
  people: string[];
}

export interface FoodCount {
  confirmed: FoodPerson[];
  pending: FoodPerson[];
  confirmedAttendees: number;
  confirmedCompanions: number;
  restrictions: FoodRestrictionGroup[];
}

const clean = (s?: string | null) => (s ?? "").trim();

/** Personas de un asistente según su confirmación y la de su acompañante. Quien dijo "no" no cuenta. */
function peopleOf(a: FoodAttendee): FoodPerson[] {
  const out: FoodPerson[] = [];
  const add = (
    name: string, kind: FoodPersonKind, state: string, dietary: string | null | undefined,
  ) => {
    if (state !== "si" && state !== "pendiente") return;
    out.push({
      name, kind,
      status: state === "si" ? "confirmado" : "pendiente",
      dietary: clean(dietary) || null,
    });
  };
  add(clean(a.name), "asistente", a.confirmed, a.dietary_restriction);
  // El +1 va con el invitado: si el invitado no asiste, su acompañante tampoco cuenta.
  if (a.has_plus_one && a.confirmed !== "no") {
    add(
      clean(a.plus_one_name) || `Acompañante de ${clean(a.name)}`,
      "acompañante", a.plus_one_confirmed, a.plus_one_dietary,
    );
  }
  return out;
}

export function buildFoodCount(attendees: FoodAttendee[]): FoodCount {
  const all = attendees.flatMap(peopleOf);
  const confirmed = all.filter((p) => p.status === "confirmado");
  const pending = all.filter((p) => p.status === "pendiente");

  // Restricciones de quienes sí vienen (confirmados); agrupa sin importar mayúsculas.
  const groups = new Map<string, FoodRestrictionGroup>();
  for (const p of confirmed) {
    if (!p.dietary) continue;
    const key = p.dietary.toLowerCase();
    const g = groups.get(key) ?? { label: p.dietary, count: 0, people: [] };
    g.count += 1;
    g.people.push(p.kind === "acompañante" ? `${p.name} (acomp.)` : p.name);
    groups.set(key, g);
  }
  const restrictions = [...groups.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"),
  );

  return {
    confirmed,
    pending,
    confirmedAttendees: confirmed.filter((p) => p.kind === "asistente").length,
    confirmedCompanions: confirmed.filter((p) => p.kind === "acompañante").length,
    restrictions,
  };
}

/** Texto listo para mandar al proveedor de alimentos. */
export function foodCountText(
  activityName: string, c: FoodCount, opts: { includePending?: boolean } = {},
): string {
  const lines: string[] = [];
  lines.push(`Conteo de comida — ${activityName}`);
  lines.push("");
  lines.push(
    `Confirmados: ${c.confirmed.length} (${c.confirmedAttendees} asistentes + ${c.confirmedCompanions} acompañantes)`,
  );
  lines.push(`Por confirmar: ${c.pending.length}`);
  if (opts.includePending) lines.push(`Máximo posible: ${c.confirmed.length + c.pending.length}`);

  if (c.restrictions.length > 0) {
    lines.push("", "Restricciones alimentarias (confirmados):");
    for (const r of c.restrictions) lines.push(`- ${r.label}: ${r.count} (${r.people.join(", ")})`);
  }

  const list = opts.includePending ? [...c.confirmed, ...c.pending] : c.confirmed;
  lines.push("", opts.includePending ? "Lista (incluye por confirmar):" : "Lista de confirmados:");
  if (list.length === 0) lines.push("(sin confirmados todavía)");
  list.forEach((p, i) => {
    const tag = p.kind === "acompañante" ? " (acompañante)" : "";
    const pend = p.status === "pendiente" ? " [por confirmar]" : "";
    const diet = p.dietary ? ` — ${p.dietary}` : "";
    lines.push(`${i + 1}. ${p.name}${tag}${pend}${diet}`);
  });
  return lines.join("\n");
}
