import { describe, expect, it } from "vitest";
import type { ChecklistItem } from "@/hooks/useAccountingPeriods";
import {
  buildPartnerDocs,
  ensurePartnerDocs,
  companyInfoStepChecklist,
  buildCompanyInfoItems,
  partnerDocProgress,
  buildDocumentChecklistAdditions,
  PARTNER_DOCUMENTS,
  PARTNER_MARRIED_DOCUMENTS,
  COMPANY_INFO,
  type ConstitutionPartner,
  type PartnerDoc,
} from "./documentChecklist";

const flatSeed = (n: number): ChecklistItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `documentacion_socios::${i}`,
    text: `Doc — viejo ${i}`,
    completed: false,
    assigned_to: null,
    due_date: null,
    task_id: null,
  }));

describe("buildPartnerDocs", () => {
  it("socio soltero: documentos base", () => {
    const docs = buildPartnerDocs(false);
    expect(docs).toHaveLength(PARTNER_DOCUMENTS.length);
    expect(docs.every((d) => !d.completed)).toBe(true);
  });

  it("socio casado: agrega documentos del cónyuge", () => {
    const docs = buildPartnerDocs(true);
    expect(docs).toHaveLength(PARTNER_DOCUMENTS.length + PARTNER_MARRIED_DOCUMENTS.length);
    expect(docs.some((d) => d.key === "acta_matrimonio")).toBe(true);
  });

  it("conserva palomeado y notas por key al regenerar", () => {
    const prev: PartnerDoc[] = [{ key: "curp", label: "CURP", completed: true, note: "pendiente" }];
    const docs = buildPartnerDocs(false, prev);
    const curp = docs.find((d) => d.key === "curp");
    expect(curp?.completed).toBe(true);
    expect(curp?.note).toBe("pendiente");
  });

  it("al desmarcar casado quita los docs del cónyuge pero conserva base", () => {
    const married = buildPartnerDocs(true, [{ key: "acta_matrimonio", label: "Acta de matrimonio", completed: true }]);
    const single = buildPartnerDocs(false, married);
    expect(single.some((d) => d.key === "acta_matrimonio")).toBe(false);
    expect(single).toHaveLength(PARTNER_DOCUMENTS.length);
  });

  it("conserva documentos personalizados", () => {
    const custom: PartnerDoc[] = [{ key: "custom-1", label: "Poder notarial", completed: false, custom: true }];
    const docs = buildPartnerDocs(false, custom);
    expect(docs.some((d) => d.key === "custom-1")).toBe(true);
  });
});

describe("ensurePartnerDocs", () => {
  it("puebla docs si el socio no los tiene", () => {
    const socio: ConstitutionPartner = { id: "s1", name: "Juan" };
    const ensured = ensurePartnerDocs(socio);
    expect(ensured.docs?.length).toBe(PARTNER_DOCUMENTS.length);
  });
});

describe("partnerDocProgress", () => {
  it("cuenta completados/total de socio.docs", () => {
    const socio = ensurePartnerDocs({ id: "s1", name: "Juan" });
    socio.docs![0].completed = true;
    const prog = partnerDocProgress(socio);
    expect(prog.total).toBe(PARTNER_DOCUMENTS.length);
    expect(prog.completed).toBe(1);
  });
});

describe("companyInfoStepChecklist", () => {
  it("deja solo la info de empresa y elimina la semilla plana anterior", () => {
    const legacy = [...flatSeed(21), ...buildCompanyInfoItems()];
    const items = companyInfoStepChecklist(legacy);
    expect(items).toHaveLength(COMPANY_INFO.length);
    expect(items.every((i) => i.id.startsWith("empresa::"))).toBe(true);
    expect(items.some((i) => i.id.startsWith("documentacion_socios::"))).toBe(false);
  });

  it("conserva ítems realmente personalizados", () => {
    const custom: ChecklistItem = { id: "sub-9", text: "Algo manual", completed: false, assigned_to: null, due_date: null, task_id: "t1" };
    const items = companyInfoStepChecklist([custom]);
    expect(items.some((i) => i.id === "sub-9")).toBe(true);
  });
});

describe("buildDocumentChecklistAdditions (botón reutilizable)", () => {
  it("no duplica documentos ya presentes por texto", () => {
    const existing: ChecklistItem[] = [
      { id: "x", text: "Empresa — Capital social", completed: false, assigned_to: null, due_date: null, task_id: null },
    ];
    const additions = buildDocumentChecklistAdditions(existing, null, 123);
    expect(additions.some((a) => a.text === "Empresa — Capital social")).toBe(false);
  });
});
