// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { CastingManager } from "./casting-manager";
const s = vi.hoisted(() => ({ viewer: "a", list: vi.fn(), create: vi.fn(), success: vi.fn() }));
vi.mock("./auth-provider", () => ({ useAuth: () => ({ user: { id: s.viewer } }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: s.success, error: vi.fn() } }));
vi.mock("@/lib/characters-api", () => ({
  listCastingInvites: s.list,
  createCastingInvite: s.create,
  revokeCastingInvite: vi.fn(),
  castingAcceptUrl: (token: string) => `/accept/${token}`,
}));
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  s.viewer = "a";
  s.list.mockReset().mockResolvedValue([]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
async function render(projectId = "p", canManage = true) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <CastingManager projectId={projectId} canManage={canManage} />
      </QueryClientProvider>
    )
  );
  await settle();
}
async function fill() {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "actor");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("blocks duplicate creation and suppresses abandoned tokens", async () => {
  let resolve!: (value: unknown) => void;
  s.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await fill();
  await act(async () => {
    const form = host.querySelector("form")!;
    for (let i = 0; i < 2; i++)
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(s.create).toHaveBeenCalledTimes(1);
  const signal = s.create.mock.calls[0][2] as AbortSignal;
  s.viewer = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ id: "old", token: "private" }));
  expect(host.textContent).not.toContain("private");
  expect(s.success).not.toHaveBeenCalled();
});
it("cancels reads and clears drafts when scope changes", async () => {
  let signal!: AbortSignal;
  s.list.mockImplementation((_p, next) => {
    signal = next;
    return new Promise(() => {});
  });
  await render();
  await fill();
  const old = signal;
  await render("new");
  expect(old.aborted).toBe(true);
  expect(host.querySelector("input")!.value).toBe("");
  await render("new", false);
  expect(signal.aborted).toBe(true);
  expect(host.textContent).toBe("");
});
