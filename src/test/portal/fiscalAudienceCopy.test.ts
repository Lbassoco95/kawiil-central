import { describe, expect, it } from "vitest";
import {
  brutoAudienceHint,
  isKawiilServiceClient,
  ivaAudienceNote,
  ivaEstimateExplain,
} from "../../portal/lib/fiscalAudienceCopy";

describe("fiscalAudienceCopy", () => {
  it("distingue cliente Kawiil vs externo", () => {
    expect(isKawiilServiceClient("kawiil")).toBe(true);
    expect(isKawiilServiceClient("basico")).toBe(false);
    expect(ivaAudienceNote("kawiil")).toMatch(/contador de Kawiil/i);
    expect(ivaAudienceNote("basico")).toMatch(/Consulta a un contador/i);
    expect(brutoAudienceHint("kawiil")).toMatch(/Kawiil/);
    expect(brutoAudienceHint("basico")).toMatch(/estimad/i);
    expect(ivaEstimateExplain("kawiil")).toMatch(/Trasladado/);
    expect(ivaEstimateExplain("basico")).toMatch(/self-serve|estimado/i);
  });
});
