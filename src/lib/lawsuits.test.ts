import { describe, expect, it } from "vitest";
import {
  collectLawsuitDeadlines,
  currentStageLabel,
  lawsuitCalendarHref,
  lawsuitDeadlinesAsCalendarTasks,
  lawsuitOutlookEvent,
  lawsuitsForUser,
  parseLawsuitStages,
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

describe("outlook", () => {
  const l = {
    id: "l1",
    name: "37/2016",
    project_id: "p1",
    status: "en_tramite",
    case_number: "37/2016",
    court: "Juzgado Civil 25 CDMX",
    next_hearing_date: "2026-10-31",
    next_deadline_date: "2026-10-16",
    next_deadline_note: "Revisar expediente",
  };

  it("arma un evento de día completo con el día siguiente como fin", () => {
    const ev = lawsuitOutlookEvent(l, "deadline", "https://app.test");
    expect(ev).toMatchObject({
      subject: "⚖️ Revisar expediente: 37/2016",
      isAllDay: true,
      start: { dateTime: "2026-10-16T00:00:00" },
      end: { dateTime: "2026-10-17T00:00:00" },
    });
    expect(ev!.body.content).toContain("https://app.test/proyectos/p1?tab=juicios&lawsuitId=l1");
    expect(ev!.body.content).toContain("Juzgado: Juzgado Civil 25 CDMX");
  });

  it("el fin cruza de mes correctamente", () => {
    const ev = lawsuitOutlookEvent(l, "hearing", "https://app.test");
    expect(ev!.subject).toBe("⚖️ Audiencia: 37/2016");
    expect(ev!.end.dateTime).toBe("2026-11-01T00:00:00");
  });

  it("sin fecha o con juicio cerrado no hay evento", () => {
    expect(lawsuitOutlookEvent({ ...l, next_hearing_date: null }, "hearing", "x")).toBeNull();
    expect(lawsuitOutlookEvent({ ...l, status: "concluido" }, "deadline", "x")).toBeNull();
  });
});
