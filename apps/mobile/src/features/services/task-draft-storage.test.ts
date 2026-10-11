import { beforeEach, expect, it, vi } from "vitest";
import { taskDraftStorage } from "./task-draft-storage";
const h = vi.hoisted(() => ({
  env: { siteRegion: "global", api: { auroraBaseUrl: "https://example.com/aurora" } },
}));
vi.mock("@/config", () => ({ appEnv: h.env }));
beforeEach(() => {
  window.localStorage.clear();
  h.env.siteRegion = "global";
  h.env.api.auroraBaseUrl = "https://example.com/aurora";
});
it("isolates stored data by account, Crew, region and API deployment", () => {
  taskDraftStorage("crew", "alice").write("draft");
  expect(taskDraftStorage("crew", "alice").read()).toBe("draft");
  expect(taskDraftStorage("crew", "bob").read()).toBeNull();
  expect(taskDraftStorage("other", "alice").read()).toBeNull();
  h.env.siteRegion = "cn";
  expect(taskDraftStorage("crew", "alice").read()).toBeNull();
  h.env.siteRegion = "global";
  h.env.api.auroraBaseUrl = "https://other.com/aurora";
  expect(taskDraftStorage("crew", "alice").read()).toBeNull();
});
it("reports failed reads and writes instead of silently accepting unsaved drafts", () => {
  const read = vi.spyOn(window.localStorage, "getItem").mockImplementationOnce(() => {
    throw new Error("blocked");
  });
  expect(() => taskDraftStorage("crew", "alice").read()).toThrow("blocked");
  read.mockRestore();
  const write = vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("full");
  });
  expect(() => taskDraftStorage("crew", "alice").write("draft")).toThrow("full");
  write.mockRestore();
});
