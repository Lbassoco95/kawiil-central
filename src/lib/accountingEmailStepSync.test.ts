import { describe, it, expect } from "vitest";
import type { AccountingStep } from "@/hooks/useAccountingPeriods";
import {
  applySentStep,
  buildStepNote,
  candidatePeriodKeys,
  derivePeriodStatus,
  isAcusesTaskTitle,
  mergeSentAccountingEmailInfo,
  pickAcusesTasksToClose,
  pickPeriodForSend,
  stepKeyForTemplateCategory,
  type PeriodLike,
} from "./accountingEmailStepSync";

function step(key: string, completed = false, extra: Partial<AccountingStep> = {}): AccountingStep {
  return {
    key,
    label: key === "envio_acuses" ? "Envío de acuses al cliente" : key,
    completed,
    completed_at: completed ? "2026-07-01T00:00:00.000Z" : null,
    completed_by: null,
    step_status: completed ? "completado" : "pendiente",
    ...extra,
  };
}

function period(id: string, year: number, month: number, steps: AccountingStep[]): PeriodLike {
  return { id, project_id: `proj-${id}`, year, month, steps };
}

describe("stepKeyForTemplateCategory", () => {
  it("mapea las categorías de declaraciones al paso de acuses", () => {
    expect(stepKeyForTemplateCategory("pagos_provisionales")).toBe("envio_acuses");
    expect(stepKeyForTemplateCategory("envio_anuales")).toBe("envio_acuses");
    expect(stepKeyForTemplateCategory("isn_imss")).toBe("envio_acuses");
  });

  it("ignora categorías desconocidas o vacías", () => {
    expect(stepKeyForTemplateCategory(null)).toBeNull();
    expect(stepKeyForTemplateCategory(undefined)).toBeNull();
    expect(stepKeyForTemplateCategory("bienvenida")).toBeNull();
  });
});

describe("candidatePeriodKeys", () => {
  it("prioriza el mes anterior (los acuses de julio se mandan en agosto)", () => {
    const keys = candidatePeriodKeys(new Date(2026, 7, 19)); // 19 ago 2026
    expect(keys[0]).toEqual({ year: 2026, month: 7 });
    expect(keys[1]).toEqual({ year: 2026, month: 8 });
  });

  it("cruza el año correctamente en enero", () => {
    const keys = candidatePeriodKeys(new Date(2026, 0, 15)); // 15 ene 2026
    expect(keys[0]).toEqual({ year: 2025, month: 12 });
    expect(keys[1]).toEqual({ year: 2026, month: 1 });
  });
});

describe("pickPeriodForSend", () => {
  const sentAt = new Date(2026, 7, 19); // 19 ago 2026

  it("elige el periodo del mes anterior con el paso pendiente", () => {
    const julio = period("jul", 2026, 7, [step("presentacion", true), step("envio_acuses")]);
    const agosto = period("ago", 2026, 8, [step("envio_acuses")]);
    const picked = pickPeriodForSend([agosto, julio], "envio_acuses", sentAt);
    expect(picked?.period.id).toBe("jul");
    expect(picked?.alreadyCompleted).toBe(false);
  });

  it("cae al mes en curso cuando el anterior ya está cerrado", () => {
    const julio = period("jul", 2026, 7, [step("envio_acuses", true)]);
    const agosto = period("ago", 2026, 8, [step("envio_acuses")]);
    const picked = pickPeriodForSend([julio, agosto], "envio_acuses", sentAt);
    expect(picked?.period.id).toBe("ago");
    expect(picked?.alreadyCompleted).toBe(false);
  });

  it("reporta que ya estaba completado cuando ningún candidato está pendiente", () => {
    const julio = period("jul", 2026, 7, [step("envio_acuses", true)]);
    const picked = pickPeriodForSend([julio], "envio_acuses", sentAt);
    expect(picked?.period.id).toBe("jul");
    expect(picked?.alreadyCompleted).toBe(true);
  });

  it("ignora periodos fuera de la ventana de búsqueda", () => {
    const enero = period("ene", 2026, 1, [step("envio_acuses")]);
    expect(pickPeriodForSend([enero], "envio_acuses", sentAt)).toBeNull();
  });

  it("ignora periodos que no tienen el paso", () => {
    const julio = period("jul", 2026, 7, [step("presentacion")]);
    expect(pickPeriodForSend([julio], "envio_acuses", sentAt)).toBeNull();
  });
});

