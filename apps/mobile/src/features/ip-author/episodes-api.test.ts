import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchAuthorEpisodes,
  episodeOutbox,
  mutateAuthorEpisode,
  type EpisodeCommand,
} from "./episodes-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  generation: 1,
  locale: "en-US",
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, delete: h.del },
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
    write: (s: string) => h.records.set(`${n}:${u}:${id}`, s),
  }),
}));
const ipId = "11111111-1111-4111-8111-111111111111",
  episodeId = "22222222-2222-4222-8222-222222222222",
  clientKey = "33333333-3333-4333-8333-333333333333";
const episode = {
  id: episodeId,
  episodeNo: 3,
  sortOrder: 3000,
  status: "published",
  title: "Original",
  summary: "Summary",
  durationSeconds: 100,
  isFreePreview: false,
  coverAsset: null,
  mediaAsset: null,
  trailerAsset: null,
};
const snapshot = { id: ipId, version: 1, sourceLocale: "en-US", episodes: [episode] };
const edit: EpisodeCommand = {
  clientKey,
  episodeId,
  action: "edit",
  expectedVersion: 1,
  sourceLocale: "en-US",
  data: { title: "Changed", summary: "New summary", durationSeconds: null, isFreePreview: true },
};
const remove: EpisodeCommand = {
  clientKey,
  episodeId,
  action: "delete",
  expectedVersion: 1,
  sourceLocale: "en-US",
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.locale = "en-US";
  h.get.mockResolvedValue({ ip: snapshot });
  h.put.mockResolvedValue({
    ip: { ...snapshot, version: 2, episodes: [{ ...episode, ...edit.data }] },
  });
  h.del.mockResolvedValue({ ip: { ...snapshot, version: 2, episodes: [] } });
});
it("loads source-language episodes and validates their identities", async () => {
  h.locale = "zh-CN";
  await fetchAuthorEpisodes(ipId, 1, signal());
  expect(h.get.mock.calls.map((call) => call[1].params.locale)).toEqual(["zh-CN", "en-US"]);
  h.get.mockResolvedValue({ ip: { ...snapshot, id: episodeId } });
  await expect(fetchAuthorEpisodes(ipId, 1, signal())).rejects.toThrow("identity");
  h.get.mockResolvedValue({ ip: { ...snapshot, episodes: [episode, episode] } });
  await expect(fetchAuthorEpisodes(ipId, 1, signal())).rejects.toThrow("Duplicate");
});
it("updates only the requested fields with the IP version and official timeout", async () => {
  await mutateAuthorEpisode(ipId, 1, edit, signal());
  expect(h.put.mock.calls[0][0]).toBe(`/ip-commerce/me/ips/${ipId}/episodes/${episodeId}`);
  expect(h.put.mock.calls[0][1]).toMatchObject({
    service: "aurora",
    retry: false,
    timeout: 120000,
    data: { ...edit.data, expectedVersion: 1 },
  });
  expect(h.put.mock.calls[0][1].data).not.toHaveProperty("status");
});
it("recovers an already-applied edit or deletion without a second mutation", async () => {
  h.get.mockResolvedValue({
    ip: { ...snapshot, version: 2, episodes: [{ ...episode, ...edit.data }] },
  });
  await mutateAuthorEpisode(ipId, 1, edit, signal());
  expect(h.put).not.toHaveBeenCalled();
  h.get.mockResolvedValue({ ip: { ...snapshot, version: 2, episodes: [] } });
  await mutateAuthorEpisode(ipId, 1, remove, signal());
  expect(h.del).not.toHaveBeenCalled();
});
it("rejects concurrent changes and disallowed publication status", async () => {
  h.get.mockResolvedValue({ ip: { ...snapshot, version: 5 } });
  await expect(mutateAuthorEpisode(ipId, 1, edit, signal())).rejects.toMatchObject({ status: 409 });
  expect(h.put).not.toHaveBeenCalled();
  await expect(
    mutateAuthorEpisode(
      ipId,
      1,
      { ...edit, data: { ...edit.data, status: "published" } } as unknown as EpisodeCommand,
      signal()
    )
  ).rejects.toThrow();
});
it("uses deletion contract and validates the returned episode is absent", async () => {
  await mutateAuthorEpisode(ipId, 1, remove, signal());
  expect(h.del.mock.calls[0][1]).toMatchObject({ retry: false, timeout: 120000 });
  h.del.mockResolvedValue({ ip: { ...snapshot, version: 2 } });
  await expect(mutateAuthorEpisode(ipId, 1, remove, signal())).rejects.toThrow("receipt mismatch");
});
it("persists an immutable request by owner and rejects stale sessions", async () => {
  const outbox = episodeOutbox(ipId, "alice", 1);
  outbox.save(edit);
  expect(episodeOutbox(ipId, "alice", 1).read()).toEqual(edit);
  expect(episodeOutbox(ipId, "bob", 1).read()).toBeNull();
  expect(() => outbox.save(remove)).toThrow("pending");
  h.generation = 2;
  await expect(mutateAuthorEpisode(ipId, 1, edit, signal())).rejects.toThrow("expired");
  expect(h.get).not.toHaveBeenCalled();
});
it("does not accept a save after the session is aborted", async () => {
  const c = new AbortController();
  h.put.mockImplementation(async () => {
    c.abort();
    return { ip: { ...snapshot, version: 2, episodes: [{ ...episode, ...edit.data }] } };
  });
  await expect(mutateAuthorEpisode(ipId, 1, edit, c.signal)).rejects.toThrow();
});
