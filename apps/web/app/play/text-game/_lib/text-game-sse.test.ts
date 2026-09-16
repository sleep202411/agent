import { afterEach, expect, it, vi } from "vitest";
import { TEXT_GAME_STREAM_TIMEOUT_MS } from "@repo/shared/text-game";
import { readTextGameSse } from "./text-game-sse";

vi.mock("@/src/lib/api", () => ({
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
  notifyUnauthorized: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function response(type: string, frames?: string) {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      if (frames) c.enqueue(new TextEncoder().encode(frames));
    },
    cancel,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(stream, { headers: { "Content-Type": type } })))
  );
  return { stream, cancel };
}
it.each(["text/event-stream", "application/json"])(
  "keeps the deadline during stalled %s body reads",
  async (type) => {
    vi.useFakeTimers();
    const r = response(type);
    const pending = readTextGameSse("/stream", {}, vi.fn());
    const assertion = expect(pending).rejects.toThrow("Request timed out");
    await vi.advanceTimersByTimeAsync(TEXT_GAME_STREAM_TIMEOUT_MS);
    await assertion;
    expect(r.cancel).toHaveBeenCalledTimes(1);
    expect(r.stream.locked).toBe(false);
  }
);
it("cancels active consumption and rejects pre-cancelled dispatch", async () => {
  const r = response("text/event-stream");
  const controller = new AbortController();
  const pending = readTextGameSse("/stream", {}, vi.fn(), controller.signal);
  const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  controller.abort();
  await assertion;
  expect(r.stream.locked).toBe(false);
  await expect(readTextGameSse("/stream", {}, vi.fn(), controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("releases a failed consumer and stops after the terminal frame without awaiting HTTP close", async () => {
  const failed = response("text/event-stream", "event: meta\ndata: {}\n\n");
  await expect(
    readTextGameSse("/stream", {}, () => {
      throw new Error("invalid meta");
    })
  ).rejects.toThrow("invalid meta");
  expect(failed.cancel).toHaveBeenCalledTimes(1);
  expect(failed.stream.locked).toBe(false);
  const done = response(
    "text/event-stream",
    'event: done\ndata: {}\n\nevent: delta\ndata: {"text":"late"}\n\n'
  );
  const receive = vi.fn();
  await readTextGameSse("/stream", {}, receive);
  expect(receive).toHaveBeenCalledTimes(1);
  expect(done.cancel).toHaveBeenCalledTimes(1);
});
