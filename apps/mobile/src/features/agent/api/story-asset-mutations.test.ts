import { beforeEach, expect, it, vi } from "vitest";
import { assetMutationPending, assetPatchInput, type AssetCommand } from "./story-asset-mutations";
const h = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), del: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post, patch: h.patch, delete: h.del } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), chapterId: id(2), generation: 1 };
const receipt = () => ({
  id: id(3),
  projectId: id(1),
  chapterId: id(2),
  version: 3,
  status: "current",
  name: "Updated",
  description: null,
  imagePrompt: "Prompt",
  selectedMediaVersion: { id: id(4), mediaAssetId: id(5) },
  mediaVersions: [{ id: id(4), mediaAssetId: id(5) }],
});
const command: AssetCommand = {
  action: "patch",
  assetId: id(3),
  clientKey: id(9),
  input: { expectedVersion: 2, name: "Updated" },
};
let raw: string | null;
const storage = {
  read: () => raw,
  write: vi.fn((value: string) => {
    raw = value;
  }),
};
const store = () => assetMutationPending(scope, "user", storage);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  raw = null;
  storage.write.mockImplementation((v) => {
    raw = v;
  });
  h.patch.mockResolvedValue(receipt());
  h.del.mockResolvedValue({ ...receipt(), status: "archived" });
});
it("persists before patch and clears only the matching receipt", async () => {
  h.patch.mockImplementation(async () => {
    expect(store().read()).toEqual(command);
    return receipt();
  });
  await store().submit(command);
  expect(store().read()).toBeNull();
  expect(h.patch.mock.calls[0][1]).toMatchObject({
    retry: false,
    data: command.input,
    headers: { "Idempotency-Key": `story-asset:${id(9)}` },
  });
});
it("reopens and retries the exact request after losing a reply", async () => {
  h.patch.mockRejectedValueOnce(Error("Lost reply"));
  await expect(store().submit(command)).rejects.toThrow();
  await expect(store().submit({ ...command, clientKey: id(10) })).rejects.toThrow();
  await store().submit(store().read()!);
  expect(h.patch.mock.calls[0]).toEqual(h.patch.mock.calls[1]);
});
it.each(["id", "projectId", "chapterId", "version", "status", "name"])(
  "retains recovery on incorrect %s receipt",
  async (field) => {
    h.patch.mockResolvedValue({ ...receipt(), [field]: field === "version" ? 4 : "wrong" });
    await expect(store().submit(command)).rejects.toThrow();
    expect(store().read()).toEqual(command);
  }
);
it("archives with DELETE, expected version and verified archived state", async () => {
  await store().submit({
    action: "archive",
    assetId: id(3),
    clientKey: id(9),
    input: { expectedVersion: 2 },
  });
  expect(h.del.mock.calls[0][0]).toContain(`/asset-specs/${id(3)}`);
  expect(h.del.mock.calls[0][1].data).toEqual({ expectedVersion: 2 });
  expect(store().read()).toBeNull();
});
it("checks selected version identity", async () => {
  await expect(
    store().submit({ ...command, input: { expectedVersion: 2, selectedMediaVersionId: id(6) } })
  ).rejects.toThrow("version receipt");
});
it("checks imported primary media identity", async () => {
  await expect(
    store().submit({ ...command, input: { expectedVersion: 2, sourceMediaAssetId: id(6) } })
  ).rejects.toThrow("Imported");
});
it("supports clearing selected version", async () => {
  h.patch.mockResolvedValue({ ...receipt(), selectedMediaVersion: null });
  await store().submit({ ...command, input: { expectedVersion: 2, selectedMediaVersionId: null } });
  expect(store().read()).toBeNull();
});
it("blocks dispatch if recovery cannot be saved", async () => {
  storage.write.mockImplementation(() => {
    throw Error("Storage full");
  });
  await expect(store().submit(command)).rejects.toThrow("Storage full");
  expect(h.patch).not.toHaveBeenCalled();
});
it("rejects account changes without clearing recovery", async () => {
  h.patch.mockImplementation(async () => {
    h.generation = 2;
    return receipt();
  });
  await expect(store().submit(command)).rejects.toThrow("expired");
  expect(JSON.parse(raw!).intent).toEqual(command);
});
it("matches official mutually exclusive media and nonempty patch rules", () => {
  expect(assetPatchInput.safeParse({ expectedVersion: 2 }).success).toBe(false);
  expect(
    assetPatchInput.safeParse({
      expectedVersion: 2,
      sourceMediaAssetId: id(5),
      selectedMediaVersionId: null,
    }).success
  ).toBe(false);
  expect(
    assetPatchInput.safeParse({ expectedVersion: 2, sourceMediaPurpose: "turnaround" }).success
  ).toBe(false);
});

const creation: AssetCommand = {
  action: "create",
  clientKey: id(9),
  input: { kind: "character", name: "Hero", imagePrompt: "Hero" },
};
const created = () => ({
  ...receipt(),
  version: 0,
  kind: "character",
  name: "Hero",
  imagePrompt: "Hero",
  selectedMediaVersion: null,
  mediaVersions: [],
});
it("creates at the chapter collection with a saved idempotency key", async () => {
  h.post.mockImplementation(async () => {
    expect(store().read()).toEqual(creation);
    return created();
  });
  await store().submit(creation);
  expect(h.post.mock.calls[0][0]).toBe(`/story-projects/${id(1)}/chapters/${id(2)}/asset-specs`);
  expect(store().read()).toBeNull();
});
it("retries creation exactly after a lost reply", async () => {
  h.post.mockRejectedValueOnce(Error("Lost reply")).mockResolvedValueOnce(created());
  await expect(store().submit(creation)).rejects.toThrow();
  await store().submit(store().read()!);
  expect(h.post.mock.calls[0]).toEqual(h.post.mock.calls[1]);
});
it.each(["kind", "name", "imagePrompt", "version", "chapterId"])(
  "retains creation recovery on wrong %s",
  async (field) => {
    h.post.mockResolvedValue({ ...created(), [field]: field === "version" ? 1 : "wrong" });
    await expect(store().submit(creation)).rejects.toThrow();
    expect(store().read()).toEqual(creation);
  }
);
