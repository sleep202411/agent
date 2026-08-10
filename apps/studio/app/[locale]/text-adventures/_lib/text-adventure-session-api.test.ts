import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import {
  getPlayingTextAdventureSession,
  loadOrStartTextAdventureSession,
  sendTextAdventureAction,
  startTextAdventureSession,
} from "./text-adventure-session-api";

vi.mock("@/lib/api", () => ({
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

describe("creator text-adventure playtest session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a session only when no playing session exists", async () => {
    vi.mocked(api.get).mockResolvedValue(null);
    vi.mocked(api.post).mockResolvedValue(session);

    await expect(loadOrStartTextAdventureSession(session.gameId)).resolves.toEqual(session);
    expect(api.post).toHaveBeenCalledOnce();
  });

  it("resumes an existing session without starting another", async () => {
    vi.mocked(api.get).mockResolvedValue({ ...session, resumed: true });

    await expect(loadOrStartTextAdventureSession(session.gameId)).resolves.toMatchObject({
      resumed: true,
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it("rejects mismatched resume and start flags", async () => {
    vi.mocked(api.get).mockResolvedValue(session);
    await expect(getPlayingTextAdventureSession(session.gameId)).rejects.toThrow("resumed=false");

    vi.mocked(api.post).mockResolvedValue({ ...session, resumed: true });
    await expect(startTextAdventureSession(session.gameId)).rejects.toThrow("resumed=true");
  });

  it("trims actions and validates the returned session", async () => {
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

    await expect(sendTextAdventureAction(session.sessionId, "  Open the door  ")).resolves.toEqual(
      response
    );
    expect(api.post).toHaveBeenCalledWith(
      `/api/player/text-game/sessions/${session.sessionId}/chat`,
      { data: { message: "Open the door" }, timeout: 120_000 }
    );

    vi.mocked(api.post).mockResolvedValue({
      ...response,
      sessionId: "ts_fedcba9876543210",
    });
    await expect(sendTextAdventureAction(session.sessionId, "Again")).rejects.toThrow("while");
  });
});
