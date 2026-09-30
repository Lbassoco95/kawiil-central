import { describe, it, expect } from "vitest";
import { remindKindsForMeeting } from "@/lib/mtg/minutesReview";
import { remindNotificationCopy, remindRecipientIds } from "@/lib/mtg/remind";

describe("remind helpers", () => {
  it("recipientIds dedupe owner + internos", () => {
    expect(
      remindRecipientIds({
        owner_user_id: "u1",
        attendees_internal: ["u1", "u2"],
      }).sort(),
    ).toEqual(["u1", "u2"]);
  });

  it("notification copy t1d / t1h", () => {
    const d = remindNotificationCopy("t1d", "Seguimiento", "m1");
    expect(d.title).toMatch(/mañana/);
    expect(d.link).toBe("/juntas/m1");
    const h = remindNotificationCopy("t1h", "Seguimiento", "m1");
    expect(h.title).toMatch(/hora/);
  });

  it("no encola si ya pasó T-1h", () => {
    const scheduled = new Date("2026-09-18T12:00:00Z");
    const now = new Date("2026-09-18T11:30:00Z");
    const kinds = remindKindsForMeeting(scheduled, now);
    expect(kinds.map((k) => k.remind_kind)).toEqual([]);
  });
});
