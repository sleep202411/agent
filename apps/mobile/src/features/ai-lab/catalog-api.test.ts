import { beforeEach, expect, it, vi } from "vitest";
import { canUseGeneration, loadGenerationCatalog, planRank } from "./catalog-api";
const h = vi.hoisted(() => ({ get: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const model = {
  id: "one",
  name: "One",
  type: "image" as const,
  enabled: true,
  schemaVersion: "1",
  input_schema: { type: "object" as const, properties: { prompt: { type: "string" as const } } },
};
const preset = {
  id: "preset",
  label: "Preset",
  type: "image" as const,
  modelIds: ["one"],
  enabled: true,
  billingPolicy: { mode: "free" as const },
};
beforeEach(() => {
  h.get.mockReset();
  h.generation = 1;
  h.get.mockImplementation(async (path) =>
    path.includes("entitlement")
      ? { entitlement: { rank: 10 } }
      : {
          version: "1",
          region: "global",
          models: [model, { ...model, id: "audio", type: "audio" }],
          presets: [preset],
        }
  );
});
it("fetches fresh account/site catalog and entitlement, includes official audio", async () => {
  const v = await loadGenerationCatalog(1, new AbortController().signal);
  expect(v.catalog.models).toHaveLength(2);
  expect(v.catalog.models[1].type).toBe("audio");
  expect(v.rank).toBe(10);
  await loadGenerationCatalog(1, new AbortController().signal);
  expect(h.get).toHaveBeenCalledTimes(4);
});
it("does not invent a preview catalog on missing service or invalid schema", async () => {
  h.get.mockRejectedValueOnce(new Error("unavailable"));
  await expect(loadGenerationCatalog(1, new AbortController().signal)).rejects.toThrow(
    "unavailable"
  );
  h.get.mockResolvedValue({
    version: "1",
    region: "global",
    models: [{ ...model, input_schema: { type: "object", properties: { x: { type: "array" } } } }],
    presets: [preset],
  });
  await expect(loadGenerationCatalog(1, new AbortController().signal)).rejects.toThrow();
});
it("enforces access, required plans, preset membership, type, and enabled flags", () => {
  expect(canUseGeneration(model, preset, 0)).toBe(true);
  for (const m of [
    { ...model, enabled: false },
    { ...model, access: { allowed: false } },
    { ...model, entitlement: { requiredPlan: "pro" } },
    { ...model, type: "video" as const },
  ])
    expect(canUseGeneration(m, preset, 0)).toBe(false);
  expect(canUseGeneration(model, { ...preset, modelIds: [] }, 100)).toBe(false);
  expect(canUseGeneration(model, { ...preset, requiredPlan: "unknown" }, 100)).toBe(false);
  expect(planRank("standard")).toBe(20);
});
it("rejects catalog responses after the account changes", async () => {
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return {};
  });
  await expect(loadGenerationCatalog(1, new AbortController().signal)).rejects.toThrow("expired");
});
it("uses the same explicit workspace for model access and entitlement", async () => {
  const workspaceId = "33333333-3333-4333-8333-333333333333";
  await loadGenerationCatalog(1, new AbortController().signal, workspaceId);
  expect(h.get.mock.calls.map((c) => c[1].headers)).toEqual([
    { "x-fizz-workspace-id": workspaceId },
    { "x-fizz-workspace-id": workspaceId },
  ]);
});
