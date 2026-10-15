import { describe, expect, it } from "vitest";
import {
  collectLawsuitDeadlines,
  currentStageLabel,
  defaultStagesForType,
  isLegalProcedure,
  mergeSuggestedStages,
  partyLabels,
  statusMeta,
  statusOptionsForType,
  lawsuitCalendarHref,
  lawsuitDeadlinesAsCalendarTasks,
  lawsuitsForUser,
  parseLawsuitStages,
  setCurrentStage,
} from "./lawsuits";

const base = {
  project_id: "p1",
  next_hearing_date: null,
  next_deadline_date: null,
  next_deadline_note: null,
};

describe("collectLawsuitDeadlines", () => {
  it("ordena por fecha, marca vencidos e ignora juicios cerrados", () => {
    const res = collectLawsuitDeadlines(
      [
        { ...base, id: "a", name: "A", status: "en_tramite", next_deadline_date: "2026-10-16", next_deadline_note: "Ofrecer pruebas" },
        { ...base, id: "b", name: "B", status: "en_tramite", next_hearing_date: "2026-10-10" },
        { ...base, id: "c", name: "C", status: "concluido", next_deadline_date: "2026-10-01" },
      ],
      "2026-10-13",
    );
    expect(res.map((d) => d.lawsuitId)).toEqual(["b", "a"]);
    expect(res[0]).toMatchObject({ kind: "audiencia", overdue: true });
    expect(res[1]).toMatchObject({ kind: "plazo", label: "Ofrecer pruebas", overdue: false });
  });

  it("un mismo juicio puede aportar audiencia y plazo", () => {
    const res = collectLawsuitDeadlines(
      [{ ...base, id: "a", name: "A", status: "en_tramite", next_hearing_date: "2026-11-01", next_deadline_date: "2026-10-20" }],
      "2026-10-13",
    );
    expect(res.map((d) => d.kind)).toEqual(["plazo", "audiencia"]);
  });
});

describe("etapas", () => {
  it("parsea y descarta entradas inválidas", () => {
    const stages = parseLawsuitStages([{ label: "Demanda", completed: true }, null, { nada: 1 }, { label: "Alegatos" }]);
    expect(stages).toHaveLength(2);
    expect(stages[0].completed).toBe(true);
    expect(parseLawsuitStages("x")).toEqual([]);
  });

  it("la etapa actual es la primera sin completar", () => {
    const stages = parseLawsuitStages([{ label: "A", completed: true }, { label: "B" }, { label: "C" }]);
    expect(currentStageLabel(stages)).toBe("B");
    expect(currentStageLabel(stages.map((s) => ({ ...s, completed: true })))).toBeNull();
  });
});

describe("lawsuitsForUser", () => {
  const rows = [
    { project_id: "p1", responsible_user_id: "u1" },
    { project_id: "p2", responsible_user_id: "u2" },
    { project_id: "p3", responsible_user_id: null },
  ];

  it("incluye proyectos que el usuario responsabiliza o donde está en el equipo", () => {
    expect(lawsuitsForUser(rows, "u1", ["p3"]).map((r) => r.project_id)).toEqual(["p1", "p3"]);
  });

  it("no incluye proyectos ajenos", () => {
    expect(lawsuitsForUser(rows, "u9", [])).toEqual([]);
  });
});

describe("calendario", () => {
  const deadlines = collectLawsuitDeadlines(
    [
      { ...base, id: "l1", name: "37/2016", status: "en_tramite", next_deadline_date: "2026-10-16", next_deadline_note: "Revisar expediente" },
      { ...base, id: "l2", name: "2301/2014", status: "en_tramite", next_hearing_date: "2026-11-20" },
    ],
    "2026-10-13",
  );

  it("filtra por rango y construye filas tipo tarea", () => {
    const rows = lawsuitDeadlinesAsCalendarTasks(deadlines, "2026-10-01", "2026-10-31");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "lw:p1:l1:plazo",
      title: "⚖️ Revisar expediente: 37/2016",
      due_date: "2026-10-16",
      project_id: "p1",
    });
  });

  it("el id sintético lleva al juicio y los demás ids no", () => {
    expect(lawsuitCalendarHref("lw:p1:l1:plazo")).toBe("/proyectos/p1?tab=juicios&lawsuitId=l1");
    expect(lawsuitCalendarHref("a1b2c3")).toBeNull();
    expect(lawsuitCalendarHref("lw:p1")).toBeNull();
  });
});

