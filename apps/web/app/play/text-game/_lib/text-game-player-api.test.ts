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
  ApiRequestError: class ApiRequestError extends Error {
    code: string | number;
    status: number;
    constructor(code: string | number, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  notifyUnauthorized: vi.fn(),
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

describe("text-game player session bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("starts a new session only when Java reports no playing session", async () => {
    vi.mocked(api.get).mockResolvedValue(null);
    vi.mocked(fetch).mockResolvedValue(
      sseResponse(
        [
          'event: ready\ndata: {"ok":true}\n\n',
          `event: meta\ndata: ${JSON.stringify({
            sessionId: session.sessionId,
            gameId: session.gameId,
            resumed: false,
            bgmUrl: null,
            stillUrls: [],
            startedAt: session.startedAt,
          })}\n\n`,
          'event: delta\ndata: {"text":"Hello"}\n\n',
          `event: done\ndata: ${JSON.stringify({
            sessionId: session.sessionId,
            messageId: "12",
            content: "Hello",
          })}\n\n`,
        ].join("")
      )
    );

    const started = await loadOrStartTextGameSession(session.gameId, "en-US");
    expect(started.sessionId).toBe(session.sessionId);
    expect(started.messages).toEqual([
      {
        id: "12",
        role: "assistant",
        content: "Hello",
        createdAt: session.startedAt,
      },
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      `/api/player/text-game/${session.gameId}/start/stream`
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it("resumes an existing session without calling start", async () => {
    vi.mocked(api.get).mockResolvedValue({ ...session, resumed: true });

    await expect(loadOrStartTextGameSession(session.gameId, "en-US")).resolves.toMatchObject({
      sessionId: session.sessionId,
      resumed: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an existing session that Java labels as new", async () => {
    vi.mocked(api.get).mockResolvedValue(session);
    await expect(getPlayingTextGameSession(session.gameId)).rejects.toThrow("resumed=false");
  });

  it("rejects a newly started session that Java labels as resumed", async () => {
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

  it("trims chat input and streams the assistant reply", async () => {
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
          'event: delta\ndata: {"text":"The door"}\n\n',
          `event: done\ndata: ${JSON.stringify({
            sessionId: session.sessionId,
            messageId: "2",
            content: "The door opens.",
          })}\n\n`,
        ].join("")
      )
    );

    await expect(
      sendTextGameAction(session.sessionId, "  Open the door  ", "zh-CN")
    ).resolves.toEqual({
      sessionId: session.sessionId,
      userMessage,
      assistantMessage: {
        id: "2",
        role: "assistant",
        content: "The door opens.",
        createdAt: expect.any(String),
      },
    });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      `/api/player/text-game/sessions/${session.sessionId}/chat/stream`
    );
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      message: "Open the door",
      locale: "zh-CN",
    });
  });
});

it("rejects an opening stream closed after metadata without an assistant completion", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(sseResponse(`event: meta\ndata: ${JSON.stringify(session)}\n\n`))
  );
  await expect(startTextGameSession(session.gameId, "en-US")).rejects.toThrow("without completion");
});

it("does not start a new session when its playing-session lookup was abandoned", async () => {
  const controller = new AbortController();
  let finish!: (value: null) => void;
  vi.mocked(api.get).mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  vi.stubGlobal("fetch", vi.fn());
  const pending = loadOrStartTextGameSession(session.gameId, "en-US", {
    signal: controller.signal,
  });
  const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  finish(null);
  await assertion;
  expect(fetch).not.toHaveBeenCalled();
});
