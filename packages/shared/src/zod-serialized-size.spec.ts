import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  assertMaxSerializedBytes,
  measureMaxSerializedBytes,
  utf8BoundedString,
  utf8ByteLength,
} from "./zod-serialized-size.js";

const encoder = new TextEncoder();

describe("utf8ByteLength", () => {
  it.each([
    ["ascii", "hello"],
    ["latin-1 supplement", "café"],
    ["CJK", "入梦金陵"],
    ["astral plane", "🐉🔥"],
    ["mixed", "a汉🐉z"],
    ["empty", ""],
  ])("agrees with TextEncoder for %s", (_label, value) => {
    expect(utf8ByteLength(value)).toBe(encoder.encode(value).length);
  });

  it("counts a lone surrogate as the replacement character, like TextEncoder", () => {
    const loneSurrogate = "\ud83d";
    expect(utf8ByteLength(loneSurrogate)).toBe(encoder.encode(loneSurrogate).length);
    expect(utf8ByteLength(loneSurrogate)).toBe(3);
  });
});

describe("measureMaxSerializedBytes", () => {
  it("charges four bytes per code unit of a bounded string, plus its quotes", () => {
    expect(measureMaxSerializedBytes(z.string().max(10))).toEqual({ bytes: 42, unbounded: [] });
  });

  it("uses .length() as a ceiling, not only .max()", () => {
    expect(measureMaxSerializedBytes(z.string().length(64)).bytes).toBe(2 + 64 * 4);
  });

  it("measures a byte-bounded string by its byte bound rather than 4x its code units", () => {
    const byteBounded = measureMaxSerializedBytes(utf8BoundedString(1_024));
    const charBounded = measureMaxSerializedBytes(z.string().max(1_024));
    expect(byteBounded.bytes).toBe(2 + 1_024);
    expect(charBounded.bytes).toBe(2 + 1_024 * 4);
  });

  it("sums an object's keys, separators and values", () => {
    const schema = z.object({ a: z.string().max(1), b: z.boolean() }).strict();
    // {"a":<6>,"b":<5>} => 2 braces + ("a"=3 +1 colon +6) + 1 comma + ("b"=3 +1 +5)
    expect(measureMaxSerializedBytes(schema)).toEqual({ bytes: 22, unbounded: [] });
  });

  it("takes the largest arm of a union", () => {
    const schema = z.union([z.string().max(1), z.string().max(100)]);
    expect(measureMaxSerializedBytes(schema).bytes).toBe(2 + 400);
  });

  it("multiplies a bounded array by its element", () => {
    const schema = z.array(z.string().max(2)).max(3);
    // 2 brackets + 3 * 10 + 2 commas
    expect(measureMaxSerializedBytes(schema).bytes).toBe(34);
  });

  it("reports a string with no ceiling instead of guessing one", () => {
    const schema = z.object({ note: z.string() }).strict();
    const report = measureMaxSerializedBytes(schema);
    expect(report.unbounded).toEqual([
      { path: "$.note", reason: "string with no .max() and no fixed-width format" },
    ]);
  });

  it("reports a format that constrains shape but not length", () => {
    const report = measureMaxSerializedBytes(z.object({ href: z.url() }).strict());
    expect(report.unbounded[0]?.path).toBe("$.href");
    expect(report.unbounded[0]?.reason).toContain("url");
  });

  it("accepts a fixed-width format without an explicit .max()", () => {
    expect(measureMaxSerializedBytes(z.uuid())).toEqual({ bytes: 2 + 36 * 4, unbounded: [] });
  });

  it("reports an array with no .max()", () => {
    const report = measureMaxSerializedBytes(z.object({ rows: z.array(z.uuid()) }).strict());
    expect(report.unbounded[0]?.reason).toContain("array with no .max()");
  });

  it("reports a record, whose key count is open", () => {
    const report = measureMaxSerializedBytes(z.record(z.string(), z.string().max(1)));
    expect(report.unbounded[0]?.reason).toContain("record/map");
  });

  it("reports an open object", () => {
    const report = measureMaxSerializedBytes(z.looseObject({ a: z.string().max(1) }));
    expect(report.unbounded[0]?.path).toBe("$.*");
  });

  it("reports a recursive schema rather than recursing forever", () => {
    type Tree = { child: Tree | null };
    const TreeSchema: z.ZodType<Tree> = z.lazy(() =>
      z.object({ child: TreeSchema.nullable() }).strict()
    );
    const report = measureMaxSerializedBytes(TreeSchema);
    expect(report.unbounded.some((item) => item.reason.includes("recursive"))).toBe(true);
  });

  it("refuses to measure a zod type it has not been taught", () => {
    expect(() => measureMaxSerializedBytes(z.date())).toThrow(/cannot measure the zod type "date"/);
  });
});

