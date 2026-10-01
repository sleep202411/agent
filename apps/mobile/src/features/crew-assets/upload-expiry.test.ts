import { expect, it } from "vitest";
import { isExpiredCrewUpload } from "./upload-expiry";
it("requires the official structured 409 response, not a message or generic conflict", () => {
  const error = (status: number, body: string) =>
    Object.assign(new Error("expired"), { status, responseBody: body });
  const body = JSON.stringify({ code: "CREW_UPLOAD_RESERVATION_EXPIRED" });
  expect(isExpiredCrewUpload(error(409, body))).toBe(true);
  for (const value of [
    new Error("Crew upload reservation expired"),
    error(503, body),
    error(409, "invalid"),
    error(409, JSON.stringify({ code: "VERSION_CONFLICT" })),
    error(409, "null"),
  ]) {
    expect(isExpiredCrewUpload(value)).toBe(false);
  }
});
