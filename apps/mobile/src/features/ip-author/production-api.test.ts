import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchOwnedGames,
  fetchStageApplications,
  productionCommand,
  productionOutbox,
  saveProduction,
  type ProductionCommand,
} from "./production-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post },
  ApiRequestError: class extends Error {
    constructor(
      _code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  clientKey = "22222222-2222-4222-8222-222222222222",
  nextKey = "33333333-3333-4333-8333-333333333333";
const gameId = "44444444-4444-4444-8444-444444444444";
const game: ProductionCommand = {
  kind: "games",
  clientKey,
  gameId,
  expectedVersion: 3,
  active: true,
};
const stage: ProductionCommand = {
  kind: "stages",
  clientKey,
  stage: "production",
  expectedVersion: 2,
  reason: "Ready to produce",
};
const candidate = { gameId, title: "Game", version: 3, linked: false, linkedElsewhere: false };
const application = {
  code: 200,
  id: clientKey,
  applicantId: "alice",
  stage: "production",
  stageVersion: 2,
  reason: "Ready to produce",
  status: "pending",
  reviewReason: null,
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.get.mockResolvedValue({ code: 200, items: [candidate], nextCursor: null });
  h.post.mockImplementation(async (path: string) =>
    path.includes("/games/") ? { code: 200, gameId, version: 4, active: true } : application
  );
});
it("reads cursor pages using the official raw response and rejects invalid pagination", async () => {
  expect((await fetchOwnedGames(id, 1, signal(), nextKey)).items).toEqual([candidate]);
  expect(h.get).toHaveBeenCalledWith(
    expect.stringContaining("/owned-games"),
    expect.objectContaining({ raw: true, retry: false, params: { cursor: nextKey } })
  );
  h.get.mockResolvedValue({ code: 200, items: [candidate, candidate], nextCursor: null });
  await expect(fetchOwnedGames(id, 1, signal())).rejects.toThrow();
  h.get.mockResolvedValue({ code: 200, items: [candidate], nextCursor: nextKey });
  await expect(fetchOwnedGames(id, 1, signal(), nextKey)).rejects.toThrow();
  h.get.mockResolvedValue({
    code: 200,
    items: [{ ...candidate, linked: true, linkedElsewhere: true }],
    nextCursor: null,
  });
  await expect(fetchOwnedGames(id, 1, signal())).rejects.toThrow();
});
it("reads stage history and rejects invalid status, duplicate entries and failed envelopes", async () => {
  h.get.mockResolvedValue({
    code: 200,
    state: { stage: "testing", version: 0 },
    items: [application],
  });
  expect((await fetchStageApplications(id, 1, signal())).items[0].status).toBe("pending");
  h.get.mockResolvedValue({
    code: 200,
    state: { stage: "testing", version: 0 },
    items: [application, application],
  });
  await expect(fetchStageApplications(id, 1, signal())).rejects.toThrow();
  h.get.mockResolvedValue({ code: 500, items: [], nextCursor: null });
  await expect(fetchOwnedGames(id, 1, signal())).rejects.toThrow();
});
it.each([game, stage])(
  "persists and retries an immutable $kind command with the same server identity",
  async (command) => {
    const outbox = productionOutbox(id, "alice", 1, command.kind);
    h.post.mockImplementationOnce(async () => {
      expect(outbox.read()).toEqual(command);
      throw new Error("Lost reply");
    });
    await expect(saveProduction(id, "alice", 1, command, signal())).rejects.toThrow("Lost reply");
    expect(outbox.read()).toEqual(command);
    await saveProduction(id, "alice", 1, command, signal());
    expect(outbox.read()).toBeNull();
    expect(h.post.mock.calls[0][1].data).toEqual(h.post.mock.calls[1][1].data);
    expect(h.get).not.toHaveBeenCalled();
  }
);
it("validates exact game receipts before clearing pending intent", async () => {
  for (const bad of [{ gameId: nextKey }, { version: 9 }, { active: false }, { code: 500 }]) {
    h.post.mockResolvedValue({ code: 200, gameId, version: 4, active: true, ...bad });
    await expect(saveProduction(id, "alice", 1, game, signal())).rejects.toThrow();
    expect(productionOutbox(id, "alice", 1, "games").read()).toEqual(game);
  }
});
it("validates stage identity, actor, version and reason, allowing already-reviewed replay receipts", async () => {
  for (const bad of [
    { id: nextKey },
    { applicantId: "bob" },
    { stageVersion: 9 },
    { stage: "released" },
    { reason: "Changed" },
  ]) {
    h.post.mockResolvedValue({ ...application, ...bad });
    await expect(saveProduction(id, "alice", 1, stage, signal())).rejects.toThrow();
    expect(productionOutbox(id, "alice", 1, "stages").read()).toEqual(stage);
  }
  h.post.mockResolvedValue({ ...application, status: "approved", reviewReason: "Approved" });
  await saveProduction(id, "alice", 1, stage, signal());
  expect(productionOutbox(id, "alice", 1, "stages").read()).toBeNull();
});
it("does not allow replacing a pending command or clearing a different request", async () => {
  const outbox = productionOutbox(id, "alice", 1, "games");
  outbox.save(game);
  expect(() => outbox.save({ ...game, clientKey: nextKey })).toThrow();
  expect(() => outbox.clear(nextKey)).toThrow();
  expect(productionOutbox(id, "bob", 1, "games").read()).toBeNull();
  expect(productionOutbox(nextKey, "alice", 1, "games").read()).toBeNull();
  expect(productionOutbox(id, "alice", 1, "stages").read()).toBeNull();
  expect(() => productionOutbox(id, "alice", 1, "stages").save(game)).toThrow();
});
it("rejects invalid target stages, blank or oversized reasons and invalid versions", () => {
  expect(productionCommand.safeParse({ ...stage, stage: "testing" }).success).toBe(false);
  expect(productionCommand.safeParse({ ...stage, reason: " " }).success).toBe(false);
  expect(productionCommand.safeParse({ ...stage, reason: "x".repeat(1001) }).success).toBe(false);
  expect(productionCommand.safeParse({ ...game, expectedVersion: -1 }).success).toBe(false);
});
it("guards requests and receipt storage against cancellation and changed accounts", async () => {
  const c = new AbortController();
  c.abort();
  await expect(saveProduction(id, "alice", 1, game, c.signal)).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return { code: 200, gameId, version: 4, active: true };
  });
  await expect(saveProduction(id, "alice", 1, game, signal())).rejects.toThrow();
  h.generation = 1;
  expect(productionOutbox(id, "alice", 1, "games").read()).toEqual(game);
});
