import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { TextGameDetailSchema } from "@repo/shared/text-game";
import { TextGamePlayer } from "./text-game-player";
import { playerTextGameKeys } from "../../_lib/text-game-player-api";
const state = vi.hoisted(() => ({
  viewer: "alice",
  load: vi.fn(),
  send: vi.fn(),
  start: vi.fn(),
  get: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.viewer }, isLoading: false }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("./text-game-stream-body", () => ({ TextGameStreamBody: () => null }));
vi.mock("sonner", () => ({
  toast: {
    error: state.error,
    loading: vi.fn(() => "loading"),
    success: vi.fn(),
    dismiss: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock("../../_lib/text-game-player-api", async (original) => ({
  ...(await original<typeof import("../../_lib/text-game-player-api")>()),
  loadOrStartTextGameSession: state.load,
  sendTextGameAction: state.send,
  startTextGameSession: state.start,
  getPlayingTextGameSession: state.get,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const game = TextGameDetailSchema.parse({
  gameId: "tg_0123456789abcdef",
  status: "published",
  draftVersionId: "1",
  content: { versionId: "1", versionNo: 1 },
});
const session = {
  gameId: game.gameId,
  sessionId: "ts_0123456789abcdef",
  resumed: true,
  messages: [],
  stillUrls: [],
  bgmUrl: null,
  startedAt: "2026-08-09T12:00:00Z",
};
let root: Root, client: QueryClient, host: HTMLDivElement;
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <TextGamePlayer game={game} catalogue={[]} />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
async function mount() {
  Element.prototype.scrollIntoView = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
}
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  host?.remove();
  vi.resetAllMocks();
  state.viewer = "alice";
});
it("cancels old bootstrap and ignores its late session publication after account switching", async () => {
  state.load.mockImplementation(() => new Promise(() => {}));
  await mount();
  const old = state.load.mock.calls[0]![2];
  state.viewer = "bob";
  await render();
  expect(old.signal.aborted).toBe(true);
  await act(async () => old.onSession(session));
  expect(
    client.getQueryData(playerTextGameKeys.session("bob", game.gameId, "en-US"))
  ).toBeUndefined();
  expect(
    client.getQueryData(playerTextGameKeys.session("alice", game.gameId, "en-US"))
  ).toBeUndefined();
  expect(state.load).toHaveBeenCalledTimes(2);
});
it("cancels chat on account change without restoring old drafts, publishing responses or starting recovery", async () => {
  state.load.mockResolvedValue(session);
  let reject!: (error: Error) => void;
  state.send.mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      })
  );
  await mount();
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      "Open door"
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector<HTMLButtonElement>('[aria-label="sendAction"]')!.click();
  });
  expect(state.send).toHaveBeenCalledTimes(1);
  const old = state.send.mock.calls[0]![3];
  state.viewer = "bob";
  await render();
  expect(old.signal.aborted).toBe(true);
  await act(async () => {
    old.onAssistantDelta("private alice response");
    reject(new Error("old failure"));
  });
  expect(state.get).not.toHaveBeenCalled();
  expect(state.error).not.toHaveBeenCalled();
  expect(host.querySelector("textarea")?.value).toBe("");
  expect(client.getQueryData(playerTextGameKeys.session("bob", game.gameId, "en-US"))).toEqual(
    session
  );
});

it("abandons restart publication on account change and keeps the replacement session", async () => {
  state.load.mockResolvedValue(session);
  let finish!: (value: typeof session) => void;
  state.start.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await mount();
  await act(async () => {
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "newStoryAction")!
      .click();
  });
  await act(async () => {
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent === "restart")!
      .click();
  });
  expect(state.start).toHaveBeenCalledTimes(1);
  const old = state.start.mock.calls[0]![2];
  state.viewer = "bob";
  await render();
  expect(old.signal.aborted).toBe(true);
  await act(async () => {
    old.onSession({ ...session, sessionId: "old-restart" });
    finish({ ...session, sessionId: "old-restart" });
  });
  expect(client.getQueryData(playerTextGameKeys.session("bob", game.gameId, "en-US"))).toEqual(
    session
  );
  expect(state.error).not.toHaveBeenCalled();
});
