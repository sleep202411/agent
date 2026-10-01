import { beforeEach, expect, it, vi } from "vitest";
import { workDraft } from "./work-draft";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://example.com" } },
}));
let raw: string | null;
const storage = {
  read: () => raw,
  write: (value: string) => {
    raw = value;
  },
};
const draft = {
  key: "intent",
  phase: "creating" as const,
  title: "Film",
  description: "Story",
  tagIds: [1],
};
beforeEach(() => {
  raw = null;
  h.generation = 1;
});
it("retains the creation intent, then resumes its acknowledged ID across instances", () => {
  const first = workDraft("user", 1, undefined, storage);
  first.start(draft);
  const restored = workDraft("user", 1, undefined, storage);
  expect(restored.read()).toEqual(draft);
  expect(() => restored.start(draft)).toThrow("pending");
  restored.confirm("intent", "12");
  expect(first.read()).toEqual({ ...draft, phase: "uploading", workId: "12" });
  expect(() => first.confirm("intent", "other")).toThrow("changed");
  expect(() => first.clear("other")).toThrow("changed");
  first.clear("intent");
  expect(restored.read()).toBeNull();
});
it("requires known IDs for updates and blocks stale-account writes", () => {
  const store = workDraft("user", 1, "12", storage);
  expect(() => store.start({ ...draft, phase: "updating" })).toThrow();
  store.start({ ...draft, phase: "updating", workId: "12" });
  h.generation = 2;
  expect(() => store.confirm("intent", "12")).toThrow("expired");
  expect(() => store.clear("intent")).toThrow("expired");
});
