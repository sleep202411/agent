import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { refreshMessageHistory, useConversationHistory } from "./use-conversation-history";
import type { NativeMessage } from "./conversation-api";
const h = vi.hoisted(() => ({ detail: vi.fn(), messages: vi.fn() }));
vi.mock("./conversation-api", () => ({
  fetchConversation: h.detail,
  fetchConversationMessages: h.messages,
}));
const msg = (id: string, body = id) => ({ id, body }) as NativeMessage;
it("retains contiguous history, replaces fresh rows and does not fabricate gaps", () => {
  const previous = { items: [msg("3", "old"), msg("2"), msg("1")], nextCursor: "1" };
  expect(
    refreshMessageHistory(previous, { items: [msg("4"), msg("3", "new")], nextCursor: "3" })
  ).toEqual({ items: [msg("4"), msg("3", "new"), msg("2"), msg("1")], nextCursor: "1" });
  const gap = { items: [msg("8"), msg("7")], nextCursor: "7" };
  expect(refreshMessageHistory(previous, gap)).toBe(gap);
  const complete = { items: [msg("4")], nextCursor: null };
  expect(refreshMessageHistory(previous, complete)).toBe(complete);
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({
  id = "chat",
  generation = 1,
  active = true,
}: {
  id?: string;
  generation?: number;
  active?: boolean;
}) {
  const state = useConversationHistory(id, "viewer", generation, active);
  return (
    <div>
      {state.messages.map((m) => (
        <span key={m.id}>{m.body},</span>
      ))}
      {state.error}
      <button onClick={state.loadOlder}>older</button>
      <button onClick={state.refresh}>refresh</button>
      <button onClick={state.retry}>retry</button>
    </div>
  );
}
const render = (id = "chat", generation = 1, active = true) =>
  act(async () => root.render(<Probe id={id} generation={generation} active={active} />));
const click = (index: number) => act(async () => host.querySelectorAll("button")[index]!.click());
beforeEach(() => {
  vi.resetAllMocks();
  h.detail.mockResolvedValue({ id: "chat" });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("loads older pages in chronological order, deduplicates and stops at the end", async () => {
  h.messages
    .mockResolvedValueOnce({ items: [msg("3"), msg("2")], nextCursor: "2" })
    .mockResolvedValueOnce({ items: [msg("2"), msg("1")], nextCursor: null });
  await render();
  await click(0);
  expect(host.textContent).toContain("1,2,3,");
  expect(h.messages.mock.calls[1][1]).toBe("2");
  await click(0);
  expect(h.messages).toHaveBeenCalledTimes(2);
});
it("keeps a failed page retryable and stops repeated cursors", async () => {
  h.messages
    .mockResolvedValueOnce({ items: [msg("2")], nextCursor: "2" })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ items: [msg("1")], nextCursor: "2" });
  await render();
  await click(0);
  expect(host.textContent).toContain("2,offline");
  await click(0);
  expect(h.messages).toHaveBeenCalledTimes(2);
  await click(2);
  expect(host.textContent).toContain("did not advance");
  await click(0);
  expect(h.messages).toHaveBeenCalledTimes(3);
});
it("coalesces refreshes arriving while a history page is loading", async () => {
  let finish!: (page: unknown) => void;
  h.messages
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ items: [msg("2"), msg("1")], nextCursor: null });
  await render();
  await click(1);
  await click(1);
  expect(h.detail).toHaveBeenCalledOnce();
  await act(async () => finish({ items: [msg("1")], nextCursor: null }));
  expect(h.detail).toHaveBeenCalledTimes(2);
  expect(h.messages).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("1,2,");
});
it("aborts and hides history on account, route or background changes", async () => {
  let finish!: (page: unknown) => void;
  h.messages
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ items: [], nextCursor: null });
  await render();
  const signal = h.messages.mock.calls[0][2];
  await render("other", 2);
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [msg("private")], nextCursor: null }));
  expect(host.textContent).not.toContain("private");
  await render("other", 2, false);
  expect(h.messages.mock.calls[1][2].aborted).toBe(true);
});
it("clears old private rows when access is revoked, then retries from detail", async () => {
  h.messages
    .mockResolvedValueOnce({ items: [msg("private")], nextCursor: "private" })
    .mockRejectedValue(Object.assign(new Error("No access"), { status: 403 }));
  await render();
  await click(0);
  expect(host.textContent).not.toContain("private");
  expect(host.textContent).toContain("No access");
  h.detail.mockRejectedValue(new Error("Conversation not found"));
  await click(2);
  expect(h.detail).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Conversation not found");
});
