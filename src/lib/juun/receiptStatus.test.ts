import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  JUUN_HAPPY_PATH,
  JUUN_RECEIPT_STATUSES,
  JUUN_SIDE_EXITS,
  isJuunReceiptStatus,
} from "@/lib/juun/receiptStatus";

describe("máquina de estados del ticket", () => {
  it("son 13 estados: 6 del camino feliz y 7 salidas laterales", () => {
    expect(JUUN_HAPPY_PATH).toHaveLength(6);
    expect(JUUN_SIDE_EXITS).toHaveLength(7);
    expect(JUUN_RECEIPT_STATUSES).toHaveLength(13);
    expect(new Set(JUUN_RECEIPT_STATUSES).size).toBe(13);
  });

  it("el camino feliz empieza en received y termina en invoiced", () => {
    expect(JUUN_HAPPY_PATH[0]).toBe("received");
    expect(JUUN_HAPPY_PATH[JUUN_HAPPY_PATH.length - 1]).toBe("invoiced");
  });

  it("isJuunReceiptStatus distingue lo válido de lo que no", () => {
    expect(isJuunReceiptStatus("manual_queue")).toBe(true);
    expect(isJuunReceiptStatus("facturado")).toBe(false);
    expect(isJuunReceiptStatus(null)).toBe(false);
  });

  it("coincide con el CHECK de la migración", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260824220000_juun_fis_schema.sql"),
      "utf-8"
    );
    const bloque = sql.match(/status text NOT NULL DEFAULT 'received'\s*CHECK \(status IN \(([\s\S]*?)\)\)/);
    expect(bloque).not.toBeNull();
    const enSql = [...bloque![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(enSql.sort()).toEqual([...JUUN_RECEIPT_STATUSES].sort());
  });
});
