import { describe, expect, it } from "vitest";
import { isCrewTaskOverdue } from "./task-dates";

const now = Date.parse("2026-09-08T12:00:00Z");
describe("Crew task deadlines", () => {
  it.each(["open", "in_progress", "submitted", "revision_requested"])(
    "marks an unfinished %s task overdue across timezone offsets",
    (status) => {
      expect(isCrewTaskOverdue({ status, dueAt: "2026-09-08T19:59:59+08:00" }, now)).toBe(true);
    }
  );
  it.each(["approved", "cancelled"])("keeps %s tasks normal", (status) => {
    expect(isCrewTaskOverdue({ status, dueAt: "2020-01-01" }, now)).toBe(false);
  });
  it.each([null, "invalid", "2026-09-08T12:00:00Z", "2026-09-09T00:00:00Z"])(
    "does not mark a missing, invalid or unexpired deadline overdue: %s",
    (dueAt) => {
      expect(isCrewTaskOverdue({ status: "open", dueAt }, now)).toBe(false);
    }
  );
});