describe("assertMaxSerializedBytes", () => {
  it("names every unbounded value, not just the first", () => {
    const schema = z.object({ a: z.string(), b: z.string() }).strict();
    expect(() => assertMaxSerializedBytes(schema, 1_000, "Test frame")).toThrow(
      /Test frame has values with no size ceiling:[\s\S]*\$\.a[\s\S]*\$\.b/
    );
  });

  it("reports the measured size when a bounded schema is simply too large", () => {
    const schema = z.object({ prose: z.string().max(1_000) }).strict();
    expect(() => assertMaxSerializedBytes(schema, 512, "Test frame")).toThrow(
      /serializes to at most 4\d{3} bytes, over the 512-byte budget/
    );
  });

  it("passes a schema that fits", () => {
    expect(() =>
      assertMaxSerializedBytes(z.object({ id: z.uuid() }).strict(), 1_000, "Test frame")
    ).not.toThrow();
  });
});

describe("utf8BoundedString", () => {
  it("admits a string exactly at its byte ceiling", () => {
    const schema = utf8BoundedString(12);
    expect(schema.safeParse("汉".repeat(4)).success).toBe(true);
  });

  it("refuses a string one byte over, even though it is far under any code-unit bound", () => {
    const schema = utf8BoundedString(12);
    const result = schema.safeParse("汉".repeat(5));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("12 UTF-8 bytes");
  });

  it("rejects a non-positive bound at construction", () => {
    expect(() => utf8BoundedString(0)).toThrow(/positive integer/);
  });
});

it.each([NaN, Infinity])("rejects an invalid byte budget: %s", (budget) => {
  expect(() => assertMaxSerializedBytes(z.string().max(100), budget, "Frame")).toThrow(/budget/i);
});
it.each([NaN, Infinity, -1, 0])("rejects invalid measurement cost: %s", (bytesPerCharacter) => {
  expect(() => measureMaxSerializedBytes(z.string().max(100), { bytesPerCharacter })).toThrow(
    /bytesPerCharacter/
  );
});

it.each([-1, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects unusable byte budgets: %s",
  (budget) => {
    expect(() => assertMaxSerializedBytes(z.never(), budget, "Frame")).toThrow(/byte budget/);
  }
);
it("permits a zero budget only for a zero-size schema", () => {
  expect(() => assertMaxSerializedBytes(z.never(), 0, "Empty")).not.toThrow();
  expect(() => assertMaxSerializedBytes(z.null(), 0, "Nonempty")).toThrow(/over the 0-byte budget/);
});
it("retains positive custom measurement costs and exact budget boundaries", () => {
  const schema = z.string().max(10);
  expect(measureMaxSerializedBytes(schema, { bytesPerCharacter: 1.5 }).bytes).toBe(17);
  expect(() =>
    assertMaxSerializedBytes(schema, 17, "Exact", { bytesPerCharacter: 1.5 })
  ).not.toThrow();
  expect(() => assertMaxSerializedBytes(schema, 16, "Small", { bytesPerCharacter: 1.5 })).toThrow(
    /over the 16-byte budget/
  );
});
