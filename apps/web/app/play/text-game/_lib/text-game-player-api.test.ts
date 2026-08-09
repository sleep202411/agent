import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/src/lib/api";
import { loadOrStartTextGameSession, playerTextGameKeys } from "./text-game-player-api";

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

  it("keeps the detail progress probe separate from the active player cache", () => {
    expect(playerTextGameKeys.progress(session.gameId)).not.toEqual(
      playerTextGameKeys.session(session.gameId)
    );
  });

  it("starts a new session only when Java reports no playing session", async () => {
    vi.mocked(api.get).mockResolvedValue(null);
    vi.mocked(api.post).mockResolvedValue(session);

    await expect(loadOrStartTextGameSession(session.gameId)).resolves.toEqual(session);
    expect(api.post).toHaveBeenCalledOnce();
  });

  it("resumes an existing session without calling start", async () => {
    vi.mocked(api.get).mockResolvedValue({ ...session, resumed: true });

    await expect(loadOrStartTextGameSession(session.gameId)).resolves.toMatchObject({
      sessionId: session.sessionId,
      resumed: true,
    });
    expect(api.post).not.toHaveBeenCalled();
  });
});
