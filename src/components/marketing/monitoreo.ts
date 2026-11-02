import type { ColchonLectura, CorridaVigilante } from "@/hooks/useMarketing";

// A partir de las 7:30 de Ciudad de México ya debe haber una lectura real del día (el trabajo corre a las 7:00).
export const HORA_AVISO_MIN = 7 * 60 + 30;

export function ahoraCDMX(ahora: Date): { fecha: string; minutos: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(ahora).map((x) => [x.type, x.value]),
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute) };
}

// Las lecturas de prueba (fecha fija) no cuentan como lectura del día.
export function sinLecturaDeHoy(lecturas: ColchonLectura[], ahora: Date): { aviso: boolean; ultima: string | null } {
  const reales = lecturas.filter((l) => !l.simulada).map((l) => l.fecha).sort();
  const ultima = reales.length > 0 ? reales[reales.length - 1] : null;
  const { fecha, minutos } = ahoraCDMX(ahora);
  return { aviso: minutos >= HORA_AVISO_MIN && (ultima === null || ultima < fecha), ultima };
}

// La corrida terminó con falla si su resultado lo dice (lectura fallida o errores al guardar).
export const corridaConFalla = (c: Pick<CorridaVigilante, "resultado">): boolean => /^falla de lectura|errores?\b/i.test(c.resultado);
