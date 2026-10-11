import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchCertificationLevels,
  fetchLevelApplications,
  levelApplicationInput,
  levelApplicationPending,
  submitLevelApplication,
} from "./level-application-api";
const h = vi.hoisted(() => ({
  generation: 1,
  records: new Map<string, string>(),
  failStorage: false,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (namespace: string, user: string, key: string) => ({
    read: () => h.records.get(`${namespace}:${user}:${key}`) ?? null,
    write: (value: string) => {
      if (h.failStorage) throw new Error("Storage unavailable");
      h.records.set(`${namespace}:${user}:${key}`, value);
    },
  }),
}));
const level = { id: 13, name: "AI Producer" };
const input = () => ({ levelId: 13, crewName: "", crewLink: "", ipName: "", ipLink: "" });
const row = (status = 0) => ({ ...input(), id: 22, status });
const signal = () => new AbortController().signal;
const submit = () => submitLevelApplication(input(), "user", 1, "global", signal());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.failStorage = false;
  vi.mocked(api.get).mockImplementation(async (path) => (path.endsWith("/options") ? [level] : []));
  vi.mocked(api.post).mockResolvedValue({ code: 200, data: null });
});
it("uses the official Content endpoints without mutation retries", async () => {
  expect(await fetchCertificationLevels(1, signal())).toEqual([level]);
  expect(await fetchLevelApplications(1, signal())).toEqual([]);
  await submit();
  expect(api.post).toHaveBeenCalledWith(
    "/user/levels/apply",
    expect.objectContaining({
      service: "content",
      data: input(),
      retry: false,
      raw: true,
    })
  );
  expect(api.get).toHaveBeenCalledWith(
    "/user/levels/apply/mine",
    expect.objectContaining({
      service: "content",
      retry: false,
    })
  );
});
it("saves before sending and retains the acknowledged request for navigation recovery", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    expect(levelApplicationPending("user", 1).read()).toMatchObject({
      input: input(),
      acknowledged: false,
    });
    return { code: 200 };
  });
  await submit();
  expect(levelApplicationPending("user", 1).read()).toMatchObject({
    input: input(),
    acknowledged: true,
  });
  await expect(submit()).rejects.toThrow("previous");
  expect(api.post).toHaveBeenCalledOnce();
});
it.each([{}, null, { code: 0 }, { success: true }, { data: { id: 1 } }])(
  "does not acknowledge a malformed submission response %j",
  async (receipt) => {
    vi.mocked(api.post).mockResolvedValue(receipt);
    await expect(submit()).rejects.toThrow();
    expect(levelApplicationPending("user", 1).read()?.acknowledged).toBe(false);
  }
);
it("accepts the official string success code", async () => {
  vi.mocked(api.post).mockResolvedValue({ code: "200" });
  await submit();
  expect(levelApplicationPending("user", 1).read()?.acknowledged).toBe(true);
});
it("preserves a lost response, never replays it, and does not infer a receipt from list matches", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Connection lost"));
  await expect(submit()).rejects.toThrow("Connection lost");
  vi.mocked(api.get).mockResolvedValue([row()]);
  await fetchLevelApplications(1, signal());
  expect(levelApplicationPending("user", 1).read()?.acknowledged).toBe(false);
  await expect(submit()).rejects.toThrow("previous");
  expect(api.post).toHaveBeenCalledOnce();
});
it.each(["missing", "pending"])("blocks submissions when the level is %s", async (mode) => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/options") ? (mode === "missing" ? [] : [level]) : [row()]
  );
  await expect(submit()).rejects.toThrow(mode === "pending" ? "already pending" : "no longer");
  expect(api.post).not.toHaveBeenCalled();
  expect(levelApplicationPending("user", 1).read()).toBeNull();
});
it.each([1, 2, 3])("does not confuse status %i with pending", async (status) => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/options") ? [level] : [row(status)]
  );
  await submit();
  expect(api.post).toHaveBeenCalledOnce();
});
it("allows only one simultaneous confirmation to send", async () => {
  const results = await Promise.allSettled([submit(), submit()]);
  expect(results.filter((v) => v.status === "fulfilled")).toHaveLength(1);
  expect(api.post).toHaveBeenCalledOnce();
});
it("fails closed on storage errors", async () => {
  h.failStorage = true;
  await expect(submit()).rejects.toThrow("Storage");
  expect(api.post).not.toHaveBeenCalled();
});
it("does not discard a corrupt request record", async () => {
  h.records.set("level-application:user:submit", "{invalid");
  await expect(submit()).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it("clears only the explicitly reviewed account record", async () => {
  await submit();
  expect(levelApplicationPending("other", 1).read()).toBeNull();
  levelApplicationPending("other", 1).clear();
  expect(levelApplicationPending("user", 1).read()).not.toBeNull();
  levelApplicationPending("user", 1).clear();
  expect(levelApplicationPending("user", 1).read()).toBeNull();
});
it.each(["before", "read", "post"])("rejects account changes %s the request", async (when) => {
  if (when === "before") h.generation = 2;
  if (when === "read")
    vi.mocked(api.get).mockImplementation(async (path) => {
      h.generation = 2;
      return path.endsWith("/options") ? [level] : [];
    });
  if (when === "post")
    vi.mocked(api.post).mockImplementation(async () => {
      h.generation = 2;
      return { code: 200 };
    });
  await expect(submit()).rejects.toThrow("session");
  if (when !== "post") expect(api.post).not.toHaveBeenCalled();
  else {
    h.generation = 1;
    expect(levelApplicationPending("user", 1).read()?.acknowledged).toBe(false);
  }
});
it.each(["before", "post"])("respects cancellation %s sending", async (when) => {
  const controller = new AbortController();
  if (when === "before") controller.abort();
  else
    vi.mocked(api.post).mockImplementation(async () => {
      controller.abort();
      return { code: 200 };
    });
  await expect(
    submitLevelApplication(input(), "user", 1, "global", controller.signal)
  ).rejects.toThrow("cancelled");
  if (when === "before") expect(api.post).not.toHaveBeenCalled();
  else expect(levelApplicationPending("user", 1).read()?.acknowledged).toBe(false);
});
it.each(["levels", "applications"])("rejects duplicate %s rather than submitting", async (kind) => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/options") ? (kind === "levels" ? [level, level] : [level]) : [row(2), row(2)]
  );
  await expect(submit()).rejects.toThrow("Duplicate");
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects unknown application statuses instead of overlooking a pending request", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/options") ? [level] : [row(4)]
  );
  await expect(submit()).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it.each(["global", "cn"] as const)(
  "preserves selected associations and trims notes in %s",
  async (region) => {
    const origin = region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
    const data = {
      ...input(),
      crewName: "Crew",
      crewLink: `${origin}/zh-CN/crews/crew-1`,
      ipName: "IP",
      ipLink: `${origin}/ip/room_1`,
      extraInfo: " note ",
      attachmentUrl: "apply/file.pdf",
    };
    await submitLevelApplication(data, "user", 1, region, signal());
    expect(api.post).toHaveBeenCalledWith(
      "/user/levels/apply",
      expect.objectContaining({ data: { ...data, extraInfo: "note" } })
    );
  }
);
it.each([
  "https://fizzdragon.fizzspace.cn/crews/crew",
  "https://other.test/crews/crew",
  "https://user@fizzdragon.com/crews/crew",
  "https://fizzdragon.com/crews/crew?other=1",
  "https://fizzdragon.com/crews/crew#fragment",
  "https://fizzdragon.com/ips/123",
])("rejects an unrelated or wrong-region association %s", async (crewLink) => {
  await expect(
    submitLevelApplication(
      { ...input(), crewName: "Crew", crewLink },
      "user",
      1,
      "global",
      signal()
    )
  ).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it.each([
  { extraInfo: "a".repeat(301) },
  { crewName: "Crew" },
  { ipLink: "https://fizzdragon.com/ip/room" },
  { levelId: 0 },
  { adminRemark: "approved" },
])("rejects invalid or additional submission fields %j", (patch) => {
  expect(levelApplicationInput.safeParse({ ...input(), ...patch }).success).toBe(false);
});
