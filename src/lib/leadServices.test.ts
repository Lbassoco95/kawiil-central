import { describe, expect, it } from "vitest";
import {
  SERVICE_BUNDLES,
  activeBundles,
  computeTcv,
  contractMonths,
  formatServices,
  isBundleSelected,
  normalizeServices,
  primaryService,
  splitByBilling,
  suggestedCompanions,
  toggleBundle,
  toggleService,
} from "./leadServices";

const backoffice = SERVICE_BUNDLES.find((b) => b.key === "backoffice")!;

describe("normalizeServices", () => {
  it("descarta basura y duplicados", () => {
    expect(normalizeServices(["legal", "legal", "no_existe", null, 7])).toEqual(["legal"]);
  });

  it("acepta un valor suelto (compatibilidad con service_type singular)", () => {
    expect(normalizeServices("contabilidad")).toEqual(["contabilidad"]);
  });

  it("ordena siempre igual, sin importar cómo se capturó", () => {
    expect(normalizeServices(["juicios", "contabilidad", "softlanding"])).toEqual([
      "softlanding",
      "contabilidad",
      "juicios",
    ]);
  });

  it("nada seleccionado es arreglo vacío", () => {
    expect(normalizeServices(null)).toEqual([]);
    expect(normalizeServices(undefined)).toEqual([]);
  });
});

describe("toggleService", () => {
  it("agrega y quita", () => {
    expect(toggleService([], "legal")).toEqual(["legal"]);
    expect(toggleService(["legal"], "legal")).toEqual([]);
  });

  it("mantiene el orden canónico al agregar", () => {
    expect(toggleService(["juicios"], "softlanding")).toEqual(["softlanding", "juicios"]);
  });
});

describe("paquete Backoffice", () => {
  it("es Legal + Contabilidad", () => {
    expect([...backoffice.services].sort()).toEqual(["contabilidad", "legal"]);
  });

  it("activarlo marca sus dos servicios (no se guarda el nombre del paquete)", () => {
    expect(toggleBundle([], backoffice)).toEqual(["contabilidad", "legal"]);
  });

  it("conserva lo ya elegido al activarlo", () => {
    expect(toggleBundle(["softlanding"], backoffice)).toEqual([
      "softlanding",
      "contabilidad",
      "legal",
    ]);
  });

  it("sólo se considera activo cuando están ambos", () => {
    expect(isBundleSelected(["legal"], backoffice)).toBe(false);
    expect(isBundleSelected(["legal", "contabilidad"], backoffice)).toBe(true);
  });

  it("se reconoce activo aunque se hayan marcado por separado", () => {
    const manual = toggleService(toggleService([], "legal"), "contabilidad");
    expect(activeBundles(manual).map((b) => b.key)).toEqual(["backoffice"]);
  });

  it("desactivarlo quita sus servicios y deja el resto", () => {
    expect(toggleBundle(["softlanding", "contabilidad", "legal"], backoffice)).toEqual([
      "softlanding",
    ]);
  });
});

describe("primaryService", () => {
  it("es el primero del orden canónico, para sincronizar service_type", () => {
    expect(primaryService(["contabilidad", "softlanding"])).toBe("softlanding");
    expect(primaryService(["legal", "contabilidad"])).toBe("contabilidad");
  });

  it("null cuando no hay servicios", () => {
    expect(primaryService([])).toBeNull();
  });
});

describe("formatServices", () => {
  it("usa las etiquetas legibles", () => {
    expect(formatServices(["legal", "nomina", "contabilidad"])).toBe("Contabilidad, Nómina, Legal");
  });
});

describe("modelo de cobro", () => {
  it("separa pago único de mensualidad", () => {
    const { oneTime, monthly } = splitByBilling(["softlanding", "legal", "nomina", "contabilidad"]);
    expect(oneTime).toEqual(["softlanding"]);
    expect(monthly).toEqual(["contabilidad", "nomina", "legal"]);
  });

  it("Nómina es mensual y no se agrega automáticamente con Backoffice", () => {
    expect(splitByBilling(["nomina"]).monthly).toEqual(["nomina"]);
    expect(toggleBundle([], backoffice)).toEqual(["contabilidad", "legal"]);
  });

  it("un Soft Landing sugiere el backoffice mensual", () => {
    expect(suggestedCompanions(["softlanding"])).toEqual(["contabilidad", "legal"]);
  });

  it("no sugiere lo que ya está elegido", () => {
    expect(suggestedCompanions(["softlanding", "legal", "contabilidad"])).toEqual([]);
  });

  it("sin servicios no sugiere nada", () => {
    expect(suggestedCompanions([])).toEqual([]);
  });
});

describe("contractMonths", () => {
  it("usa 12 meses cuando no se especifica", () => {
    expect(contractMonths(null)).toBe(12);
    expect(contractMonths(undefined)).toBe(12);
  });

  it("respeta lo capturado y nunca baja de 1", () => {
    expect(contractMonths(6)).toBe(6);
    expect(contractMonths(0)).toBe(1);
    expect(contractMonths(6.7)).toBe(6);
  });
});

describe("computeTcv", () => {
  it("sólo pago único", () => {
    expect(computeTcv({ oneTime: 45000, monthly: null, months: null })).toBe(45000);
  });

  it("pago único + mensualidad por los meses capturados", () => {
    expect(computeTcv({ oneTime: 45000, monthly: 11500, months: 6 })).toBe(114000);
  });

  it("mensualidad sin meses proyecta 12", () => {
    expect(computeTcv({ oneTime: null, monthly: 11500, months: null })).toBe(138000);
  });

  it("los meses no inflan el total si no hay mensualidad", () => {
    expect(computeTcv({ oneTime: 45000, monthly: null, months: 24 })).toBe(45000);
  });

  it("sin montos es cero", () => {
    expect(computeTcv({ oneTime: null, monthly: null, months: null })).toBe(0);
  });
});
