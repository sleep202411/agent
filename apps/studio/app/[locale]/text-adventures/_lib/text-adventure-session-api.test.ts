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
  ApiRequestError: class ApiRequestError extends Error {
    code: string | number;
    status: number;
    constructor(code: string | number, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

const session = {
  sessionId: "ts_0123456789abcdef",
  gameId: "tg_0123456789abcdef",
  resumed: false,
  bgmUrl: null,
  stillUrls: [] as string[],
  messages: [] as { id: string; role: string; content: string; createdAt: string }[],
  startedAt: "2026-08-09T12:00:00Z",
};

function sseResponse(frames: string): Response {
  return new Response(frames, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("creator text-adventure playtest session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("starts a session only when no playing session exists", async () => {
    vi.mocked(api.get).mockResolvedValue(null);
    vi.mocked(fetch).mockResolvedValue(
      sseResponse(
        [
          `event: meta\ndata: ${JSON.stringify({
            sessionId: session.sessionId,
            gameId: session.gameId,
            resumed: false,
            bgmUrl: null,
            stillUrls: [],
            startedAt: session.startedAt,
          })}\n\n`,
          `event: done\ndata: ${JSON.stringify({
            sessionId: session.sessionId,
            messageId: "12",
            content: "Hello",
          })}\n\n`,
        ].join("")
      )
    );

    await expect(loadOrStartTextAdventureSession(session.gameId, "en-US")).resolves.toMatchObject({
      sessionId: session.sessionId,
      resumed: false,
    });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      `/api/player/text-game/${session.gameId}/start/stream`
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it("resumes an existing session without starting another", async () => {
    vi.mocked(api.get).mockResolvedValue({ ...session, resumed: true });

    await expect(loadOrStartTextAdventureSession(session.gameId, "en-US")).resolves.toMatchObject({
      resumed: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects mismatched resume and start flags", async () => {
    vi.mocked(api.get).mockResolvedValue(session);
    await expect(getPlayingTextAdventureSession(session.gameId)).rejects.toThrow("resumed=false");

    vi.mocked(fetch).mockResolvedValue(
      sseResponse(
        `event: meta\ndata: ${JSON.stringify({
          sessionId: session.sessionId,
          gameId: session.gameId,
          resumed: true,
          bgmUrl: null,
          stillUrls: [],
          startedAt: session.startedAt,
        })}\n\n`
      )
    );
    await expect(startTextAdventureSession(session.gameId, "en-US")).rejects.toThrow(
      "resumed=true"
    );
  });

  it("trims actions and streams the returned session", async () => {
    const userMessage = {
      id: "1",
      role: "user",
      content: "Open the door",
      createdAt: session.startedAt,
    };
    vi.mocked(fetch).mockResolvedValue(
      sseResponse(
        [
          `event: meta\ndata: ${JSON.stringify({
            sessionId: session.sessionId,
            userMessage,
          })}\n\n`,
          `event: done\ndata: ${JSON.stringify({
            sessionId: session.sessionId,
            messageId: "2",
            content: "The door opens.",
          })}\n\n`,
        ].join("")
      )
    );

    await expect(
      sendTextAdventureAction(session.sessionId, "  Open the door  ", "zh-HK")
    ).resolves.toMatchObject({
      sessionId: session.sessionId,
      userMessage,
      assistantMessage: { id: "2", content: "The door opens." },
    });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      `/api/player/text-game/sessions/${session.sessionId}/chat/stream`
    );
  });
});

it("does not start a session after an abandoned lookup resolves", async () => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  const controller = new AbortController();
  let resolve!: (value: null) => void;
  vi.mocked(api.get).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const pending = loadOrStartTextAdventureSession(
    session.gameId,
    "en-US",
    undefined,
    controller.signal
  );
  controller.abort();
  resolve(null);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});
