import { afterEach, describe, expect, it, vi } from "vitest";
import { TEXT_GAME_STREAM_TIMEOUT_MS } from "@repo/shared/text-game";
import { readTextGameSse } from "./text-adventure-sse";

vi.mock("@/lib/api", () => ({
  ApiRequestError: class extends Error {
    constructor(
      public code: string | number,
      message: string,
      public status: number,
      public raw?: string
    ) {
      super(message);
    }
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function responseStream(contentType = "text/event-stream", data?: string, close = false) {
  let signal: AbortSignal;
  let source: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      source = controller;
    },
    cancel,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init: RequestInit) => {
      signal = init.signal!;
      signal.addEventListener("abort", () => {
        try {
          source.error(new DOMException("Aborted", "AbortError"));
        } catch {}
      });
      if (data) source.enqueue(new TextEncoder().encode(data));
      if (close) source.close();
      return new Response(stream, { headers: { "content-type": contentType } });
    })
  );
  return {
    stream,
    cancel,
    get signal() {
      return signal;
    },
    finish() {
      try {
        source.close();
      } catch {}
    },
  };
}

describe("text adventure stream lifecycle", () => {
  it("does not invalidate the replacement account from a departed request's late error body", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    let resolve!: (body: string) => void;
    const text = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        headers: new Headers({ "content-type": "application/json" }),
        status: 401,
        text,
      }))
    );
    const owner = new AbortController();
    const pending = expect(
      readTextGameSse("/test", {}, vi.fn(), owner.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(text).toHaveBeenCalledOnce());
    owner.abort();
    resolve('{"code":401,"msg":"Session expired"}');
    await pending;
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  for (const contentType of ["text/event-stream", "application/json"]) {
    it(`times out a stalled ${contentType} body after headers`, async () => {
      vi.useFakeTimers();
      const response = responseStream(contentType);
      let error: unknown;
      const pending = readTextGameSse("/test", {}, vi.fn()).catch((value) => {
        error = value;
      });
      try {
        await vi.advanceTimersByTimeAsync(TEXT_GAME_STREAM_TIMEOUT_MS);
        expect(response.signal.aborted).toBe(true);
        await pending;
        expect(error).toMatchObject({ code: "NETWORK_ERROR", message: "Request timed out" });
      } finally {
        response.finish();
        await pending;
      }
    });
  }
  it("times out before headers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_path: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            );
          })
      )
    );
    const pending = expect(readTextGameSse("/test", {}, vi.fn())).rejects.toThrow(
      "Request timed out"
    );
    await vi.advanceTimersByTimeAsync(TEXT_GAME_STREAM_TIMEOUT_MS);
    await pending;
  });
  it("delivers frames and releases the reader on completion", async () => {
    vi.useFakeTimers();
    const response = responseStream(undefined, 'event: delta\ndata: {"text":"hello"}\n\n', true);
    const onFrame = vi.fn();
    await readTextGameSse("/test", {}, onFrame);
    expect(onFrame).toHaveBeenCalledWith({ event: "delta", data: { text: "hello" } });
    expect(response.stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves stream errors and cancels unread data", async () => {
    const response = responseStream(
      undefined,
      'event: error\ndata: {"message":"Provider unavailable"}\n\n'
    );
    await expect(readTextGameSse("/test", {}, vi.fn())).rejects.toMatchObject({
      code: "STREAM_ERROR",
      message: "Provider unavailable",
    });
    expect(response.stream.locked).toBe(false);
    expect(response.cancel).toHaveBeenCalledOnce();
  });
  it("preserves callback errors and cancels unread data", async () => {
    const response = responseStream(undefined, "event: delta\ndata: {}\n\n");
    const failure = new Error("consumer failed");
    await expect(
      readTextGameSse("/test", {}, () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(response.stream.locked).toBe(false);
    expect(response.cancel).toHaveBeenCalledOnce();
  });
});
