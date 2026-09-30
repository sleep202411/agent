import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchProjectDocument } from "./project-document-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const document = {
  type: "doc",
  content: [{ type: "paragraph", attrs: { id: "11111111-1111-4111-8111-111111111111" } }],
};
const page = { crewId: "crew", version: 7, document };
let access: { userId: string; permissions: string[] };
const read = (signal = new AbortController().signal) =>
  fetchProjectDocument("crew", "actor", 1, signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  access = { userId: "actor", permissions: ["production.view"] };
  vi.mocked(api.get).mockImplementation(async (path) => (path.endsWith("/me") ? access : { page }));
});
it("reads the canonical document and document version after fresh membership", async () => {
  expect(await read()).toEqual({ ...page, canManage: false });
  expect(api.get).toHaveBeenCalledTimes(2);
});
it.each([
  { userId: "other", permissions: ["production.view"] },
  { userId: "actor", permissions: [] },
])("rejects inaccessible accounts %j", async (value) => {
  access = value;
  await expect(read()).rejects.toThrow();
  expect(api.get).toHaveBeenCalledTimes(1);
});
it("rejects foreign crew documents", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce(access)
    .mockResolvedValueOnce({ page: { ...page, crewId: "other" } });
  await expect(read()).rejects.toThrow("scope mismatch");
});
it("rejects expired sessions before returning private content", async () => {
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path.endsWith("/me")) return access;
    h.generation++;
    return { page };
  });
  await expect(read()).rejects.toThrow("session expired");
});
it("does not request an aborted or stale session", async () => {
  const c = new AbortController();
  c.abort();
  await expect(read(c.signal)).rejects.toThrow();
  h.generation = 2;
  await expect(read()).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
});
it("rejects unsupported editor content instead of silently truncating", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce(access)
    .mockResolvedValueOnce({
      page: { ...page, document: { type: "doc", content: [{ type: "image" }] } },
    });
  await expect(read()).rejects.toThrow();
});
it("preserves upstream errors", async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error("Crew membership was revoked"));
  await expect(read()).rejects.toThrow("Crew membership was revoked");
});
