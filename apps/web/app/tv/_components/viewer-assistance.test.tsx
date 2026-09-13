// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ViewerAssistance } from "./viewer-assistance";
import { api } from "@/src/lib/api";
const state = vi.hoisted(() => ({ id: "alice" }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: state.id } }) }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/api", () => ({ api: { post: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, box: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  state.id = "alice";
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  await act(async () => root.render(<ViewerAssistance />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  box.remove();
});
it("releases a stalled request and permits a replacement after timeout", async () => {
  vi.useFakeTimers();
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(() => {}) as never);
  await input();
  await submit();
  const options = vi.mocked(api.post).mock.calls[0][1]!;
  await act(async () => vi.advanceTimersByTime(45_000));
  expect(options.signal?.aborted).toBe(true);
  expect(box.textContent).toContain("timeout");
  expect(box.querySelector("input")!.disabled).toBe(false);
  vi.mocked(api.post).mockResolvedValueOnce({ suggestions: [] });
  await submit();
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(box.textContent).toContain("empty");
});
async function input() {
  await act(async () => {
    const field = box.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      field,
      "calm story"
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    box
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
it("preserves failed preferences and renders retry results as AI suggestions", async () => {
  vi.mocked(api.post)
    .mockRejectedValueOnce(new Error("Try again"))
    .mockResolvedValueOnce({ suggestions: [{ id: "one", title: "Journey", reason: "Quiet" }] });
  await input();
  await submit();
  expect(box.textContent).toContain("Try again");
  expect(box.querySelector("input")!.value).toBe("calm story");
  await submit();
  expect(box.querySelector("a")!.getAttribute("href")).toBe("/en-US/ips/one");
  expect(box.textContent).toContain("Quiet");
});
it("prevents overlap and discards responses from a previous account", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never
  );
  await input();
  await submit();
  await submit();
  expect(api.post).toHaveBeenCalledTimes(1);
  const options = vi.mocked(api.post).mock.calls[0][1]!;
  state.id = "bob";
  await act(async () => root.render(<ViewerAssistance />));
  expect(options.signal?.aborted).toBe(true);
  await act(async () =>
    finish({ suggestions: [{ id: "one", title: "Old result", reason: "Old" }] })
  );
  expect(box.textContent).not.toContain("Old result");
  expect(box.querySelector("input")!.value).toBe("");
});
