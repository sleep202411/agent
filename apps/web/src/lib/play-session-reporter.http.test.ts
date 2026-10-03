import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the API client module BEFORE importing the reporter.
vi.mock("@/src/lib/api/api-client", () => ({
  api: {
    post: vi.fn(),
  },
}));

import { api } from "@/src/lib/api/api-client";
import { createHttpPlaySessionReporter } from "./play-session-reporter.http";

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

describe("createHttpPlaySessionReporter", () => {
  beforeEach(() => {
    mockedPost.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("onStart sends the correct payload shape", async () => {
    mockedPost.mockResolvedValueOnce({ sessionId: "ps_abc" });
    const reporter = createHttpPlaySessionReporter();

    await reporter.onStart({
      gameId: "g1",
      contentVersion: "v1",
      buildId: "b1",
      locale: "zh-CN",
      experienceType: "film",
    });

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [path, options] = mockedPost.mock.calls[0];
    expect(path).toBe("/api/player/play/sessions/start");
    expect(options.data).toMatchObject({
      gameId: "g1",
      contentVersion: "v1",
      buildId: "b1",
      locale: "zh-CN",
      experienceType: "film",
    });
  });

  it("onStart returns sessionId on success", async () => {
    mockedPost.mockResolvedValueOnce({ sessionId: "ps_abc" });
    const reporter = createHttpPlaySessionReporter();

    const result = await reporter.onStart({ gameId: "g1" });

    expect(result).toEqual({ sessionId: "ps_abc" });
  });

  it("onStart returns null on failure without throwing", async () => {
    mockedPost.mockRejectedValueOnce(new Error("network down"));
    const reporter = createHttpPlaySessionReporter();

    const result = await reporter.onStart({ gameId: "g1" });

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("onStart attaches Authorization header when a token is provided", async () => {
    mockedPost.mockResolvedValueOnce({ sessionId: "ps_abc" });
    const reporter = createHttpPlaySessionReporter({
      getAccessToken: async () => "tok_123",
    });

    await reporter.onStart({ gameId: "g1" });

    const [, options] = mockedPost.mock.calls[0];
    expect(options.headers).toMatchObject({ Authorization: "Bearer tok_123" });
  });

  it("onStart omits Authorization when the token is null", async () => {
    mockedPost.mockResolvedValueOnce({ sessionId: "ps_abc" });
    const reporter = createHttpPlaySessionReporter({
      getAccessToken: async () => null,
    });

    await reporter.onStart({ gameId: "g1" });

    const [, options] = mockedPost.mock.calls[0];
    expect(options.headers?.Authorization).toBeUndefined();
  });

  it("onProgress sends sessionId in the body", async () => {
    mockedPost.mockResolvedValueOnce({});
    const reporter = createHttpPlaySessionReporter();

    await reporter.onProgress("ps_abc", { currentNode: "clip:scene-2" });

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [path, options] = mockedPost.mock.calls[0];
    expect(path).toBe("/api/player/play/sessions/progress");
    expect(options.data).toMatchObject({
      sessionId: "ps_abc",
      currentNode: "clip:scene-2",
    });
  });

  it("onProgress is a no-op when sessionId is empty", async () => {
    const reporter = createHttpPlaySessionReporter();

    await reporter.onProgress("", { currentNode: "clip:scene-2" });

    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("onComplete sends sessionId and endingId", async () => {
    mockedPost.mockResolvedValueOnce({});
    const reporter = createHttpPlaySessionReporter();

    await reporter.onComplete("ps_abc", { endingId: "ending:1" });

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [path, options] = mockedPost.mock.calls[0];
    expect(path).toBe("/api/player/play/sessions/complete");
    expect(options.data).toMatchObject({
      sessionId: "ps_abc",
      endingId: "ending:1",
    });
  });

  it("onComplete is a no-op when sessionId is empty", async () => {
    const reporter = createHttpPlaySessionReporter();

    await reporter.onComplete("", { endingId: "ending:1" });

    expect(mockedPost).not.toHaveBeenCalled();
  });
});

it("propagates a failed completion so the player cannot expose an unsaved report", async () => {
  const failure = new Error("completion unavailable");
  mockedPost.mockRejectedValueOnce(failure);
  const reporter = createHttpPlaySessionReporter();
  await expect(reporter.onComplete("session", { endingId: "end" })).rejects.toBe(failure);
});
