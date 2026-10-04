import { expect, it } from "vitest";
import { encodeUserId, parsePublicUserId } from "./user-id-codec";
it("decodes the reported displayed ID", () => {
  expect(parsePublicUserId("273848")).toBe("18424");
});
it.each([
  "0",
  "18424",
  "899999",
  "900000",
  "1234567",
  "89999999",
  "90000000",
  "999999999999999999",
])("round-trips all supported displayed ID tiers: %s", (raw) => {
  expect(parsePublicUserId(` ${encodeUserId(raw)} `)).toBe(raw);
});
it.each(["", "u_invalid", "person@example.com", "-1", "1.5", "9".repeat(19)])(
  "rejects invalid displayed IDs: %s",
  (input) => expect(parsePublicUserId(input)).toBeNull()
);
it("rejects corrupted large-ID checksums", () => {
  const id = encodeUserId("90000000");
  expect(parsePublicUserId(id.slice(0, -2) + (id.endsWith("00") ? "01" : "00"))).toBeNull();
});
