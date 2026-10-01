import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchTemplates,
  fetchTemplateModels,
  saveTemplates,
  templatesDraft,
  templatesOutbox,
  templatesCommand,
  type GenerationTemplate,
} from "./templates-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put },
  ApiRequestError: class extends Error {
    constructor(
      _code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  key = "22222222-2222-4222-8222-222222222222",
  other = "33333333-3333-4333-8333-333333333333";
const template = (): GenerationTemplate => ({
  id: key,
  name: "Poster",
  description: "Description",
  modelId: "image-one",
  promptPrefix: "Prefix",
  promptSuffix: "Suffix",
  requireReferenceImage: true,
  referenceImageHint: "Portrait",
  outputAspectRatio: "1:1",
  logoAssetId: null,
  enabled: true,
  order: 1,
});
const command = () => ({ clientKey: other, expectedVersion: 1, templates: [template()] }),
  signal = () => new AbortController().signal;
let snapshot: { version: number; templates: GenerationTemplate[] };
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  snapshot = { version: 1, templates: [] };
  h.get.mockImplementation(async () => snapshot);
  h.put.mockImplementation(async (_path, { data }) => ({ version: 2, templates: data.templates }));
});
it("validates IDs, limits and required fields using the official shape", () => {
  expect(templatesCommand.safeParse(command()).success).toBe(true);
  for (const templates of [
    [{ ...template(), name: " " }],
    [template(), template()],
    Array.from({ length: 51 }, () => template()),
    [{ ...template(), outputAspectRatio: "3:2" }],
    [{ ...template(), promptPrefix: "x".repeat(2001) }],
  ])
    expect(templatesCommand.safeParse({ ...command(), templates }).success).toBe(false);
});
it("preserves incomplete drafts and spaces while typing across restarts", () => {
  const draft = {
    version: 1,
    templates: [{ ...template(), name: "", description: "Hello " }],
    logo: null,
  };
  templatesDraft(id, "alice", 1).save(draft);
  expect(templatesDraft(id, "alice", 1).read()).toEqual(draft);
  expect(templatesDraft(id, "bob", 1).read()).toBeNull();
  expect(templatesDraft(other, "alice", 1).read()).toBeNull();
  expect(() =>
    templatesDraft(id, "alice", 1).save({
      ...draft,
      logo: {
        templateId: other,
        fileName: "a.png",
        storageKey: "key",
        kind: "ip_banner",
        contentType: "image/png",
      },
    })
  ).toThrow();
});
it("loads current account catalog without global cache or invented model fallback", async () => {
  h.get.mockResolvedValue({
    models: [
      { id: "a", name: "Image", type: "image" },
      { id: "b", name: "Video", type: "video" },
      { id: "c", name: "Audio", type: "audio" },
      { id: "d", name: "Hidden", type: "image", enabled: false },
      { id: "e", name: "Denied", type: "video", access: { allowed: false } },
    ],
  });
  expect((await fetchTemplateModels(1, signal())).map((m) => m.id)).toEqual(["a", "b"]);
  h.get.mockResolvedValue({ models: [] });
  expect(await fetchTemplateModels(1, signal())).toEqual([]);
  expect(h.get).toHaveBeenCalledTimes(2);
});
it("persists an exact command before a versioned write and validates its receipt", async () => {
  h.put.mockImplementation(async (path, { data, retry }) => {
    expect(path).toBe(`/ip-commerce/me/ips/${id}/generation-templates`);
    expect(templatesOutbox(id, "alice", 1).read()).toEqual(command());
    expect(data).toEqual({ expectedVersion: 1, templates: [template()] });
    expect(retry).toBe(false);
    return { version: 2, templates: data.templates };
  });
  await saveTemplates(id, "alice", 1, command(), signal());
  expect(templatesOutbox(id, "alice", 1).read()).toBeNull();
});
it("recovers a lost matching receipt by readback without a second write", async () => {
  h.put.mockImplementationOnce(async (_path, { data }) => {
    snapshot = { version: 2, templates: data.templates };
    throw Error("Lost response");
  });
  await expect(saveTemplates(id, "alice", 1, command(), signal())).rejects.toThrow("Lost");
  await saveTemplates(id, "alice", 1, command(), signal());
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(templatesOutbox(id, "alice", 1).read()).toBeNull();
});
it("retains conflicting original changes and never silently rebases", async () => {
  snapshot = { version: 2, templates: [{ ...template(), name: "Other editor" }] };
  await expect(saveTemplates(id, "alice", 1, command(), signal())).rejects.toThrow("changed");
  expect(h.put).not.toHaveBeenCalled();
  expect(() =>
    templatesOutbox(id, "alice", 1).save({ ...command(), expectedVersion: 2 })
  ).toThrow();
  expect(templatesOutbox(id, "alice", 1).read()).toEqual(command());
  snapshot = { version: 3, templates: [template()] };
  await expect(saveTemplates(id, "alice", 1, command(), signal())).rejects.toThrow("changed");
});
it("retries unchanged-version transport failures with exactly the original request", async () => {
  h.put.mockRejectedValueOnce(Error("Offline"));
  await expect(saveTemplates(id, "alice", 1, command(), signal())).rejects.toThrow();
  await saveTemplates(id, "alice", 1, command(), signal());
  expect(h.put.mock.calls[0][1].data).toEqual(h.put.mock.calls[1][1].data);
});
it("rejects malformed or mismatched receipts without clearing the pending save", async () => {
  h.put.mockResolvedValue({ version: 2, templates: [] });
  await expect(saveTemplates(id, "alice", 1, command(), signal())).rejects.toThrow("receipt");
  expect(templatesOutbox(id, "alice", 1).read()).not.toBeNull();
  h.get.mockResolvedValue({ version: 1, templates: [template(), template()] });
  await expect(fetchTemplates(id, 1, signal())).rejects.toThrow();
});
it("guards account switches, canceled calls and late responses", async () => {
  h.get.mockImplementationOnce(async () => {
    h.generation = 2;
    return snapshot;
  });
  await expect(fetchTemplates(id, 1, signal())).rejects.toThrow("expired");
  expect(() => templatesDraft(id, "alice", 1).read()).toThrow();
  h.generation = 1;
  const c = new AbortController();
  c.abort();
  await expect(saveTemplates(id, "alice", 1, command(), c.signal)).rejects.toThrow();
  expect(h.put).not.toHaveBeenCalled();
});
