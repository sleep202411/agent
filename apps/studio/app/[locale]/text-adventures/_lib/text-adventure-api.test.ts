import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import {
  createCreatorTextAdventure,
  getCreatorTextAdventure,
  listCreatorTextAdventures,
  transitionCreatorTextAdventure,
  updateCreatorTextAdventure,
} from "./text-adventure-api";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

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

describe("creator text-adventure API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads and validates the creator catalogue", async () => {
    vi.mocked(api.get).mockResolvedValue([
      {
        gameId: GAME_ID,
        name: "World",
        posterUrl: null,
        synopsis: null,
        status: "draft",
        updatedAt: "2026-08-09T12:00:00Z",
      },
    ]);
    await expect(listCreatorTextAdventures()).resolves.toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith("/api/user/text-game");
  });

  it("rejects a detail response for a different work", async () => {
    vi.mocked(api.get).mockResolvedValue({ ...detail(), gameId: "tg_fedcba9876543210" });
    await expect(getCreatorTextAdventure(GAME_ID)).rejects.toThrow("while");
  });

  it("creates a draft with the long document-analysis timeout", async () => {
    vi.mocked(api.post).mockResolvedValue(detail());
    await expect(
      createCreatorTextAdventure({ worldviewDocxUrl: "https://cdn.example.com/world.docx" })
    ).resolves.toMatchObject({ gameId: GAME_ID, status: "draft" });
    expect(api.post).toHaveBeenCalledWith("/api/user/text-game", {
      data: { worldviewDocxUrl: "https://cdn.example.com/world.docx" },
      timeout: 180_000,
    });
  });

  it("uses the long timeout only when replacing the worldview document", async () => {
    vi.mocked(api.put).mockResolvedValue(detail());
    await updateCreatorTextAdventure(GAME_ID, { name: "Renamed" });
    expect(api.put).toHaveBeenLastCalledWith(`/api/user/text-game/${GAME_ID}`, {
      data: { name: "Renamed" },
      timeout: 45_000,
    });

    await updateCreatorTextAdventure(GAME_ID, {
      worldviewDocxUrl: "https://cdn.example.com/replacement.docx",
    });
    expect(api.put).toHaveBeenLastCalledWith(`/api/user/text-game/${GAME_ID}`, {
      data: { worldviewDocxUrl: "https://cdn.example.com/replacement.docx" },
      timeout: 180_000,
    });
  });

  it("validates the status returned after creator transitions", async () => {
    vi.mocked(api.post).mockResolvedValue(detail("reviewing"));
    await expect(transitionCreatorTextAdventure(GAME_ID, "submit")).resolves.toMatchObject({
      status: "reviewing",
    });

    vi.mocked(api.post).mockResolvedValue(detail("published"));
    await expect(transitionCreatorTextAdventure(GAME_ID, "offline")).rejects.toThrow(
      "expected offline"
    );
  });
});
