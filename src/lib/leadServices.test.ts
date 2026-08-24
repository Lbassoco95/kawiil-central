import { describe, expect, it } from "vitest";
import {
  SERVICE_BUNDLES,
  activeBundles,
  formatServices,
  isBundleSelected,
  normalizeServices,
  primaryService,
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
    expect(formatServices(["legal", "contabilidad"])).toBe("Contabilidad, Legal");
  });
});
