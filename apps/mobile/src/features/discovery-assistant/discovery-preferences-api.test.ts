import { beforeEach, expect, it, vi } from "vitest";
import { readDiscoveryPreferences, saveDiscoveryPreferences } from "./discovery-preferences-api";
const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, put: h.put } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const record = {
  ownerId: "owner",
  site: "global",
  revision: 1,
  preferences: null,
  deliveryState: "awaiting_design",
};
const command = {
  mutationId: "11111111-1111-4111-8111-111111111111",
  expectedRevision: 0,
  preferences: null,
};
const scope = (signal = new AbortController().signal) => ({
  ownerId: "owner",
  site: "global" as const,
  signal,
  generation: h.generation,
});
beforeEach(() => {
  h.get.mockReset().mockResolvedValue(record);
  h.put.mockReset().mockResolvedValue(record);
  h.generation = 1;
});
it("loads validated preferences from the shared authenticated route", async () => {
  const s = scope();
  expect(await readDiscoveryPreferences(s)).toEqual(record);
  expect(h.get).toHaveBeenCalledWith("/aurora/me/discovery-preferences", {
    signal: s.signal,
    cache: "no-store",
  });
});
it.each(["owner", "site"])("rejects another %s in the response", async (key) => {
  h.get.mockResolvedValue({
    ...record,
    ...(key === "owner" ? { ownerId: "other" } : { site: "cn" }),
  });
  await expect(readDiscoveryPreferences(scope())).rejects.toThrow("different account or site");
});
it("keeps the same mutation identity across an uncertain save retry and supports explicit clearing", async () => {
  const s = scope();
  h.put.mockRejectedValueOnce(new Error("network unavailable"));
  await expect(saveDiscoveryPreferences(s, command)).rejects.toThrow("network unavailable");
  expect(await saveDiscoveryPreferences(s, command)).toEqual(record);
  expect(h.put.mock.calls.map((call) => call[1].data)).toEqual([command, command]);
});
it("never accepts an in-flight result after its account scope is aborted", async () => {
  let finish!: (value: unknown) => void;
  h.get.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const controller = new AbortController();
  const pending = readDiscoveryPreferences(scope(controller.signal));
  controller.abort();
  finish(record);
  await expect(pending).rejects.toThrow();
});
it("does not dispatch from an already aborted scope", async () => {
  const c = new AbortController();
  c.abort();
  await expect(saveDiscoveryPreferences(scope(c.signal), command)).rejects.toThrow();
  expect(h.put).not.toHaveBeenCalled();
});
it("does not turn malformed responses into empty saved preferences", async () => {
  h.get.mockResolvedValue({ code: 200 });
  await expect(readDiscoveryPreferences(scope())).rejects.toThrow();
});
it("preserves revision conflicts for explicit user recovery", async () => {
  h.put.mockRejectedValue(new Error("Preferences changed. Reload before saving."));
  await expect(saveDiscoveryPreferences(scope(), command)).rejects.toThrow("Reload before saving");
  expect(h.put).toHaveBeenCalledTimes(1);
});

it("rejects replaced native login sessions even without a component abort", async () => {
  let finish!: (value: unknown) => void;
  h.get.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const s = scope();
  const pending = readDiscoveryPreferences(s);
  h.generation++;
  finish(record);
  await expect(pending).rejects.toThrow("session expired");
  await expect(saveDiscoveryPreferences(s, command)).rejects.toThrow("session expired");
  expect(h.put).not.toHaveBeenCalled();
});
