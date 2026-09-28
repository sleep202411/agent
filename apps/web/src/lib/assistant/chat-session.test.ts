import { afterEach, expect, it, vi } from "vitest";
import type { ChatEventsClientHandlers } from "./chat-events-client";
import type { AssistantMessage } from "./assistant-types";
const mocks = vi.hoisted(() => ({ read: vi.fn(), handlers: [] as ChatEventsClientHandlers[] }));
vi.mock("./assistant-client", () => ({ fetchMessagesByIds: mocks.read }));
vi.mock("./chat-events-client", () => ({
  openChatEventsClient: (_id: string, handlers: ChatEventsClientHandlers) => {
    mocks.handlers.push(handlers);
    return { close: vi.fn(), isOpen: true };
  },
}));
import { ensureSession, closeSession, closeAllSessions } from "./chat-session";
const message = { id: "m", role: "assistant", parts: [] } as AssistantMessage;
afterEach(() => {
  closeAllSessions();
  mocks.handlers.length = 0;
  vi.resetAllMocks();
});
it("discards delayed reads after closing a session", async () => {
  let resolve!: (value: AssistantMessage[]) => void;
  mocks.read.mockReturnValue(
    new Promise<AssistantMessage[]>((r) => {
      resolve = r;
    })
  );
  const onMessage = vi.fn();
  ensureSession("p", { onMessage });
  mocks.handlers[0]!.onMessageList?.(["m"]);
  closeSession("p");
  resolve([message]);
  await vi.waitFor(() => expect(mocks.read).toHaveBeenCalled());
  expect(onMessage).not.toHaveBeenCalled();
});
it("discards delayed errors after closing a session", async () => {
  let reject!: (error: Error) => void;
  mocks.read.mockReturnValue(
    new Promise((_, r) => {
      reject = r;
    })
  );
  const onError = vi.fn();
  ensureSession("p", { onMessage: vi.fn(), onError });
  mocks.handlers[0]!.onMessageList?.(["m"]);
  closeSession("p");
  reject(new Error("offline"));
  await vi.waitFor(() => expect(mocks.read).toHaveBeenCalled());
  expect(onError).not.toHaveBeenCalled();
});
it("waits for the running read before reporting idle", async () => {
  let resolve!: (value: AssistantMessage[]) => void;
  mocks.read.mockReturnValue(
    new Promise<AssistantMessage[]>((r) => {
      resolve = r;
    })
  );
  const order: string[] = [];
  ensureSession("p", {
    onMessage: () => order.push("message"),
    onAgentState: () => order.push("idle"),
  });
  mocks.handlers[0]!.onMessageList?.(["m"]);
  mocks.handlers[0]!.onAgentState?.("idle");
  await Promise.resolve();
  await Promise.resolve();
  expect(order).toEqual([]);
  resolve([message]);
  await vi.waitFor(() => expect(order).toEqual(["message", "idle"]));
});
it("aborts the old read and preserves a replacement session", async () => {
  let resolve!: (value: AssistantMessage[]) => void;
  mocks.read
    .mockReturnValueOnce(
      new Promise<AssistantMessage[]>((r) => {
        resolve = r;
      })
    )
    .mockResolvedValueOnce([message]);
  const oldHandler = vi.fn();
  const replacement = vi.fn();
  ensureSession("p", { onMessage: oldHandler });
  mocks.handlers[0]!.onMessageList?.(["old"]);
  const signal = mocks.read.mock.calls[0]![2] as AbortSignal;
  closeSession("p");
  expect(signal.aborted).toBe(true);
  ensureSession("p", { onMessage: replacement });
  mocks.handlers[1]!.onMessageList?.(["new"]);
  resolve([message]);
  await vi.waitFor(() => expect(replacement).toHaveBeenCalledTimes(1));
  expect(oldHandler).not.toHaveBeenCalled();
});
it("continues queued reads and drops superseded idle notifications", async () => {
  let resolve!: (value: AssistantMessage[]) => void;
  mocks.read
    .mockReturnValueOnce(
      new Promise<AssistantMessage[]>((r) => {
        resolve = r;
      })
    )
    .mockResolvedValueOnce([message]);
  const state = vi.fn();
  const onMessage = vi.fn();
  ensureSession("p", { onMessage, onAgentState: state });
  mocks.handlers[0]!.onMessageList?.(["first"]);
  mocks.handlers[0]!.onAgentState?.("idle");
  mocks.handlers[0]!.onMessageList?.(["second"]);
  mocks.handlers[0]!.onAgentState?.("thinking");
  resolve([message]);
  await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(2));
  expect(state.mock.calls).toEqual([["thinking"]]);
});
it("does not report a superseded idle transition twice after another turn", async () => {
  let resolve!: (value: AssistantMessage[]) => void;
  mocks.read.mockReturnValue(
    new Promise<AssistantMessage[]>((r) => {
      resolve = r;
    })
  );
  const state = vi.fn();
  ensureSession("p", { onMessage: vi.fn(), onAgentState: state });
  const handlers = mocks.handlers[0]!;
  handlers.onMessageList?.(["m"]);
  handlers.onAgentState?.("idle");
  handlers.onAgentState?.("thinking");
  handlers.onAgentState?.("idle");
  resolve([message]);
  await vi.waitFor(() => expect(state.mock.calls.some(([value]) => value === "idle")).toBe(true));
  expect(state.mock.calls).toEqual([["thinking"], ["idle"]]);
});
it("keeps newer inline content while delivering other fetched messages", async () => {
  let resolve!: (value: AssistantMessage[]) => void;
  mocks.read.mockReturnValue(
    new Promise<AssistantMessage[]>((r) => {
      resolve = r;
    })
  );
  const received: AssistantMessage[] = [];
  ensureSession("p", { onMessage: (value) => received.push(value) });
  const handlers = mocks.handlers[0]!;
  handlers.onMessageList?.(["m", "other"]);
  const updated = {
    ...message,
    parts: [{ type: "text", text: "new", state: "done" }],
  } as AssistantMessage;
  handlers.onMessageChanged?.(
    "m",
    updated as unknown as Parameters<NonNullable<ChatEventsClientHandlers["onMessageChanged"]>>[1]
  );
  const other = { ...message, id: "other" };
  resolve([message, other]);
  await vi.waitFor(() => expect(received.some((value) => value.id === "other")).toBe(true));
  expect(received).toEqual([updated, other]);
});
