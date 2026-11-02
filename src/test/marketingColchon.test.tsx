import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ColchonPanel, InformeDia } from "@/components/marketing/ColchonInforme";
import { tipoCaso } from "@/components/marketing/PanelDia";
import type { ColchonLectura, InformeDiario } from "@/hooks/useMarketing";

// Datos reales de la corrida de control del 1 de noviembre de 2026 (última pieza el 7 de noviembre).
const lectura = (red: ColchonLectura["red"]): ColchonLectura => ({
  id: red, fecha: "2026-11-01", red, ultima_programada: "2026-11-07", dias: 6, color: "rojo", tope: false, programadas: 5, simulada: true, corrida_at: "2026-11-02T02:40:00Z",
});
const informe: InformeDiario = {
  id: "i1", fecha: "2026-11-01", simulada: true, created_at: "2026-11-02T02:40:00Z",
  contenido: {
    fecha: "2026-11-01", simulada: true, ventana_dias: 14, piezas_calendario_en_ventana: 0,
    colchon: [], faltantes: [], con_error: [], desconocidos: [],
    necesita_direccion: ["El Calendario Maestro no tiene piezas cargadas en los próximos 14 días: cargar el calendario para poder comparar.", "instagram: el colchón es de 6 días (rojo); programar piezas hasta cubrir 14 días. Tener imagen y texto listos y revisados."],
  },
};

describe("panel del colchón", () => {
  it("muestra los días y el color de cada red", () => {
    render(<ColchonPanel lecturas={[lectura("instagram"), lectura("facebook"), lectura("linkedin")]} />);
    for (const red of ["instagram", "facebook", "linkedin"]) {
      const t = screen.getByTestId(`colchon-${red}`).textContent ?? "";
      expect(t).toContain("Rojo");
      expect(t).toContain("6");
      expect(t).toContain("5 programadas");
    }
    expect(screen.getByText(/Lectura de prueba con fecha fija/)).toBeTruthy();
  });
  it("sin lecturas: lo dice, no inventa colores", () => {
    render(<ColchonPanel lecturas={[]} />);
    expect(screen.getByText("Aún no hay lecturas del colchón.")).toBeTruthy();
  });
  it("el tope de la ventana se muestra como 45+", () => {
    render(<ColchonPanel lecturas={[{ ...lectura("instagram"), dias: 45, tope: true, color: "verde" }]} />);
    expect(screen.getByTestId("colchon-instagram").textContent).toContain("45+");
  });
});

describe("informe de faltantes", () => {
  it("muestra qué necesita Dirección y avisa que el calendario no está cargado", () => {
    render(<InformeDia informe={informe} />);
    expect(screen.getAllByTestId("informe-necesita")[0].textContent).toContain("colchón es de 6 días");
    expect(screen.getByText("El calendario no tiene piezas cargadas en esos días.")).toBeTruthy();
  });
  it("lista los faltantes con fecha, hora, pilar y formato", () => {
    const con = { ...informe, contenido: { ...informe.contenido, piezas_calendario_en_ventana: 3, faltantes: [{ fecha: "2026-11-04", hora: "11:00", codigo: "K-30", pilar: "PLD", formato: "carrusel", redes: ["facebook" as const, "linkedin" as const] }] } };
    render(<InformeDia informe={con} />);
    const t = screen.getByTestId("informe-faltantes").textContent ?? "";
    expect(t).toContain("Facebook, LinkedIn"); expect(t).toContain("11:00"); expect(t).toContain("PLD"); expect(t).toContain("carrusel");
  });
  it("sin informe: lo dice", () => {
    render(<InformeDia informe={null} />);
    expect(screen.getByText("Aún no hay informe.")).toBeTruthy();
  });
  it("el tipo de caso del colchón tiene nombre", () => { expect(tipoCaso("colchon")).toBe("Colchón bajo"); });
});
