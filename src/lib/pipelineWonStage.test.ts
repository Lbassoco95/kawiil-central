import { describe, expect, it } from "vitest";
import {
  isWonPipelineStage,
  isWonPipelineStageSlug,
  wonStageDisplayLabel,
} from "./pipelineWonStage";

describe("isWonPipelineStageSlug", () => {
  it("acepta convertido y cerrado", () => {
    expect(isWonPipelineStageSlug("convertido")).toBe(true);
    expect(isWonPipelineStageSlug("cerrado")).toBe(true);
    expect(isWonPipelineStageSlug("Convertido")).toBe(true);
  });

  it("rechaza etapas abiertas y perdido", () => {
    expect(isWonPipelineStageSlug("negociacion")).toBe(false);
    expect(isWonPipelineStageSlug("perdido")).toBe(false);
    expect(isWonPipelineStageSlug(null)).toBe(false);
  });
});

describe("isWonPipelineStage", () => {
  it("usa slug ganado aunque el nombre sea Cerrado", () => {
    expect(
      isWonPipelineStage({ slug: "convertido", name: "Cerrado", is_terminal: true }),
    ).toBe(true);
  });

  it("acepta nombre Cerrado sin slug conocido", () => {
    expect(isWonPipelineStage({ slug: "won_custom", name: "Cerrado" })).toBe(true);
  });

  it("terminal no-perdido cuenta como ganado", () => {
    expect(isWonPipelineStage({ slug: "ganado_org", is_terminal: true })).toBe(true);
    expect(isWonPipelineStage({ slug: "perdido", is_terminal: true })).toBe(false);
  });
});

describe("wonStageDisplayLabel", () => {
  it("prioriza el nombre del board", () => {
    expect(wonStageDisplayLabel("Cerrado", "convertido")).toBe("Cerrado");
    expect(wonStageDisplayLabel(null, "convertido")).toBe("Cerrado");
  });
});
