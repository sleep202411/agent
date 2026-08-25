import { describe, expect, it } from "vitest";

import { maskIdentifier, normalizeIdentifier } from "./identifier";

describe("normalizeIdentifier — email", () => {
  it("lowercases so casing variants hit one Java account", () => {
    expect(normalizeIdentifier(" Isaac@FizzDragon.com ")).toEqual({
      kind: "email",
      account: "isaac@fizzdragon.com",
    });
  });

  it("rejects an @ without a domain", () => {
    expect(normalizeIdentifier("isaac@")).toBeNull();
    expect(normalizeIdentifier("isaac@localhost")).toBeNull();
  });
});

describe("normalizeIdentifier — phone", () => {
  it("accepts a bare CN mobile (what apps/web allowed)", () => {
    expect(normalizeIdentifier("13800138000")).toEqual({ kind: "phone", account: "13800138000" });
  });

  it("strips spaces and dashes", () => {
    expect(normalizeIdentifier("138 0013-8000")).toEqual({
      kind: "phone",
      account: "13800138000",
    });
  });

  it("strips the CN country code in every form it arrives", () => {
    for (const raw of ["+8613800138000", "+86 138 0013 8000", "008613800138000", "8613800138000"]) {
      expect(normalizeIdentifier(raw)).toEqual({ kind: "phone", account: "13800138000" });
    }
  });

  it("keeps the + for genuinely international numbers", () => {
    expect(normalizeIdentifier("+65 9123 4567")).toEqual({ kind: "phone", account: "+6591234567" });
    expect(normalizeIdentifier("0016505551234")).toEqual({
      kind: "phone",
      account: "+16505551234",
    });
  });

  it("does not mistake a +1 NANP number for a CN mobile", () => {
    // `1 650 555 1234` has the exact shape of a CN mobile; only the
    // explicit country code tells them apart.
    expect(normalizeIdentifier("+1 650 555 1234")).toEqual({
      kind: "phone",
      account: "+16505551234",
    });
    expect(normalizeIdentifier("16505551234")).toEqual({
      kind: "phone",
      account: "16505551234",
    });
  });

  it("passes a bare non-CN national number through (apps/studio behaviour)", () => {
    expect(normalizeIdentifier("91234567")).toEqual({ kind: "phone", account: "91234567" });
  });

  it("rejects junk and out-of-range lengths", () => {
    expect(normalizeIdentifier("12345")).toBeNull();
    expect(normalizeIdentifier("1234567890123456")).toBeNull();
    expect(normalizeIdentifier("isaac")).toBeNull();
    expect(normalizeIdentifier("")).toBeNull();
    expect(normalizeIdentifier("+86abc")).toBeNull();
  });
});

describe("maskIdentifier", () => {
  it("masks emails and phones without hiding the useful part", () => {
    expect(maskIdentifier({ kind: "email", account: "isaac@fizzdragon.com" })).toBe(
      "is***@fizzdragon.com"
    );
    expect(maskIdentifier({ kind: "email", account: "a@fizzdragon.com" })).toBe(
      "a***@fizzdragon.com"
    );
    expect(maskIdentifier({ kind: "phone", account: "13800138000" })).toBe("138****8000");
    expect(maskIdentifier({ kind: "phone", account: "1234" })).toBe("1234");
  });
});
