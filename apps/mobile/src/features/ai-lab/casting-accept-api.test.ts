import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  acceptCastingInvitation,
  castingAcceptanceBox,
  prepareCastingAcceptance,
  reviewCastingInvite,
  PROJECT_LIKENESS_CONSENT_VERSION,
} from "./casting-accept-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  workspaces: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/features/agent/api/studio-projects-api", () => ({ loadAgentWorkspaces: h.workspaces }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, key: string) => ({
    read: () => h.records.get(ns + user + key) ?? null,
    write: (v: string) => h.records.set(ns + user + key, v),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  key = "33333333-3333-4333-8333-333333333333",
  token = "a".repeat(32);
const preview = () => ({
  projectId: other,
  projectName: "Film",
  status: "pending",
  expiresAt: "2099-01-01T00:00:00Z",
  acceptable: true,
});
const likeness = () => ({
  id,
  workspaceId: id,
  kind: "real_person",
  status: "active",
  name: "My likeness",
  coverAssetId: null,
  updatedAt: "2026-01-01T00:00:00Z",
});
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.workspaces.mockResolvedValue([{ id, isDefault: true }]);
  h.get.mockImplementation(async (path) =>
    path === "/characters" ? { items: [likeness()] } : preview()
  );
  h.post.mockResolvedValue({ ok: true });
});
it("loads only active real-person likenesses from the default workspace", async () => {
  h.get.mockImplementation(async (path) =>
    path === "/characters"
      ? { items: [likeness(), { ...likeness(), id: other, kind: "virtual" }] }
      : preview()
  );
  const review = await reviewCastingInvite(token, 1, signal());
  expect(review.likenesses).toHaveLength(1);
  expect(h.get).toHaveBeenCalledWith(
    "/characters",
    expect.objectContaining({ params: { workspaceId: id }, retry: false })
  );
});
it("requires a live invitation, unique default workspace and matching library", async () => {
  h.get.mockResolvedValueOnce({ ...preview(), acceptable: false });
  await expect(reviewCastingInvite(token, 1, signal())).rejects.toThrow("no longer");
  expect(h.workspaces).not.toHaveBeenCalled();
  h.workspaces.mockResolvedValueOnce([]);
  await expect(reviewCastingInvite(token, 1, signal())).rejects.toThrow("default");
  h.get.mockImplementation(async (path) =>
    path === "/characters" ? { items: [{ ...likeness(), workspaceId: other }] } : preview()
  );
  await expect(reviewCastingInvite(token, 1, signal())).rejects.toThrow("library");
});
it("requires both consent gates and detects changed project/likeness before writing", async () => {
  const review = await reviewCastingInvite(token, 1, signal());
  expect(() => prepareCastingAcceptance(token, review, id, key, false, true)).toThrow("consent");
  expect(() => prepareCastingAcceptance(token, review, id, key, true, false)).toThrow("consent");
  const command = prepareCastingAcceptance(token, review, id, key, true, true);
  h.get.mockImplementation(async (path) =>
    path === "/characters" ? { items: [likeness()] } : { ...preview(), projectName: "Different" }
  );
  await expect(acceptCastingInvitation(token, command, "actor", 1, signal())).rejects.toThrow(
    "changed"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("saves before acceptance, sends official consent, and clears only a validated receipt", async () => {
  const command = prepareCastingAcceptance(
    token,
    await reviewCastingInvite(token, 1, signal()),
    id,
    key,
    true,
    true
  );
  h.post.mockImplementationOnce(async (_path, opts) => {
    expect(castingAcceptanceBox("actor", 1, token).read()).toEqual(command);
    expect(opts).toMatchObject({
      retry: false,
      data: {
        characterId: id,
        consent: { version: PROJECT_LIKENESS_CONSENT_VERSION, adultAttested: true },
      },
    });
    return { ok: true };
  });
  await acceptCastingInvitation(token, command, "actor", 1, signal());
  expect(castingAcceptanceBox("actor", 1, token).read()).toBeNull();
  expect([...h.records.keys()].join()).not.toContain(token);
  expect([...h.records.values()].join()).not.toContain(token);
});
it("retains uncertain acceptance across restart and never interprets unavailable as success", async () => {
  const command = prepareCastingAcceptance(
    token,
    await reviewCastingInvite(token, 1, signal()),
    id,
    key,
    true,
    true
  );
  h.post.mockRejectedValueOnce(Error("reply lost"));
  await expect(acceptCastingInvitation(token, command, "actor", 1, signal())).rejects.toThrow(
    "reply lost"
  );
  await expect(acceptCastingInvitation(token, command, "actor", 1, signal())).rejects.toThrow(
    "awaiting"
  );
  expect(h.post).toHaveBeenCalledTimes(1);
  h.get.mockRejectedValueOnce(Error("no longer open"));
  await expect(reviewCastingInvite(token, 1, signal())).rejects.toThrow("no longer");
  expect(castingAcceptanceBox("actor", 1, token).read()).toEqual(command);
  expect(castingAcceptanceBox("other", 1, token).read()).toBeNull();
});
it("keeps late or mismatched successful responses pending under the original account", async () => {
  const command = prepareCastingAcceptance(
    token,
    await reviewCastingInvite(token, 1, signal()),
    id,
    key,
    true,
    true
  );
  h.post.mockImplementationOnce(async () => {
    h.generation = 2;
    return { ok: true };
  });
  await expect(acceptCastingInvitation(token, command, "actor", 1, signal())).rejects.toThrow(
    "session"
  );
  h.generation = 1;
  expect(castingAcceptanceBox("actor", 1, token).read()).toEqual(command);
});
it("keeps all versioned consent clauses identical to the official Studio text", () => {
  for (const locale of ["en-US", "zh-CN", "zh-HK"]) {
    const mobile = JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8"));
    const official = JSON.parse(
      readFileSync(`../studio/messages/${locale}.json`, "utf8")
    ).characters;
    for (const [key, value] of Object.entries(mobile))
      if (key.startsWith("castingConsent."))
        expect(value).toBe(official[key.slice("castingConsent.".length)]);
  }
});
