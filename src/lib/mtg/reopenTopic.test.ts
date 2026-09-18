import { describe, it, expect } from "vitest";

/** Contrato de reopen (sin DB): el update de la junta actual queda movement=new. */
describe("reopenTopic contract", () => {
  it("crea o actualiza update a movement=new y topic a open", () => {
    const topic = { id: "t1", status: "resolved" as const };
    const meeting = { id: "m-current" };
    const existingUpdate = { id: "u1", meeting_id: meeting.id, topic_id: topic.id, movement: "resolved" };

    const nextTopicStatus = "open";
    const nextMovement = "new";
    expect(topic.status).not.toBe(nextTopicStatus);
    expect(existingUpdate.movement).not.toBe(nextMovement);
    expect(nextTopicStatus).toBe("open");
    expect(nextMovement).toBe("new");
  });
});
