import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { createProjectDocumentSaver } from "./project-document-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const document = {
  type: "doc" as const,
  content: [
    {
      type: "paragraph",
      attrs: { id },
      content: [{ type: "text", text: "Draft", marks: [{ type: "bold" }] }],
    },
  ],
};
const loaded = { crewId: "crew", version: 7, document };
let page: typeof loaded, access: { userId: string; permissions: string[] };
const make = () => createProjectDocumentSaver("crew", "actor", 1, loaded);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  page = structuredClone(loaded);
  access = { userId: "actor", permissions: ["production.view", "production.manage"] };
  vi.mocked(api.get).mockImplementation(async (path) => (path.endsWith("/me") ? access : { page }));
  vi.mocked(api.patch).mockResolvedValue({ ...loaded, version: 8 });
});
it("saves the canonical document with its original version and no metadata fields", async () => {
  const saved = await make()(document);
  expect(saved.version).toBe(8);
  expect(api.patch).toHaveBeenCalledWith("/crews/crew/production-overview/document", {
    service: "aurora",
    data: { expectedVersion: 7, document },
  });
});
it("advances the session version only after an exact successful receipt", async () => {
  const save = make();
  await save(document);
  page = { ...loaded, version: 8 };
  vi.mocked(api.patch).mockResolvedValueOnce({ ...loaded, version: 9 });
  await save(document);
  expect(vi.mocked(api.patch).mock.calls[1][1]?.data).toEqual({ expectedVersion: 8, document });
});
it.each([
  { userId: "other", permissions: ["production.manage"] },
  { userId: "actor", permissions: ["production.view"] },
])("checks fresh authority %j", async (value) => {
  access = value;
  await expect(make()(document)).rejects.toMatchObject({ code: "permission" });
  expect(api.patch).not.toHaveBeenCalled();
});
it("never rebases an old draft onto the latest server version", async () => {
  page = { ...loaded, version: 9 };
  const save = make();
  await expect(save(document)).rejects.toMatchObject({ code: "changed" });
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects a foreign preflight page", async () => {
  page = { ...loaded, crewId: "foreign" };
  await expect(make()(document)).rejects.toMatchObject({ code: "receipt" });
  expect(api.patch).not.toHaveBeenCalled();
});
it("prevents concurrent double submission", async () => {
  let resolve!: (v: unknown) => void;
  vi.mocked(api.patch).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  const save = make();
  const first = save(document);
  await vi.waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
  await expect(save(document)).rejects.toMatchObject({ code: "busy" });
  resolve({ ...loaded, version: 8 });
  await first;
  expect(api.patch).toHaveBeenCalledOnce();
});
it("snapshots input before awaiting permission", async () => {
  const draft = structuredClone(document);
  const pending = make()(draft);
  draft.content[0].content[0].text = "Changed while saving";
  await pending;
  expect(vi.mocked(api.patch).mock.calls[0][1]?.data).toEqual({ expectedVersion: 7, document });
});
it.each([
  { version: 7 },
  { version: 9 },
  { crewId: "foreign" },
  { document: { ...document, content: [{ type: "paragraph", attrs: { id } }] } },
])("locks uncertain receipts %j", async (override) => {
  vi.mocked(api.patch).mockResolvedValueOnce({ ...loaded, version: 8, ...override });
  const save = make();
  await expect(save(document)).rejects.toMatchObject({ code: "receipt" });
  await expect(save(document)).rejects.toMatchObject({ code: "uncertain" });
  expect(api.patch).toHaveBeenCalledOnce();
});
it("preserves server conflicts and prevents automatic retry", async () => {
  const error = new Error("Production document changed. Reload and retry.");
  vi.mocked(api.patch).mockRejectedValueOnce(error);
  const save = make();
  await expect(save(document)).rejects.toBe(error);
  await expect(save(document)).rejects.toMatchObject({ code: "uncertain" });
  expect(api.patch).toHaveBeenCalledOnce();
});
it("does not write after an account switch during preflight", async () => {
  vi.mocked(api.get).mockImplementation(async () => {
    h.generation++;
    return access;
  });
  await expect(make()(document)).rejects.toMatchObject({ code: "session" });
  expect(api.patch).not.toHaveBeenCalled();
});
it("does not acknowledge a result to a replacement account", async () => {
  vi.mocked(api.patch).mockImplementation(async () => {
    h.generation++;
    return { ...loaded, version: 8 };
  });
  await expect(make()(document)).rejects.toMatchObject({ code: "session" });
});
it("rejects invalid documents before any network requests", async () => {
  await expect(make()({ type: "doc", content: [{ type: "image" }] })).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
  expect(api.patch).not.toHaveBeenCalled();
});
it("accepts equivalent JSONB object key order without changing content order", async () => {
  const reversed = { content: document.content, type: "doc" };
  vi.mocked(api.patch).mockResolvedValueOnce({ document: reversed, version: 8, crewId: "crew" });
  await expect(make()(document)).resolves.toMatchObject({ version: 8 });
});
it("permits another attempt after a read-only preflight failure", async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error("Read failed"));
  const save = make();
  await expect(save(document)).rejects.toThrow("Read failed");
  await expect(save(document)).resolves.toMatchObject({ version: 8 });
  expect(api.patch).toHaveBeenCalledOnce();
});