describe("trámites legales", () => {
  it("distingue trámites de juicios y ajusta las partes", () => {
    expect(isLegalProcedure("queja_profeco")).toBe(true);
    expect(isLegalProcedure("civil")).toBe(false);
    expect(partyLabels("queja_condusef").first).toBe("Quejoso / promovente");
    expect(partyLabels("civil")).toEqual({ first: "Actor", second: "Demandado" });
  });

  it("cada tipo carga sus propias etapas", () => {
    expect(defaultStagesForType("queja_profeco").map((s) => s.key)).toContain("conciliacion");
    expect(defaultStagesForType("queja_condusef")[0].key).toBe("reclamacion");
    expect(defaultStagesForType("civil")[0].key).toBe("demanda");
    expect(defaultStagesForType(null).every((s) => !s.completed)).toBe(true);
  });
});

describe("estatus por tipo", () => {
  it("los trámites tienen estatus propios y los juicios no los ven", () => {
    expect(statusOptionsForType("queja_profeco").map((s) => s.value)).toContain("en_conciliacion");
    expect(statusOptionsForType("civil").map((s) => s.value)).not.toContain("en_conciliacion");
    expect(statusMeta("convenio", "civil").label).toBe("Convenio / acuerdo");
    expect(statusMeta("amparo", "queja_profeco").label).toBe("Amparo");
  });
});

describe("mergeSuggestedStages", () => {
  const current = parseLawsuitStages([
    { key: "a", label: "Denuncia", completed: true, completed_at: "2026-09-21" },
    { key: "b", label: "Emplazamiento" },
  ]);

  it("reemplaza las pendientes y conserva las completadas sin duplicarlas", () => {
    const res = mergeSuggestedStages(current, [{ label: "denuncia" }, { label: "Investigación ante el MP" }], true, 1);
    expect(res.map((s) => s.label)).toEqual(["Denuncia", "Investigación ante el MP"]);
    expect(res[0].completed).toBe(true);
    expect(res[1]).toMatchObject({ key: "ia-1-1", completed: false });
  });

  it("sin reemplazar agrega solo las que faltan (ignora acentos y mayúsculas)", () => {
    const res = mergeSuggestedStages(current, [{ label: "EMPLAZAMIENTO" }, { label: "Sentencia" }], false, 1);
    expect(res.map((s) => s.label)).toEqual(["Denuncia", "Emplazamiento", "Sentencia"]);
  });
});

describe("etapas penales", () => {
  it("los asuntos penales no cargan etapas civiles", () => {
    expect(defaultStagesForType("penal")[0].key).toBe("denuncia");
  });
});

describe("setCurrentStage", () => {
  const st = parseLawsuitStages([
    { key: "a", label: "A", completed: true, completed_at: "2026-09-01" },
    { key: "b", label: "B" },
    { key: "c", label: "C" },
    { key: "d", label: "D", completed: true, completed_at: "2026-10-01" },
  ]);

  it("avanzar completa las anteriores y deja la elegida en curso", () => {
    const res = setCurrentStage(st, "c", "2026-10-15");
    expect(res.map((s) => s.completed)).toEqual([true, true, false, true]);
    expect(res[0].completed_at).toBe("2026-09-01");
    expect(res[1].completed_at).toBe("2026-10-15");
    expect(currentStageLabel(res)).toBe("C");
  });

  it("retroceder reabre la elegida sin tocar las posteriores", () => {
    const res = setCurrentStage(st, "a", "2026-10-15");
    expect(res[0]).toMatchObject({ completed: false, completed_at: null });
    expect(res[3].completed).toBe(true);
    expect(currentStageLabel(res)).toBe("A");
  });

  it("una clave inexistente no cambia nada", () => {
    expect(setCurrentStage(st, "zzz")).toBe(st);
  });
});
