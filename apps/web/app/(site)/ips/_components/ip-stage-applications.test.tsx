// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { IpStageApplications } from "./ip-stage-applications";
import { api } from "@/src/lib/api";
const state = vi.hoisted(() => ({ id: "owner" }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: state.id } }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/src/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const saved = { state: { stage: "testing", version: 0 }, items: [] };
beforeEach(() => {
  state.id = "owner";
  container = document.createElement("div");
  root = createRoot(container);
  vi.mocked(api.get).mockResolvedValue(saved);
});
afterEach(() => {
  act(() => root.unmount());
  vi.resetAllMocks();
});
const render = () => act(async () => root.render(<IpStageApplications ipId="ip" />));
it("shows the pending application after submission and retains it after refresh failure", async () => {
  await render();
  vi.mocked(api.post).mockResolvedValue({
    id: "submitted",
    stage: "story_testing",
    status: "pending",
    reason: "Proposal",
    reviewReason: null,
  });
  act(() => {
    const field = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      "Proposal"
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(container.textContent).toContain("awaiting");
  expect(container.textContent).toContain("Proposal");
  expect(container.querySelector("form")).toBeNull();
  vi.mocked(api.get).mockRejectedValue(new Error("Refresh unavailable"));
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toContain("Refresh unavailable");
  expect(container.textContent).toContain("Proposal");
});
it("retains failed edits and prevents duplicate saves", async () => {
  await render();
  act(() => {
    const field = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      "Ready for production"
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  let reject!: (reason: Error) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      })
  );
  act(() => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  const identity = vi.mocked(api.post).mock.calls[0][1]?.data;
  await act(async () => reject(new Error("Refresh and try again")));
  expect(container.textContent).toContain("Refresh and try again");
  expect(container.querySelector("textarea")!.value).toBe("Ready for production");
  expect(container.querySelector('button[type="submit"]')!.hasAttribute("disabled")).toBe(false);
  act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(vi.mocked(api.post).mock.calls[1][1]?.data).toEqual(identity);
});
it("aborts old reads and suppresses their result after account change", async () => {
  let finish!: (value: typeof saved) => void;
  let signal!: AbortSignal;
  vi.mocked(api.get).mockImplementationOnce((_path, options) => {
    signal = options!.signal as AbortSignal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await render();
  state.id = "replacement";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ state: { stage: "Old account", version: 4 }, items: [] }));
  expect(container.textContent).not.toContain("Old account");
});
