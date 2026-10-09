// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { EpisodeFeedback } from "./episode-feedback";
import { api } from "@/lib/api-client";
const state = vi.hoisted(() => ({ id: "a" as string | null, open: vi.fn(), active: true }));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    user: state.id ? { id: state.id } : null,
    status: state.id ? "authenticated" : "anonymous",
  }),
  useAuthGate: () => ({ openLogin: state.open }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => state.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  ActivityIndicator: () => <div>loading</div>,
  Pressable: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), put: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
  state.id = "a";
  state.active = true;
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
  expect(vi.mocked(api.put).mock.calls[0][0]).toBe("/ip-commerce/ips/ip/episodes/ep/feedback");
  expect(vi.mocked(api.put).mock.calls[0][1]?.service).toBe("aurora");
  await act(async () => reject(new Error("Retry this vote")));
  expect(host.textContent).toContain("Retry this vote");
  expect(host.querySelector("button")!.disabled).toBe(false);
  expect(host.textContent).toContain("episodeFeedback.like 2");
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

it("cancels pending reads when the screen loses focus", async () => {
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
  await render();
  const signal = vi.mocked(api.get).mock.calls[0][1]?.signal;
  state.active = false;
  await render();
  expect(signal?.aborted).toBe(true);
  expect(host.textContent).toBe("");
});
