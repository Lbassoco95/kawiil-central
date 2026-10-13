import { describe, expect, it } from "vitest";
import { collectLawsuitDeadlines, currentStageLabel, parseLawsuitStages } from "./lawsuits";

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
