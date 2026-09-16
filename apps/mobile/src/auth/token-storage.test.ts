import { beforeEach, expect, it, vi } from "vitest";
import { readStoredSession } from "./token-storage";
const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("@/lib/persistent-storage", () => ({
  getStoredString: storage.get,
  setStoredString: storage.set,
  deleteStoredString: storage.remove,
}));
const session = { region: "global", updatedAt: "2026-09-16T00:00:00Z", user: { userId: "123" } };
beforeEach(() => vi.resetAllMocks());
it.each([
  { ...session, user: "wrong" },
  { ...session, user: [] },
  { ...session, token: { tokenName: "satoken", tokenValue: {} } },
  { ...session, region: "unknown" },
])("ignores malformed stored session %j", async (value) => {
  storage.get.mockResolvedValue(JSON.stringify(value));
  await expect(readStoredSession()).resolves.toBeUndefined();
});
it("retains cookie-based sessions and valid token sessions", async () => {
  storage.get.mockResolvedValueOnce(JSON.stringify(session));
  await expect(readStoredSession()).resolves.toEqual(session);
  const withToken = { ...session, token: { tokenName: "satoken", tokenValue: "test-token" } };
  storage.get.mockResolvedValueOnce(JSON.stringify(withToken));
  await expect(readStoredSession()).resolves.toEqual(withToken);
});
