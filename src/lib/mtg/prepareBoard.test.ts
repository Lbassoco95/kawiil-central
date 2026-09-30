import { describe, it, expect } from "vitest";
import {
  inheritMovement,
  sortOpenUpdatesByMovement,
  canPrepareBoard,
  shouldCreateTask,
  buildPreparedUpdates,
  countByMovement,
  isOpenCarryAgreement,
  bucketForMovement,
} from "@/lib/mtg/prepareBoard";

describe("inheritMovement", () => {
  it("conserva sticky", () => {
    expect(inheritMovement("waiting_authority")).toBe("waiting_authority");
    expect(inheritMovement("blocked_third_party")).toBe("blocked_third_party");
  });
  it("default unchanged", () => {
    expect(inheritMovement("advanced")).toBe("unchanged");
    expect(inheritMovement(null)).toBe("unchanged");
  });
});

describe("sortOpenUpdatesByMovement", () => {
  it("respeta MOVEMENT_OPEN_ORDER", () => {
    const sorted = sortOpenUpdatesByMovement([
      { movement: "unchanged" as const },
      { movement: "blocked_third_party" as const },
      { movement: "decision_needed" as const },
    ]);
    expect(sorted.map((x) => x.movement)).toEqual([
      "blocked_third_party",
      "decision_needed",
      "unchanged",
    ]);
  });
});

describe("canPrepareBoard / shouldCreateTask", () => {
  it("solo planned sin updates", () => {
    expect(canPrepareBoard("planned", 0)).toBe(true);
    expect(canPrepareBoard("planned", 2)).toBe(false);
    expect(canPrepareBoard("in_progress", 0)).toBe(false);
  });
  it("tarea solo confirmada con proyecto", () => {
    expect(shouldCreateTask({ status: "confirmed", projectId: "p1", clientId: "c1" })).toBe(true);
    expect(shouldCreateTask({ status: "confirmed", projectId: "p1", clientId: null })).toBe(false);
    expect(shouldCreateTask({ status: "confirmed", projectId: null, clientId: "c1" })).toBe(false);
    expect(shouldCreateTask({ status: "proposed", projectId: "p1", clientId: "c1" })).toBe(false);
  });
});

describe("buildPreparedUpdates", () => {
  it("es idempotente en forma: un seed por tema open", () => {
    const seeds = buildPreparedUpdates({
      openTopics: [{ id: "t1" }, { id: "t2" }],
      previousByTopicId: new Map([
        ["t1", { movement: "blocked_third_party", next_step: "esperar" }],
      ]),
    });
    expect(seeds).toHaveLength(2);
    expect(seeds[0].movement).toBe("blocked_third_party");
    expect(seeds[0].next_step).toBe("esperar");
    expect(seeds[1].movement).toBe("unchanged");
    expect(seeds.every((s) => s.origin === "prepared")).toBe(true);
  });
});

describe("countByMovement / buckets / carry", () => {
  it("cuenta", () => {
    expect(countByMovement([{ movement: "new" }, { movement: "new" }, { movement: "resolved" }]).new).toBe(2);
  });
  it("bucket", () => {
    expect(bucketForMovement("resolved")).toBe("resolved");
    expect(bucketForMovement("advanced")).toBe("open");
  });
  it("carry agreement abierto", () => {
    expect(
      isOpenCarryAgreement({
        id: "a",
        text: "x",
        client_id: "c",
        entity_key: null,
        task_id: "t",
        status: "confirmed",
        due_date: null,
        project_id: "p",
        task_status: "pendiente",
      }),
    ).toBe(true);
    expect(
      isOpenCarryAgreement({
        id: "a",
        text: "x",
        client_id: "c",
        entity_key: null,
        task_id: "t",
        status: "confirmed",
        due_date: null,
        project_id: "p",
        task_status: "completada",
      }),
    ).toBe(false);
  });
});
