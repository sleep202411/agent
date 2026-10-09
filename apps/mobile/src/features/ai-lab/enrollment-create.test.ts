import { beforeEach, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  prepareLikenessCreation,
  submitLibraryCommand,
  characterLibraryBox,
  ENROLLMENT_CONSENT_VERSION,
} from "./character-library-api";
const h = vi.hoisted(() => ({
  workspaces: vi.fn(),
  post: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/features/agent/api/studio-projects-api", () => ({
  loadAgentWorkspaces: h.workspaces,
  canCreateStudioProject: (w: { role: string }) => w.role === "editor",
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(ns + user + id) ?? null,
    write: (v: string) => h.records.set(ns + user + id, v),
  }),
}));
const workspaceId = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  key = "33333333-3333-4333-8333-333333333333";
const detail = {
  id,
  workspaceId,
  kind: "real_person",
  name: "My likeness",
  description: null,
  coverAssetId: null,
  status: "draft",
  createdByUserId: "actor",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  mediaCounts: { image: 0, video: 0, audio: 0 },
  media: [],
};
const intent = () =>
  prepareLikenessCreation(workspaceId, { name: "My likeness", description: "" }, key, true, true);
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.workspaces.mockResolvedValue([{ id: workspaceId, isDefault: true, role: "editor" }]);
  h.post.mockResolvedValue(detail);
});
it("renders the exact official enrollment clauses and version in all three locales", () => {
  for (const locale of ["en-US", "zh-CN", "zh-HK"]) {
    const mobile = JSON.parse(readFileSync(resolve("src/i18n/messages", locale + ".json"), "utf8"));
    const official = JSON.parse(
      readFileSync(resolve("../studio/messages", locale + ".json"), "utf8")
    ).characters;
    for (const k of [
      "consentVersionLabel",
      "consentAttestation",
      "consentScrollHint",
      ...["Purpose", "Data", "Transfer", "Retention", "Scope", "Withdraw", "Outputs"].flatMap((s) =>
        ["Title", "Body"].map((p) => `consent${s}${p}`)
      ),
    ])
      expect(mobile["enrollmentConsent." + k]).toBe(official[k]);
  }
  expect(readFileSync(resolve("../studio/lib/characters-api.ts"), "utf8")).toContain(
    `REAL_PERSON_CONSENT_VERSION = "${ENROLLMENT_CONSENT_VERSION}"`
  );
});
it("requires read-through and adult attestation, bounds name and description", () => {
  for (const [read, adult] of [
    [false, true],
    [true, false],
  ])
    expect(() =>
      prepareLikenessCreation(workspaceId, { name: "Me", description: "" }, key, read, adult)
    ).toThrow("consent");
  expect(() =>
    prepareLikenessCreation(workspaceId, { name: " ", description: "" }, key, true, true)
  ).toThrow();
  expect(() =>
    prepareLikenessCreation(
      workspaceId,
      { name: "Me", description: "x".repeat(201) },
      key,
      true,
      true
    )
  ).toThrow();
});
it("rechecks default workspace and editor role before the consented POST", async () => {
  h.workspaces.mockResolvedValueOnce([{ id: workspaceId, isDefault: false, role: "editor" }]);
  await expect(submitLibraryCommand(intent(), "actor", 1, signal())).rejects.toThrow("default");
  h.workspaces.mockResolvedValueOnce([{ id: workspaceId, isDefault: true, role: "viewer" }]);
  await expect(submitLibraryCommand(intent(), "actor", 1, signal())).rejects.toThrow("editor");
  expect(h.post).not.toHaveBeenCalled();
  h.post.mockImplementation(async (path, { data, retry }) => {
    expect(path).toBe("/characters");
    expect(retry).toBe(false);
    expect(data).toEqual({
      workspaceId,
      kind: "real_person",
      name: "My likeness",
      description: "",
      consent: { version: ENROLLMENT_CONSENT_VERSION, adultAttested: true },
    });
    expect(characterLibraryBox("actor", 1, workspaceId).read()).toEqual(intent());
    return detail;
  });
  const result = await submitLibraryCommand(intent(), "actor", 1, signal());
  expect(result?.status).toBe("draft");
  expect(characterLibraryBox("actor", 1, workspaceId).read()).toBeNull();
});
it("retains unknown creates across restart without creating another likeness", async () => {
  h.post.mockRejectedValueOnce(Error("Lost creation receipt"));
  await expect(submitLibraryCommand(intent(), "actor", 1, signal())).rejects.toThrow("Lost");
  expect(characterLibraryBox("actor", 1, workspaceId).read()).toEqual(intent());
  expect(characterLibraryBox("other", 1, workspaceId).read()).toBeNull();
  await expect(submitLibraryCommand(intent(), "actor", 1, signal())).rejects.toThrow("original");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("preserves server gate errors and refuses virtual or late-session receipts", async () => {
  h.post.mockRejectedValueOnce(Error("Enrollment is temporarily paused."));
  await expect(submitLibraryCommand(intent(), "actor", 1, signal())).rejects.toThrow(
    "temporarily paused"
  );
  h.records.clear();
  h.post.mockResolvedValueOnce({ ...detail, kind: "virtual" });
  await expect(submitLibraryCommand(intent(), "actor", 1, signal())).rejects.toThrow("receipt");
  expect(characterLibraryBox("actor", 1, workspaceId).read()).not.toBeNull();
  h.records.clear();
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return detail;
  });
  await expect(submitLibraryCommand(intent(), "actor", 1, signal())).rejects.toThrow();
  h.generation = 1;
  expect(characterLibraryBox("actor", 1, workspaceId).read()).not.toBeNull();
});
