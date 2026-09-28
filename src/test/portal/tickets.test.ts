import { describe, it, expect } from "vitest";
import { JUUN_RECEIPT_STATUSES } from "@/lib/juun/receiptStatus";
import { PORTAL_TICKET_STATUS_MAP, visibleStatus, ticketDeadline, ticketFileProblem } from "../../../supabase/functions/_shared/portal/tickets.ts";

describe("tickets del portal", () => {
  it("mapea los 13 estados de Ju'un, ni uno más ni uno menos", () => {
    expect(Object.keys(PORTAL_TICKET_STATUS_MAP).sort()).toEqual([...JUUN_RECEIPT_STATUSES].sort());
  });
  it("vencido si la fecha límite ya pasó", () => {
    expect(visibleStatus("received", "2026-01-01T00:00:00Z", new Date("2026-09-01"))).toBe("vencido");
    expect(visibleStatus("invoiced", "2026-01-01T00:00:00Z", new Date("2026-09-01"))).toBe("facturado");
  });
  it("ventanas: OXXO 7 días, Walmart fin de mes, Cinemex 1 día (23:59:59 CDMX)", () => {
    expect(ticketDeadline({ window_type: "days", window_days: 7 }, "2026-09-25")!.toISOString()).toBe("2026-10-03T05:59:59.000Z");
    expect(ticketDeadline({ window_type: "end_of_month", window_days: null }, "2026-02-10")!.toISOString()).toBe("2026-03-01T05:59:59.000Z");
    expect(ticketDeadline({ window_type: "days", window_days: 1 }, "2026-12-31")!.toISOString()).toBe("2027-01-02T05:59:59.000Z");
    expect(ticketDeadline({ window_type: "not_applicable", window_days: null }, "2026-09-01")).toBeNull();
  });
  it("archivos: tipos y tamaño", () => {
    expect(ticketFileProblem({ name: "t.heic", type: "", size: 1 })).toBeNull();
    expect(ticketFileProblem({ name: "t.gif", type: "image/gif", size: 1 })).toMatch(/JPG/);
    expect(ticketFileProblem({ name: "t.jpg", type: "image/jpeg", size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
  });
});
