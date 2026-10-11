// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { EpisodeFeedback } from "./episode-feedback";
import { api } from "@/lib/api-client";
const state = vi.hoisted(() => ({
  id: "a" as string | null,
  open: vi.fn(),
  active: true,
  generation: 1,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    generation: state.generation,
    user: state.id ? { id: state.id } : null,
    status: state.id ? "authenticated" : "anonymous",
  }),
  useAuthGate: () => ({ openLogin: state.open }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => state.active }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => state.generation }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ brand: "red", backgroundElement: "black" }),
}));
vi.mock("@/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
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
  state.generation = 1;
  vi.mocked(api.get).mockResolvedValue({ likes: 2, dislikes: 1, mine: null });
});
afterEach(() => {
  act(() => root.unmount());
  vi.resetAllMocks();
});
const render = (visible = true) =>
  act(async () => root.render(<EpisodeFeedback ipId="ip" episodeId="ep" visible={visible} />));
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
  expect(host.querySelector("button")!.disabled).toBe(true);
  vi.mocked(api.get).mockResolvedValue({ likes: 3, dislikes: 1, mine: 1 });
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "episodeFeedback.retry")!
      .click()
  );
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(host.querySelector("button")!.disabled).toBe(false);
  expect(host.textContent).toContain("episodeFeedback.like 3");
});
it("isolates a late write from a new account without cancelling the dispatched vote", async () => {
  vi.mocked(api.get).mockResolvedValue({ likes: 2, dislikes: 1, mine: 1 });
  await render();
  let finish!: (value: any) => void;
  vi.mocked(api.put).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => host.querySelector("button")!.click());
  const options = vi.mocked(api.put).mock.calls[0][1]!;
  expect(options.data).toEqual({ value: null });
  expect(options.signal).toBeUndefined();
  state.id = "b";
  state.generation++;
  vi.mocked(api.get).mockResolvedValue({ likes: 5, dislikes: 2, mine: null });
  await render();
  await act(async () => finish({ likes: 1, dislikes: 1, mine: null }));
  expect(host.textContent).toContain("episodeFeedback.like 5");
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

it("serializes a vote across background/return and reads the authoritative result", async () => {
  await render();
  let finish!: (value: any) => void;
  vi.mocked(api.put).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => host.querySelector("button")!.click());
  state.active = false;
  await render();
  state.active = true;
  await render();
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(host.querySelector("button")!.disabled).toBe(true);
  await act(async () => host.querySelector("button")!.click());
  expect(api.put).toHaveBeenCalledTimes(1);
  vi.mocked(api.get).mockResolvedValue({ likes: 7, dislikes: 1, mine: 1 });
  await act(async () => finish({ likes: 3, dislikes: 1, mine: 1 }));
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("episodeFeedback.like 7");
  expect(host.querySelector("button")!.disabled).toBe(false);
});
it("refreshes after a vote settles while inactive", async () => {
  await render();
  let finish!: (value: any) => void;
  vi.mocked(api.put).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => host.querySelector("button")!.click());
  state.active = false;
  await render();
  await act(async () => finish({ likes: 3, dislikes: 1, mine: 1 }));
  expect(api.get).toHaveBeenCalledTimes(1);
  vi.mocked(api.get).mockResolvedValue({ likes: 8, dislikes: 1, mine: 1 });
  state.active = true;
  await render();
  expect(host.textContent).toContain("episodeFeedback.like 8");
});
it("rejects invalid feedback and retries the read without writing", async () => {
  vi.mocked(api.get).mockResolvedValue({ likes: -1, dislikes: 0, mine: 2 });
  await render();
  expect(host.textContent).toContain("episodeFeedback.failed");
  expect(host.querySelector("button")!.disabled).toBe(true);
  vi.mocked(api.get).mockResolvedValue({ likes: 0, dislikes: 0, mine: null });
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "episodeFeedback.retry")!
      .click()
  );
  expect(host.querySelector("button")!.disabled).toBe(false);
  expect(api.put).not.toHaveBeenCalled();
});
it("guards an account change before React rerenders", async () => {
  await render();
  state.generation++;
  await act(async () => host.querySelector("button")!.click());
  expect(api.put).not.toHaveBeenCalled();
});

it("retains a pending vote when the parent hides controls for playback access refresh", async () => {
  await render();
  let finish!: (value: any) => void;
  vi.mocked(api.put).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => host.querySelector("button")!.click());
  await render(false);
  expect(host.textContent).toBe("");
  await render(true);
  expect(host.querySelector("button")!.disabled).toBe(true);
  expect(api.get).toHaveBeenCalledTimes(1);
  vi.mocked(api.get).mockResolvedValue({ likes: 9, dislikes: 1, mine: 1 });
  await act(async () => finish({ likes: 3, dislikes: 1, mine: 1 }));
  expect(host.textContent).toContain("episodeFeedback.like 9");
  expect(api.put).toHaveBeenCalledTimes(1);
});
