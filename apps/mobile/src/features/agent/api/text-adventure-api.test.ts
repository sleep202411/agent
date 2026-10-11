import { beforeEach, expect, it, vi } from "vitest";
import {
  listTextAdventures,
  getTextAdventure,
  createTextAdventure,
  updateTextAdventure,
  transitionTextAdventure,
} from "./text-adventure-api";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const session = { userId: "1234567890123456789", generation: 1 };
const signal = () => new AbortController().signal;
const GAME_ID = "tg_0123456789abcdef";

function detail(status: "draft" | "reviewing" | "published" | "offline" = "draft") {
  return {
    gameId: GAME_ID,
    projectId: null,
    status,
    rejectReason: null,
    draftVersionId: "1",
    publishedVersionId: status === "published" ? "1" : null,
    publishedAt: status === "published" ? "2026-08-09T12:00:00Z" : null,
    offlineAt: status === "offline" ? "2026-08-09T12:00:00Z" : null,
    createdAt: "2026-08-09T12:00:00Z",
    updatedAt: "2026-08-09T12:00:00Z",
    content: {
      versionId: "1",
      versionNo: 1,
      name: "World",
      posterUrl: "https://cdn.example.com/poster.jpg",
      synopsis: "Synopsis",
      worldviewDocxUrl: "https://cdn.example.com/world.docx",
      bgmUrl: null,
      characters: [],
      stillUrls: [],
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(detail());
  h.post.mockResolvedValue(detail());
  h.put.mockResolvedValue(detail());
});
it("loads creator drafts and preserves large creator IDs without numeric coercion", async () => {
  h.get.mockResolvedValue([{ ...detail(), creatorId: session.userId }]);
  const rows = await listTextAdventures(session, signal());
  expect(rows[0]?.creatorId).toBe(session.userId);
  expect(h.get).toHaveBeenCalledWith(
    "/api/user/text-game",
    expect.objectContaining({ service: "studio", retry: false })
  );
});
it("rejects duplicate list rows and foreign creator data", async () => {
  h.get.mockResolvedValue([detail(), detail()]);
  await expect(listTextAdventures(session, signal())).rejects.toThrow("Duplicate");
  h.get.mockResolvedValue([{ ...detail(), creatorId: "2" }]);
  await expect(listTextAdventures(session, signal())).rejects.toThrow("creator");
});
it("rejects wrong game identity and malformed IDs", async () => {
  h.get.mockResolvedValue({ ...detail(), gameId: "tg_fedcba9876543210" });
  await expect(getTextAdventure(GAME_ID, session, signal())).rejects.toThrow("identity");
  h.get.mockClear();
  await expect(getTextAdventure("../game", session, signal())).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
it("creates a draft through the Studio service with document analysis timeout", async () => {
  await expect(
    createTextAdventure(
      { worldviewDocxUrl: "https://cdn.example.com/world.docx" },
      session,
      signal()
    )
  ).resolves.toMatchObject({ status: "draft" });
  expect(h.post).toHaveBeenCalledWith(
    "/api/user/text-game",
    expect.objectContaining({ service: "studio", timeout: 180000, retry: false })
  );
});
it("rejects an unexpected creation state or creator", async () => {
  h.post.mockResolvedValue(detail("published"));
  await expect(
    createTextAdventure(
      { worldviewDocxUrl: "https://cdn.example.com/world.docx" },
      session,
      signal()
    )
  ).rejects.toThrow("draft");
  h.post.mockResolvedValue({ ...detail(), creatorId: "9" });
  await expect(
    createTextAdventure(
      { worldviewDocxUrl: "https://cdn.example.com/world.docx" },
      session,
      signal()
    )
  ).rejects.toThrow("creator");
});
it("uses official update payload and preserves explicit media clearing", async () => {
  await updateTextAdventure(
    GAME_ID,
    { bgmUrl: "", stillUrls: [], name: "Renamed" },
    session,
    signal()
  );
  expect(h.put).toHaveBeenLastCalledWith(
    `/api/user/text-game/${GAME_ID}`,
    expect.objectContaining({
      data: { bgmUrl: "", stillUrls: [], name: "Renamed" },
      timeout: 45000,
    })
  );
  await updateTextAdventure(
    GAME_ID,
    { worldviewDocxUrl: "https://cdn.example.com/new.docx" },
    session,
    signal()
  );
  expect(h.put.mock.calls.at(-1)?.[1].timeout).toBe(180000);
});
it("rechecks current status and does not write a reviewing draft", async () => {
  h.get.mockResolvedValue(detail("reviewing"));
  await expect(updateTextAdventure(GAME_ID, { name: "Rename" }, session, signal())).rejects.toThrow(
    "under review"
  );
  expect(h.put).not.toHaveBeenCalled();
});
it.each(["submit", "offline"] as const)(
  "validates %s action and authoritative resulting status",
  async (action) => {
    h.get.mockResolvedValue(detail(action === "submit" ? "draft" : "published"));
    h.post.mockResolvedValue(detail(action === "submit" ? "reviewing" : "offline"));
    await transitionTextAdventure(GAME_ID, action, session, signal());
    expect(h.post).toHaveBeenCalledWith(
      `/api/user/text-game/${GAME_ID}/status`,
      expect.objectContaining({ data: { action }, retry: false })
    );
    h.post.mockResolvedValue(detail());
    await expect(transitionTextAdventure(GAME_ID, action, session, signal())).rejects.toThrow(
      "expected"
    );
  }
);
it("does not issue invalid transitions or malformed inputs", async () => {
  await expect(transitionTextAdventure(GAME_ID, "offline", session, signal())).rejects.toThrow(
    "not available"
  );
  expect(h.post).not.toHaveBeenCalled();
  await expect(
    createTextAdventure({ worldviewDocxUrl: "invalid" }, session, signal())
  ).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects stale or aborted sessions before writes", async () => {
  h.generation = 2;
  await expect(
    createTextAdventure(
      { worldviewDocxUrl: "https://cdn.example.com/world.docx" },
      session,
      signal()
    )
  ).rejects.toThrow("session");
  expect(h.post).not.toHaveBeenCalled();
  h.generation = 1;
  const c = new AbortController();
  c.abort();
  await expect(getTextAdventure(GAME_ID, session, c.signal)).rejects.toThrow("session");
  expect(h.get).not.toHaveBeenCalled();
});
it("ignores late reads and never mutates after account changes", async () => {
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return detail();
  });
  await expect(
    updateTextAdventure(GAME_ID, { name: "Renamed" }, session, signal())
  ).rejects.toThrow("session");
  expect(h.put).not.toHaveBeenCalled();
});
it("rejects late write receipts and does not retry unknown writes", async () => {
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return detail();
  });
  await expect(
    createTextAdventure(
      { worldviewDocxUrl: "https://cdn.example.com/world.docx" },
      session,
      signal()
    )
  ).rejects.toThrow("session");
  h.generation = 1;
  h.post.mockReset();
  h.post.mockRejectedValue(new Error("Network lost"));
  await expect(
    createTextAdventure(
      { worldviewDocxUrl: "https://cdn.example.com/world.docx" },
      session,
      signal()
    )
  ).rejects.toThrow("Network lost");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("refuses to save against a different server baseline", async () => {
  await expect(
    updateTextAdventure(GAME_ID, { name: "Local" }, session, signal(), {
      draftVersionId: "old",
      updatedAt: "old",
    })
  ).rejects.toThrow("changed on the server");
  expect(h.put).not.toHaveBeenCalled();
});
