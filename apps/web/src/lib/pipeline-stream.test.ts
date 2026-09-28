import { afterEach, expect, it, vi } from "vitest";
import { pipelineStream } from "./pipeline-stream";
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const reader = {
    read: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    releaseLock: vi.fn(),
  };
  const body = { getReader: vi.fn(() => reader), cancel: vi.fn().mockResolvedValue(undefined) };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body }));
  const handlers = { onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
  return { reader, body, handlers };
}
const event = { done: false, value: new TextEncoder().encode('data: {"type":"done"}\n') };
it("cancels an unread HTTP failure body before reporting the error", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), { status: 503 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const onError = vi.fn();
  pipelineStream("/pipeline", {}, { onError });
  await vi.waitFor(() =>
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "HTTP 503" }))
  );
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(response.body?.locked).toBe(false);
});

it("preserves the HTTP error if cancelling its body fails", async () => {
  const cancel = vi.fn().mockRejectedValue(new Error("cleanup failed"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, body: { cancel } }));
  const onError = vi.fn();
  pipelineStream("/pipeline", {}, { onError });
  await vi.waitFor(() =>
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "HTTP 502" }))
  );
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("releases the reader after normal completion", async () => {
  const { reader, handlers } = fixture();
  reader.read.mockResolvedValueOnce(event).mockResolvedValue({ done: true });
  pipelineStream("/pipeline", {}, handlers);
  await vi.waitFor(() => expect(handlers.onDone).toHaveBeenCalledWith(true));
  expect(reader.releaseLock).toHaveBeenCalledTimes(1);
});
it("does not misclassify an event-handler failure as malformed JSON", async () => {
  const { reader, handlers } = fixture();
  const failure = new Error("consumer failed");
  handlers.onEvent.mockImplementation(() => {
    throw failure;
  });
  reader.read.mockResolvedValueOnce(event).mockResolvedValue({ done: true });
  pipelineStream("/pipeline", {}, handlers);
  await vi.waitFor(() => expect(handlers.onError).toHaveBeenCalledWith(failure));
  expect(handlers.onEvent).toHaveBeenCalledTimes(1);
  expect(handlers.onDone).not.toHaveBeenCalled();
  expect(reader.cancel).toHaveBeenCalledTimes(1);
  expect(reader.releaseLock).toHaveBeenCalledTimes(1);
});
it("suppresses a delayed chunk after cancellation", async () => {
  const { reader, handlers } = fixture();
  let finish!: (value: typeof event) => void;
  reader.read
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue({ done: true });
  const cancel = pipelineStream("/pipeline", {}, handlers);
  await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1));
  cancel();
  finish(event);
  await vi.waitFor(() =>
    expect(reader.read.mock.calls.length + reader.releaseLock.mock.calls.length).toBeGreaterThan(1)
  );
  expect(handlers.onEvent).not.toHaveBeenCalled();
  expect(handlers.onDone).not.toHaveBeenCalled();
  expect(handlers.onError).not.toHaveBeenCalled();
});
it("suppresses non-AbortError transport failures after cancellation", async () => {
  const { reader, handlers } = fixture();
  let fail!: (error: Error) => void;
  reader.read.mockReturnValue(
    new Promise((_, reject) => {
      fail = reject;
    })
  );
  const cancel = pipelineStream("/pipeline", {}, handlers);
  await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1));
  cancel();
  fail(new Error("transport closed"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(handlers.onError).not.toHaveBeenCalled();
});
it("retains partial events for malformed payloads and reports incomplete closure", async () => {
  const { reader, handlers } = fixture();
  reader.read
    .mockResolvedValueOnce({
      done: false,
      value: new TextEncoder().encode("data: not-json\ndata: null\n"),
    })
    .mockResolvedValue({ done: true });
  pipelineStream("/pipeline", {}, handlers);
  await vi.waitFor(() => expect(handlers.onDone).toHaveBeenCalledWith(false));
  expect(handlers.onEvent.mock.calls).toEqual([
    [{ type: "partial", content: "not-json" }],
    [{ type: "partial", content: "null" }],
  ]);
});
it("discards an abandoned response before acquiring its reader", async () => {
  const { reader, body, handlers } = fixture();
  let finish!: (value: unknown) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
  );
  const cancel = pipelineStream("/pipeline", {}, handlers);
  cancel();
  finish({ ok: true, body });
  await vi.waitFor(() => expect(body.cancel).toHaveBeenCalledTimes(1));
  expect(reader.read).not.toHaveBeenCalled();
  expect(handlers.onDone).not.toHaveBeenCalled();
});
