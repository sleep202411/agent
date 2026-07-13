import { describe, expect, it } from "vitest";
import { canonicalJsonString } from "./canonical-json";

describe("canonicalJsonString", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalJsonString({ z: 1, a: [{ y: true, x: "value" }] })).toBe(
      '{"a":[{"x":"value","y":true}],"z":1}'
    );
  });

  it("normalizes negative zero and rejects lossy JSON values", () => {
    expect(canonicalJsonString({ value: -0 })).toBe('{"value":0}');
    expect(() => canonicalJsonString({ value: undefined })).toThrow("Undefined value");
    expect(() => canonicalJsonString({ value: Number.NaN })).toThrow("Non-finite number");
  });
});
