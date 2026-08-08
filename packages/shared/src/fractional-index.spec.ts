import { describe, expect, it } from "vitest";
import { isOrderKey, orderAfter, orderBetween, ORDER_DIGITS } from "./fractional-index.js";

/**
 * The load-bearing invariant: a key this module mints must be a key this module
 * accepts. A minted key that fails `isOrderKey` is silently treated as "no order"
 * by every reader, so the row it belongs to sorts to an arbitrary position —
 * which is exactly the bug a second, server-local implementation once shipped
 * (it minted "a0"; the trailing smallest digit makes it invalid).
 */
function expectMinted(key: string) {
  expect(isOrderKey(key), `minted key ${JSON.stringify(key)} must be a valid order key`).toBe(true);
}

describe("fractional index", () => {
  it("mints a valid key for an empty list", () => {
    expectMinted(orderAfter(null));
    expectMinted(orderAfter(undefined));
    expectMinted(orderBetween(null, null));
  });

  it("never mints a key ending in the smallest digit", () => {
    // The a0 regression: walk a long append chain and a long prepend chain and
    // assert the invariant at every step, not just the first.
    let last: string | null = null;
    for (let i = 0; i < 200; i += 1) {
      last = orderAfter(last);
      expectMinted(last);
      expect(last.endsWith(ORDER_DIGITS[0])).toBe(false);
    }

    let first: string | null = null;
    for (let i = 0; i < 200; i += 1) {
      first = orderBetween(null, first);
      expectMinted(first);
    }
  });

  it("appends in strictly ascending order", () => {
    const keys: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 50; i += 1) {
      last = orderAfter(last);
      keys.push(last);
    }
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lands strictly between two neighbours", () => {
    const a = orderAfter(null);
    const b = orderAfter(a);
    const mid = orderBetween(a, b);
    expectMinted(mid);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it("survives repeated insertion at the same seam", () => {
    // Splitting the same gap over and over is the case that grows key length;
    // every intermediate key must stay valid and stay inside the original gap.
    const lower = orderAfter(null);
    const upper = orderAfter(lower);
    let cursor = upper;
    for (let i = 0; i < 100; i += 1) {
      cursor = orderBetween(lower, cursor);
      expectMinted(cursor);
      expect(lower < cursor).toBe(true);
      expect(cursor < upper || cursor === upper).toBe(true);
    }
  });

  it("appends instead of throwing on degenerate neighbours", () => {
    const a = orderAfter(null);
    const b = orderAfter(a);
    // Inverted, equal, and foreign keys must all still yield a usable key.
    expectMinted(orderBetween(b, a));
    expectMinted(orderBetween(a, a));
    expectMinted(orderBetween("not a key", null));
    expectMinted(orderBetween(null, "not a key"));
    expectMinted(orderBetween("a0", null));
  });

  it("rejects malformed keys", () => {
    expect(isOrderKey("")).toBe(false);
    expect(isOrderKey("a0")).toBe(false); // trailing smallest digit
    expect(isOrderKey("a-b")).toBe(false); // outside the alphabet
    expect(isOrderKey(null)).toBe(false);
    expect(isOrderKey(42)).toBe(false);
    expect(isOrderKey("V")).toBe(true);
  });
});
