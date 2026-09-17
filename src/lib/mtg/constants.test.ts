import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AGREEMENT_STATUS,
  CADENCE,
  DEFAULT_AGENDA_TEMPLATE,
  MEETING_STATUS,
  MOVEMENT,
  MOVEMENT_OPEN_ORDER,
  TOPIC_STATUS,
  TRANSCRIPT_STATUS,
} from "@/lib/mtg/constants";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260917120000_mtg_juntas_schema.sql"),
  "utf-8"
);

function checkValues(column: string): string[] {
  const bloque = sql.match(
    new RegExp(`CHECK \\(${column} IN \\(([\\s\\S]*?)\\)\\)`)
  );
  expect(bloque, `CHECK de ${column} no encontrado en la migración`).not.toBeNull();
  return [...bloque![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe("constantes de Múuch' vs CHECKs de la migración", () => {
  it("movement coincide con mtg_topic_updates.movement", () => {
    expect(Object.keys(MOVEMENT).sort()).toEqual(checkValues("movement"));
    expect(MOVEMENT_OPEN_ORDER.every((m) => m in MOVEMENT)).toBe(true);
  });

  it("cadence coincide con mtg_series.cadence", () => {
    expect(Object.keys(CADENCE).sort()).toEqual(checkValues("cadence"));
  });

  it("status de junta coincide con mtg_meetings.status", () => {
    const bloque = sql.match(
      /status text NOT NULL DEFAULT 'planned'\s*CHECK \(status IN \(([\s\S]*?)\)\)/
    );
    expect(bloque).not.toBeNull();
    const enSql = [...bloque![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(enSql).toEqual(Object.keys(MEETING_STATUS).sort());
  });

  it("status de tema coincide con mtg_topics.status", () => {
    const bloque = sql.match(
      /status text NOT NULL DEFAULT 'open'\s*CHECK \(status IN \(([\s\S]*?)\)\)/
    );
    expect(bloque).not.toBeNull();
    const enSql = [...bloque![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(enSql).toEqual(Object.keys(TOPIC_STATUS).sort());
  });

  it("status de acuerdo coincide con mtg_agreements.status", () => {
    const bloque = sql.match(
      /status text NOT NULL DEFAULT 'confirmed'\s*CHECK \(status IN \(([\s\S]*?)\)\)/
    );
    expect(bloque).not.toBeNull();
    const enSql = [...bloque![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(enSql).toEqual(Object.keys(AGREEMENT_STATUS).sort());
  });

  it("transcript_status coincide con mtg_meetings.transcript_status", () => {
    expect(Object.keys(TRANSCRIPT_STATUS).sort()).toEqual(checkValues("transcript_status"));
  });

  it("la agenda base tiene los 5 bloques estándar", () => {
    expect(DEFAULT_AGENDA_TEMPLATE.map((b) => b.key)).toEqual([
      "previous_agreements",
      "open_items",
      "deadlines",
      "new_topics",
      "next_steps",
    ]);
  });
});
