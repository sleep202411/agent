import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readNotification, readAllNotifications } from "./notification-api";
import { useNotifications } from "./use-notifications";

const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const row = {
  id: "notice",
  type: "crew.task.assigned",
  title: "Task assigned",
  body: "Review the scene",
  meta: {},
  createdAt: "2026-10-02T00:00:00Z",
  readAt: null,
};
let root: Root, host: HTMLDivElement;
function List() {
  const list = useNotifications(String(h.generation), "unread");
  return <div>{list.loading ? "Loading" : list.items.map((item) => item.title).join(",")}</div>;
}
const render = (active = true) => act(async () => root.render(active ? <List /> : null));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

it.each(["one", "all"])(
  "refreshes a returned list when a late %s-read receipt arrives",
  async (kind) => {
    let finish!: (result: unknown) => void;
    h.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await render();
    const controller = new AbortController();
    const receipt =
      kind === "one"
        ? readNotification(row.id, 1, controller.signal)
        : readAllNotifications(1, controller.signal);
    await render(false);
    await render();
    expect(host.textContent).toBe("Task assigned");
    h.get.mockResolvedValue({ items: [], nextCursor: null });
    await act(async () => {
      finish(kind === "one" ? { ...row, readAt: row.createdAt } : { count: 1 });
      await receipt;
    });
    expect(host.textContent).toBe("");
    expect(h.get).toHaveBeenCalledTimes(3);
    expect(h.post).toHaveBeenCalledTimes(1);
  }
);

it("does not refresh another account from an obsolete read receipt", async () => {
  let finish!: (result: unknown) => void;
  h.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const receipt = readNotification(row.id, 1, new AbortController().signal);
  h.generation = 2;
  await render();
  await act(async () => {
    finish({ ...row, readAt: row.createdAt });
    await expect(receipt).rejects.toThrow("session expired");
  });
  expect(h.get).toHaveBeenCalledTimes(1);
});

it("does not treat a mismatched receipt as a confirmed update", async () => {
  await render();
  h.post.mockResolvedValue({ ...row, id: "different", readAt: row.createdAt });
  await act(async () => {
    await expect(readNotification(row.id, 1, new AbortController().signal)).rejects.toThrow(
      "mismatch"
    );
  });
  expect(h.get).toHaveBeenCalledTimes(1);
  expect(host.textContent).toBe("Task assigned");
});

it("does not reload a departed list, and returning after confirmation loads fresh data", async () => {
  await render();
  await render(false);
  h.post.mockResolvedValue({ ...row, readAt: row.createdAt });
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  await act(async () => {
    await readNotification(row.id, 1, new AbortController().signal);
  });
  expect(h.get).toHaveBeenCalledTimes(1);
  await render();
  expect(host.textContent).toBe("");
  expect(h.get).toHaveBeenCalledTimes(2);
});
