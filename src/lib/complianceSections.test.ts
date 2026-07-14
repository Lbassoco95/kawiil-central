import { describe, expect, it } from "vitest";
import {
  buildComplianceSections,
  hiddenComplianceCategoryKeys,
} from "./complianceSections";
import type { SyncPhase } from "./projectPhaseSync";

const phases: SyncPhase[] = [
  { key: "reportes_uif", name: "Reportes al SAT/UIF", order: 0 },
  { key: "kyc", name: "Gestión de expedientes y KYC", order: 3 },
  { key: "auditoria", name: "Auditoría interna", order: 5, hidden: true },
];

describe("hiddenComplianceCategoryKeys", () => {
  it("devuelve solo las fases marcadas como hidden", () => {
    const set = hiddenComplianceCategoryKeys(phases);
    expect([...set]).toEqual(["auditoria"]);
  });

  it("tolera null/undefined", () => {
    expect(hiddenComplianceCategoryKeys(null).size).toBe(0);
    expect(hiddenComplianceCategoryKeys(undefined).size).toBe(0);
  });
});

describe("buildComplianceSections", () => {
  const counts = new Map<string, number>([
    ["reportes_uif", 4],
    ["kyc", 0],
    ["auditoria", 2],
    // categoría solo por plantilla, no persistida, con nombre legible:
    ["gobierno_corporativo", 3],
  ]);

  it("oculta secciones vacías y eliminadas cuando showHidden=false", () => {
    const { sections } = buildComplianceSections({ phases, taskCountByKey: counts, showHidden: false });
    const visible = sections.filter((s) => s.visible).map((s) => s.key);
    // reportes_uif (tiene tareas) y gobierno_corporativo (tiene tareas) sí;
    // kyc (vacía) y auditoria (hidden) no.
    expect(visible).toEqual(["reportes_uif", "gobierno_corporativo"]);
  });

  it("revela vacías y ocultas cuando showHidden=true", () => {
    const { sections, hiddenOrEmptyCount } = buildComplianceSections({
      phases,
      taskCountByKey: counts,
      showHidden: true,
    });
    expect(sections.every((s) => s.visible)).toBe(true);
    expect(hiddenOrEmptyCount).toBe(2); // kyc vacía + auditoria oculta
  });

  it("nunca muestra el key crudo: usa etiqueta legible para categorías no persistidas", () => {
    const { sections } = buildComplianceSections({ phases, taskCountByKey: counts, showHidden: true });
    const gc = sections.find((s) => s.key === "gobierno_corporativo");
    expect(gc?.name).toBe("Gobierno corporativo");
    expect(gc?.persisted).toBe(false);
  });

  it("respeta una sección creada por el usuario aunque esté vacía", () => {
    const custom: SyncPhase[] = [{ key: "phase_123", name: "Mi sección", order: 0 }];
    const { sections } = buildComplianceSections({
      phases: custom,
      taskCountByKey: new Map(),
      showHidden: false,
    });
    const mine = sections.find((s) => s.key === "phase_123");
    expect(mine?.visible).toBe(true);
  });

  it("ordena fases persistidas por order antes que las derivadas de tareas", () => {
    const { sections } = buildComplianceSections({ phases, taskCountByKey: counts, showHidden: true });
    const keys = sections.map((s) => s.key);
    expect(keys.indexOf("reportes_uif")).toBeLessThan(keys.indexOf("gobierno_corporativo"));
    expect(keys.indexOf("kyc")).toBeLessThan(keys.indexOf("gobierno_corporativo"));
  });
});
