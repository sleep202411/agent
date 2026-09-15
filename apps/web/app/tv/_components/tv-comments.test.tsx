// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TvRightRail } from "./tv-right-rail";
import { TvComments } from "./tv-comments";
import { commentsApi } from "../_hooks/comments";
const state = vi.hoisted(() => ({ id: "alice" as string | undefined, open: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.id ? { id: state.id } : null }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: state.open }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_hooks/comments", () => ({
  commentsApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const row = {
  id: "comment",
  ipId: "ip",
  userId: "alice",
  authorName: "Alice",
  body: "Hello",
  createdAt: "2026-09-13T12:00:00Z",
};
beforeEach(() => {
  state.id = "alice";
  container = document.createElement("div");
  root = createRoot(container);
  vi.mocked(commentsApi.list).mockResolvedValue({ items: [row], nextCursor: null });
});
afterEach(() => {
  act(() => root.unmount());
  vi.resetAllMocks();
});
const render = (ipId = "ip") => act(async () => root.render(<TvComments ipId={ipId} />));
const click = (label: string) =>
  Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent === label)!
    .click();
function draft(value: string) {
  const el = container.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
it("retains loaded comments and a specific error when refreshing fails", async () => {
  await render();
  vi.mocked(commentsApi.list).mockRejectedValueOnce(new Error("Network unavailable"));
  await act(async () => click("refresh"));
  expect(container.textContent).toContain("Hello");
  expect(container.textContent).toContain("Network unavailable");
});
it("aborts abandoned reads and ignores their delayed results", async () => {
  let finish!: (v: { items: (typeof row)[]; nextCursor: null }) => void;
  let signal!: AbortSignal;
  vi.mocked(commentsApi.list).mockImplementationOnce((_ip, s) => {
    signal = s;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await render();
  state.id = "bob";
  await render("new-ip");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [{ ...row, body: "Old response" }], nextCursor: null }));
  expect(container.textContent).not.toContain("Old response");
});
it("retains the draft and idempotency key for a failed submission retry", async () => {
  await render();
  act(() => draft("My comment"));
  vi.mocked(commentsApi.create)
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce({ ...row, body: "My comment" });
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(container.querySelector("textarea")!.value).toBe("My comment");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(vi.mocked(commentsApi.create).mock.calls[0]![2]).toBe(
    vi.mocked(commentsApi.create).mock.calls[1]![2]
  );
  expect(container.querySelector("textarea")!.value).toBe("");
});
it("requires sign-in and does not offer removal for another viewer", async () => {
  state.id = undefined;
  await render();
  expect(container.textContent).not.toContain("remove");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(state.open).toHaveBeenCalled();
  expect(commentsApi.create).not.toHaveBeenCalled();
});
it("prevents duplicate posts and discards a delayed post after changing IP", async () => {
  await render();
  act(() => draft("A pending message"));
  let finish!: (value: typeof row) => void;
  let signal!: AbortSignal;
  vi.mocked(commentsApi.create).mockImplementation((_ip, _body, _key, s) => {
    signal = s;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  act(() => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(commentsApi.create).toHaveBeenCalledTimes(1);
  await render("replacement-ip");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ ...row, body: "Abandoned post" }));
  expect(container.textContent).not.toContain("Abandoned post");
  expect(container.querySelector("textarea")!.value).toBe("");
});
it("preserves a failed removal for retry", async () => {
  await render();
  vi.mocked(commentsApi.remove)
    .mockRejectedValueOnce(new Error("Try removal again"))
    .mockResolvedValueOnce({ removed: true });
  await act(async () => click("remove"));
  expect(container.textContent).toContain("Hello");
  expect(container.textContent).toContain("Try removal again");
  await act(async () => click("remove"));
  expect(container.textContent).not.toContain("Hello");
});

it("reclaims the comment column and retains its draft when reopened", async () => {
  await act(async () => root.render(<TvRightRail ipId="ip" />));
  act(() => draft("Unsent review"));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-expanded="true"]')!.click()
  );
  expect(container.querySelector("aside")!.className).toContain("lg:w-12");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="expand"]')!.click()
  );
  expect(container.querySelector("textarea")!.value).toBe("Unsent review");
  expect(container.querySelector("aside")!.className).toContain("xl:w-80");
});
