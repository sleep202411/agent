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

it("preserves parsed JSON keys named __proto__ at every depth", () => {
  const input = JSON.parse('{"z":0,"nested":{"__proto__":{"value":1}},"__proto__":"literal"}');
  expect(canonicalJsonString(input)).toBe(
    '{"__proto__":"literal","nested":{"__proto__":{"value":1}},"z":0}'
  );
});

it("rejects sparse arrays instead of hashing missing slots as explicit null", () => {
  const sparse = new Array<unknown>(1);
  expect(() => canonicalJsonString({ values: sparse })).toThrow("Unsupported JSON value");
  expect(canonicalJsonString({ values: [null] })).toBe('{"values":[null]}');
});
