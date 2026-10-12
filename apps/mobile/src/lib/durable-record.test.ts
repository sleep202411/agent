import { beforeEach, expect, it, vi } from "vitest";
import { durableRecord } from "./durable-record";
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
  durableRecord("send", "alice", "chat").write("draft");
  expect(durableRecord("send", "alice", "chat").read()).toBe("draft");
  expect(durableRecord("send", "bob", "chat").read()).toBeNull();
  expect(durableRecord("send", "alice", "other").read()).toBeNull();
  h.env.siteRegion = "cn";
  expect(durableRecord("send", "alice", "chat").read()).toBeNull();
  h.env.siteRegion = "global";
  h.env.api.auroraBaseUrl = "https://other.com/aurora";
  expect(durableRecord("send", "alice", "chat").read()).toBeNull();
});
it("reports failed reads and writes instead of silently accepting unsaved drafts", () => {
  const read = vi.spyOn(window.localStorage, "getItem").mockImplementationOnce(() => {
    throw new Error("blocked");
  });
  expect(() => durableRecord("send", "alice", "chat").read()).toThrow("blocked");
  read.mockRestore();
  const write = vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("full");
  });
  expect(() => durableRecord("send", "alice", "chat").write("draft")).toThrow("full");
  write.mockRestore();
});
