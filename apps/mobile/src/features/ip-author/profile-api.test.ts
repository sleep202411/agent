import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchIpProfile,
  profileRecovery,
  profileOutbox,
  saveIpProfile,
  type ProfileCommand,
} from "./profile-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  generation: 1,
  locale: "en-US",
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put },
  ApiRequestError: class extends Error {
    status: number;
    constructor(_code: string, message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => h.locale }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (n: string, u: string, id: string) => ({
    read: () => h.records.get(`${n}:${u}:${id}`) ?? null,
    write: (v: string) => h.records.set(`${n}:${u}:${id}`, v),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111";
const ip = {
  id,
  version: 1,
  sourceLocale: "en-US",
  status: "draft",
  title: "Source",
  summary: "Summary",
  description: null,
  listingVisibility: "private",
  ageRating: "general",
  genreCodes: ["drama"],
};
const command = {
  ...ip,
  title: "Edited",
  clientKey: "22222222-2222-4222-8222-222222222222",
  expectedVersion: 1,
} as ProfileCommand;
beforeEach(() => {
  h.get.mockReset();
  h.put.mockReset();
  h.generation = 1;
  h.locale = "en-US";
  h.records.clear();
});
it("reads source-language fields instead of editing a translated copy", async () => {
  h.locale = "zh-CN";
  h.get
    .mockResolvedValueOnce({ ip: { ...ip, title: "Translation" } })
    .mockResolvedValueOnce({ ip });
  expect((await fetchIpProfile(id, 1, new AbortController().signal)).title).toBe("Source");
  expect(h.get.mock.calls.map((call) => call[1].params.locale)).toEqual(["zh-CN", "en-US"]);
});
it("sends only profile fields and the original expected version", async () => {
  h.get.mockResolvedValue({ ip });
  h.put.mockResolvedValue({ ip: { ...ip, title: "Edited", version: 2 } });
  const signal = new AbortController().signal;
  await saveIpProfile(id, 1, command, signal);
  expect(h.put).toHaveBeenCalledWith(`/ip-commerce/me/ips/${id}`, {
    service: "aurora",
    signal,
    retry: false,
    data: {
      title: "Edited",
      summary: "Summary",
      description: null,
      listingVisibility: "private",
      ageRating: "general",
      genreCodes: ["drama"],
      expectedVersion: 1,
    },
  });
});
it("recovers a lost write response without resending and rejects a conflicting newer version", async () => {
  h.get
    .mockResolvedValueOnce({ ip: { ...ip, title: "Edited", version: 2 } })
    .mockResolvedValueOnce({ ip: { ...ip, title: "Other edit", version: 3 } });
  await expect(saveIpProfile(id, 1, command, new AbortController().signal)).resolves.toMatchObject({
    version: 2,
  });
  await expect(saveIpProfile(id, 1, command, new AbortController().signal)).rejects.toMatchObject({
    status: 409,
  });
  expect(h.put).not.toHaveBeenCalled();
});
it("rejects identity mismatches, stale accounts and aborted reads", async () => {
  h.get.mockResolvedValue({ ip: { ...ip, id: "33333333-3333-4333-8333-333333333333" } });
  await expect(fetchIpProfile(id, 1, new AbortController().signal)).rejects.toThrow(
    "identity mismatch"
  );
  h.generation = 2;
  await expect(saveIpProfile(id, 1, command, new AbortController().signal)).rejects.toThrow(
    "expired"
  );
  const c = new AbortController();
  c.abort();
  await expect(fetchIpProfile(id, 2, c.signal)).rejects.toThrow("expired");
  expect(h.put).not.toHaveBeenCalled();
});
it("persists exact pending contents per owner and rejects rewriting an uncertain save", () => {
  const out = profileOutbox(id, "alice", 1);
  out.save(command);
  expect(profileOutbox(id, "alice", 1).read()?.title).toBe("Edited");
  expect(profileOutbox(id, "bob", 1).read()).toBeNull();
  expect(() => out.save({ ...command, title: "Different" })).toThrow();
  out.clear(command.clientKey);
  expect(out.read()).toBeNull();
});
it("keeps incomplete legacy profiles editable and normalizes blank descriptions on save", async () => {
  h.get.mockResolvedValueOnce({ ip: { ...ip, genreCodes: [] } }).mockResolvedValueOnce({ ip });
  expect((await fetchIpProfile(id, 1, new AbortController().signal)).genreCodes).toEqual([]);
  h.put.mockResolvedValue({ ip: { ...ip, title: "Edited", version: 2 } });
  await saveIpProfile(id, 1, { ...command, description: "  " }, new AbortController().signal);
  expect(h.put.mock.calls[0]?.[1].data.description).toBeNull();
});

it("isolates editable recovery by account and IP and rejects stale sessions or foreign drafts", () => {
  const record = profileRecovery(id, "alice", 1);
  record.save(command);
  expect(profileRecovery(id, "alice", 1).read()).toMatchObject({
    title: command.title,
    clientKey: command.clientKey,
  });
  expect(profileRecovery(id, "bob", 1).read()).toBeNull();
  expect(profileRecovery("33333333-3333-4333-8333-333333333333", "alice", 1).read()).toBeNull();
  expect(() =>
    record.save({ ...command, clientKey: "44444444-4444-4444-8444-444444444444" })
  ).toThrow("Another IP draft");
  record.save({ ...command, expectedVersion: 3 });
  expect(record.read()?.expectedVersion).toBe(3);
  h.generation = 2;
  expect(() => record.read()).toThrow("session expired");
  expect(() => record.clear(command.clientKey)).toThrow("session expired");
});