describe("applySentStep", () => {
  const sentAtIso = "2026-08-19T18:30:00.000Z";

  it("cierra solo el paso indicado y conserva el resto", () => {
    const steps = [step("presentacion", true), step("envio_acuses")];
    const out = applySentStep(steps, "envio_acuses", {
      userId: "user-1",
      sentAtIso,
      note: "Correo enviado",
    });
    const acuses = out.find((s) => s.key === "envio_acuses")!;
    expect(acuses.completed).toBe(true);
    expect(acuses.completed_at).toBe(sentAtIso);
    expect(acuses.completed_by).toBe("user-1");
    expect(acuses.step_status).toBe("completado");
    expect(acuses.notes).toBe("Correo enviado");
    expect(out.find((s) => s.key === "presentacion")).toEqual(steps[0]);
  });

  it("conserva las notas previas y anexa la nueva", () => {
    const steps = [step("envio_acuses", false, { notes: "Nota previa" })];
    const out = applySentStep(steps, "envio_acuses", { sentAtIso, note: "Correo enviado" });
    expect(out[0].notes).toBe("Nota previa\nCorreo enviado");
  });
});

describe("derivePeriodStatus", () => {
  it("marca completado cuando todos los pasos están cerrados", () => {
    expect(derivePeriodStatus([step("a", true), step("b", true)])).toBe("completado");
  });

  it("marca en progreso cuando falta alguno", () => {
    expect(derivePeriodStatus([step("a", true), step("b")])).toBe("en_progreso");
  });

  it("marca pendiente cuando nada ha empezado", () => {
    expect(derivePeriodStatus([step("a"), step("b")])).toBe("pendiente");
  });
});

describe("buildStepNote", () => {
  it("deja rastro del destinatario, asunto y adjuntos", () => {
    const note = buildStepNote(
      {
        subject: "Tu declaración está lista",
        recipients: ["cliente@ejemplo.mx"],
        attachmentNames: ["07_ACUSE IVA E ISR JUL 26.pdf"],
      },
      new Date(2026, 7, 19, 12, 30),
    );
    expect(note).toContain("cliente@ejemplo.mx");
    expect(note).toContain("Tu declaración está lista");
    expect(note).toContain("07_ACUSE IVA E ISR JUL 26.pdf");
  });
});

describe("mergeSentAccountingEmailInfo", () => {
  it("no pisa lo ya capturado con valores vacíos", () => {
    const merged = mergeSentAccountingEmailInfo(
      { clientId: "c1", clientName: "Cliente" },
      { templateCategory: "pagos_provisionales", clientId: null },
    );
    expect(merged).toEqual({
      clientId: "c1",
      clientName: "Cliente",
      templateCategory: "pagos_provisionales",
    });
  });
});

describe("isAcusesTaskTitle", () => {
  it("reconoce las tareas de envío de acuses", () => {
    expect(isAcusesTaskTitle("Envío de acuses al cliente")).toBe(true);
    expect(isAcusesTaskTitle("Enviar acuses julio")).toBe(true);
    expect(isAcusesTaskTitle("Mandar acuse de IVA")).toBe(true);
    expect(isAcusesTaskTitle("Envio de la declaracion al cliente")).toBe(true);
  });

  it("no toca las demás tareas del periodo", () => {
    expect(isAcusesTaskTitle("Conciliación bancaria")).toBe(false);
    expect(isAcusesTaskTitle("Registro en ContPAQi")).toBe(false);
    expect(isAcusesTaskTitle("Preparación de declaraciones")).toBe(false);
    expect(isAcusesTaskTitle("")).toBe(false);
    expect(isAcusesTaskTitle(null)).toBe(false);
  });
});

describe("pickAcusesTasksToClose", () => {
  it("solo toma las abiertas que hablan de acuses", () => {
    const tasks = [
      { id: "1", title: "Envío de acuses al cliente", status: "pendiente" },
      { id: "2", title: "Envío de acuses al cliente", status: "completada" },
      { id: "3", title: "Conciliación bancaria", status: "pendiente" },
      { id: "4", title: "Enviar acuses", status: "en_progreso" },
      { id: "5", title: "Enviar acuses", status: "cancelada" },
    ];
    expect(pickAcusesTasksToClose(tasks).map((t) => t.id)).toEqual(["1", "4"]);
  });
});
