import { describe, expect, it } from "vitest";
import type { ChecklistItem } from "@/hooks/useAccountingPeriods";
import {
  buildSociosChecklist,
  buildCompanyInfoItems,
  partnerDocProgress,
  buildDocumentChecklistAdditions,
  PARTNER_DOCUMENTS,
  PARTNER_MARRIED_DOCUMENTS,
  COMPANY_INFO,
  type ConstitutionPartner,
} from "./documentChecklist";

const flatSeed = (n: number): ChecklistItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `documentacion_socios::${i}`,
    text: `viejo ${i}`,
    completed: false,
    assigned_to: null,
    due_date: null,
    task_id: null,
  }));

describe("buildSociosChecklist", () => {
  it("sin socios: solo información de empresa (una vez)", () => {
    const items = buildSociosChecklist([], []);
    expect(items).toHaveLength(COMPANY_INFO.length);
    expect(items.every((i) => i.id.startsWith("empresa::"))).toBe(true);
  });

  it("migra la semilla plana anterior sin dejar duplicados", () => {
    // Simula un proyecto viejo con 21 ítems planos + empresa ya inyectada por reconcile
    const legacy = [...flatSeed(21), ...buildCompanyInfoItems()];
    const items = buildSociosChecklist([], legacy);
    // Solo debe quedar la info de empresa, nada de ids planos
    expect(items).toHaveLength(COMPANY_INFO.length);
    expect(items.some((i) => i.id.startsWith("documentacion_socios::"))).toBe(false);
  });

  it("un socio soltero: sus documentos base + empresa", () => {
    const socio: ConstitutionPartner = { id: "s1", name: "Juan Pérez" };
    const items = buildSociosChecklist([socio], []);
    expect(items).toHaveLength(PARTNER_DOCUMENTS.length + COMPANY_INFO.length);
    expect(items.filter((i) => i.id.startsWith("socio::s1::"))).toHaveLength(PARTNER_DOCUMENTS.length);
    // El texto se prefija con el nombre del socio
    expect(items.some((i) => i.text.startsWith("Juan Pérez — "))).toBe(true);
  });

  it("socio casado: agrega los documentos del cónyuge", () => {
    const socio: ConstitutionPartner = { id: "s1", name: "Ana", married: true };
    const items = buildSociosChecklist([socio], []);
    const socioItems = items.filter((i) => i.id.startsWith("socio::s1::"));
    expect(socioItems).toHaveLength(PARTNER_DOCUMENTS.length + PARTNER_MARRIED_DOCUMENTS.length);
  });

  it("conserva el palomeado al re-generar (por id estable)", () => {
    const socio: ConstitutionPartner = { id: "s1", name: "Juan" };
    const first = buildSociosChecklist([socio], []);
    const marked = first.map((i) => (i.id === "socio::s1::curp" ? { ...i, completed: true } : i));
    const again = buildSociosChecklist([socio], marked);
    expect(again.find((i) => i.id === "socio::s1::curp")?.completed).toBe(true);
  });

  it("los ítems son checklist puro (sin tarea vinculada)", () => {
    const items = buildSociosChecklist([{ id: "s1", name: "Juan" }], []);
    expect(items.every((i) => i.task_id === null)).toBe(true);
  });

  it("respeta ítems personalizados agregados a mano", () => {
    const custom: ChecklistItem = { id: "sub-999", text: "algo manual", completed: false, assigned_to: null, due_date: null, task_id: "t1" };
    const items = buildSociosChecklist([], [custom]);
    expect(items.some((i) => i.id === "sub-999")).toBe(true);
  });
});

describe("partnerDocProgress", () => {
  it("cuenta completados/total del socio", () => {
    const socio: ConstitutionPartner = { id: "s1", name: "Juan" };
    const items = buildSociosChecklist([socio], []).map((i) =>
      i.id === "socio::s1::curp" ? { ...i, completed: true } : i,
    );
    const prog = partnerDocProgress(socio, items);
    expect(prog.total).toBe(PARTNER_DOCUMENTS.length);
    expect(prog.completed).toBe(1);
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
