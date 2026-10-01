import { expect, it } from "vitest";
import { assertTaskCreationDeadline } from "./task-creation-deadline";
it("accepts unset and current/future instants while rejecting past and malformed deadlines", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");
  expect(() => assertTaskCreationDeadline(null, now)).not.toThrow();
  expect(() => assertTaskCreationDeadline("2030-01-01T08:00:00+08:00", now)).not.toThrow();
  expect(() => assertTaskCreationDeadline("2030-01-02T00:00:00Z", now)).not.toThrow();
  expect(() => assertTaskCreationDeadline("2029-12-31T23:59:59Z", now)).toThrow("future deadline");
  expect(() => assertTaskCreationDeadline("invalid", now)).toThrow();
});
