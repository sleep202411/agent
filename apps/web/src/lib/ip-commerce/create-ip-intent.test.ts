// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { recoverIpCreationIntent, completeIpCreationIntent } from "./create-ip-intent";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("shares a pending identity across concurrent recovery and object property order", async () => {
  const [first, second] = await Promise.all([
    recoverIpCreationIntent("one", { title: "Private title", genres: ["drama"] }),
    recoverIpCreationIntent("one", { genres: ["drama"], title: "Private title" }),
  ]);
  expect(second).toEqual(first);
  expect(sessionStorage.getItem(first.storageKey)).toBe(first.key);
  expect(first.storageKey).not.toContain("Private title");
});
it("isolates account and draft identities and preserves another pending request on completion", async () => {
  const first = await recoverIpCreationIntent("one", { title: "A" });
  const other = await recoverIpCreationIntent("two", { title: "A" });
  const changed = await recoverIpCreationIntent("one", { title: "B" });
  expect(new Set([first.key, other.key, changed.key]).size).toBe(3);
  sessionStorage.setItem(first.storageKey, other.key);
  completeIpCreationIntent(first);
  expect(sessionStorage.getItem(first.storageKey)).toBe(other.key);
  expect(sessionStorage.getItem(changed.storageKey)).toBe(changed.key);
});
it("does not prevent creation or mask success when browser storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage denied");
  });
  const intent = await recoverIpCreationIntent("one", { title: "A" });
  expect(intent.key).toMatch(/^[0-9a-f-]{36}$/);
  expect(() => completeIpCreationIntent(intent)).not.toThrow();
});
it("replaces malformed storage values instead of sending them as request IDs", async () => {
  const first = await recoverIpCreationIntent("one", { title: "A" });
  sessionStorage.setItem(first.storageKey, "invalid");
  const next = await recoverIpCreationIntent("one", { title: "A" });
  expect(next.key).not.toBe("invalid");
  expect(sessionStorage.getItem(first.storageKey)).toBe(next.key);
});
