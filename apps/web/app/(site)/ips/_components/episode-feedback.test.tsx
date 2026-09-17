// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { EpisodeFeedback } from "./episode-feedback";
import { api } from "@/src/lib/api";
const state = vi.hoisted(() => ({ id: "a" as string | null, open: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.id ? { id: state.id } : null }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: state.open }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/src/lib/api", () => ({ api: { get: vi.fn(), put: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
  state.id = "a";
  vi.mocked(api.get).mockResolvedValue({ likes: 2, dislikes: 1, mine: null });
});
afterEach(() => {
  act(() => root.unmount());
  vi.resetAllMocks();
});
const render = () => act(async () => root.render(<EpisodeFeedback ipId="ip" episodeId="ep" />));
it("prevents repeated pending votes and keeps failure retryable", async () => {
  await render();
  let reject!: (reason: Error) => void;
  vi.mocked(api.put).mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      })
  );
  await act(async () => {
    host.querySelector("button")!.click();
    host.querySelector("button")!.click();
  });
  expect(api.put).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("Retry this vote")));
  expect(host.textContent).toContain("Retry this vote");
  expect(host.querySelector("button")!.disabled).toBe(false);
  expect(host.textContent).toContain("like 2");
});
it("clears an existing vote and aborts it after account change", async () => {
  vi.mocked(api.get).mockResolvedValue({ likes: 2, dislikes: 1, mine: 1 });
  await render();
  vi.mocked(api.put).mockImplementation(() => new Promise(() => {}));
  await act(async () => host.querySelector("button")!.click());
  const options = vi.mocked(api.put).mock.calls[0][1]!;
  expect(options.data).toEqual({ value: null });
  state.id = "b";
  await render();
  expect(options.signal?.aborted).toBe(true);
});
it("asks a guest to sign in without writing", async () => {
  state.id = null;
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(state.open).toHaveBeenCalled();
  expect(api.put).not.toHaveBeenCalled();
});

it("supports like, dislike and clearing a vote without a visible testing heading", async () => {
  await render();
  const buttons = host.querySelectorAll("button");
  for (const [index, value, result] of [
    [0, 1, { likes: 3, dislikes: 1, mine: 1 }],
    [1, -1, { likes: 2, dislikes: 2, mine: -1 }],
    [1, null, { likes: 2, dislikes: 1, mine: null }],
  ] as const) {
    vi.mocked(api.put).mockResolvedValueOnce(result);
    await act(async () => buttons[index].click());
    expect(vi.mocked(api.put).mock.lastCall?.[1]?.data).toEqual({ value });
    expect(buttons[index].getAttribute("aria-pressed")).toBe(String(value !== null));
  }
  expect(host.textContent).not.toContain("title");
});
