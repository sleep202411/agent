import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/src/lib/api";
import {
  getPlayingTextGameSession,
  loadOrStartTextGameSession,
  sendTextGameAction,
  startTextGameSession,
} from "./text-game-player-api";

vi.mock("@/src/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const session = {
  sessionId: "ts_0123456789abcdef",
  gameId: "tg_0123456789abcdef",
  resumed: false,
  bgmUrl: null,
  stillUrls: [],
  messages: [],
  startedAt: "2026-08-09T12:00:00Z",
};

describe("text-game player session bootstrap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a new session only when Java reports no playing session", async () => {
    vi.mocked(api.get).mockResolvedValue(null);
    vi.mocked(api.post).mockResolvedValue(session);

    await expect(loadOrStartTextGameSession(session.gameId, "en-US")).resolves.toEqual(session);
    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post).toHaveBeenCalledWith(`/api/player/text-game/${session.gameId}/start`, {
      data: { locale: "en-US" },
      timeout: 120_000,
    });
  });

  it("resumes an existing session without calling start", async () => {
    vi.mocked(api.get).mockResolvedValue({ ...session, resumed: true });

    await expect(loadOrStartTextGameSession(session.gameId, "en-US")).resolves.toMatchObject({
      sessionId: session.sessionId,
      resumed: true,
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it("rejects an existing session that Java labels as new", async () => {
    vi.mocked(api.get).mockResolvedValue(session);
    await expect(getPlayingTextGameSession(session.gameId)).rejects.toThrow("resumed=false");
  });

  it("rejects a newly started session that Java labels as resumed", async () => {
    vi.mocked(api.post).mockResolvedValue({ ...session, resumed: true });
    await expect(startTextGameSession(session.gameId, "en-US")).rejects.toThrow("resumed=true");
  });

  it("rejects a session belonging to another work", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...session,
      gameId: "tg_fedcba9876543210",
      resumed: true,
    });
    await expect(getPlayingTextGameSession(session.gameId)).rejects.toThrow("while");
  });

  it("trims chat input and validates the returned session identity", async () => {
    const response = {
      sessionId: session.sessionId,
      userMessage: {
        id: "1",
        role: "user",
        content: "Open the door",
        createdAt: session.startedAt,
      },
      assistantMessage: {
        id: "2",
        role: "assistant",
        content: "The door opens.",
        createdAt: session.startedAt,
      },
    };
    vi.mocked(api.post).mockResolvedValue(response);

    await expect(
      sendTextGameAction(session.sessionId, "  Open the door  ", "zh-CN")
    ).resolves.toEqual(response);
    expect(api.post).toHaveBeenCalledWith(
      `/api/player/text-game/sessions/${session.sessionId}/chat`,
      { data: { message: "Open the door", locale: "zh-CN" }, timeout: 120_000 }
    );

    vi.mocked(api.post).mockResolvedValue({
      ...response,
      sessionId: "ts_fedcba9876543210",
    });
    await expect(sendTextGameAction(session.sessionId, "Again", "zh-CN")).rejects.toThrow("while");
  });
});
