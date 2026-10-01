import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BookmarkControl } from "./bookmark-control";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  gate: vi.fn(),
  viewer: null as string | null,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    generation: 1,
    status: h.viewer ? "authenticated" : "anonymous",
    user: h.viewer ? { id: h.viewer } : null,
  }),
  useAuthGate: () => ({ requireAuth: h.gate }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityRole,
    "aria-checked": checked,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityRole?: string;
    "aria-checked"?: boolean;
  }) => (
    <button role={accessibilityRole} aria-checked={checked} onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const ipId = "11111111-1111-4111-8111-111111111111",
  ep = "22222222-2222-4222-8222-222222222222";
const episodes = [{ id: ep, title: "Episode 1" }];
const render = (list = episodes) =>
  act(async () => root.render(<BookmarkControl ipId={ipId} episodes={list} />));
const button = (label: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
beforeEach(() => {
  vi.resetAllMocks();
  h.viewer = null;
  h.get.mockResolvedValue({ items: [] });
  h.post.mockResolvedValue({});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("keeps the guest's chosen episode while opening existing sign-in and never writes on selection", async () => {
  await render();
  await click("ipBookmark.target: ipBookmark.wholeIp");
  await click("Episode 1");
  await click("ipBookmark.episode");
  expect(h.gate).toHaveBeenCalledTimes(1);
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
  h.viewer = "user";
  await render();
  expect(host.textContent).toContain("ipBookmark.target: Episode 1");
  await click("ipBookmark.episode");
  expect(h.post).toHaveBeenCalledWith(
    "/ip-commerce/me/collection",
    expect.objectContaining({ data: { targetType: "episode", ipId, episodeId: ep } })
  );
});
it("recovers when the selected episode disappears, even when no episodes remain", async () => {
  h.viewer = "user";
  await render();
  await click("ipBookmark.target: ipBookmark.wholeIp");
  await click("Episode 1");
  await render([]);
  expect(button("ipBookmark.episode").disabled).toBe(true);
  await click("ipBookmark.target: ipBookmark.unavailable");
  await click("ipBookmark.wholeIp");
  expect(button("contentGpsDiscovery.bookmark").disabled).toBe(false);
  expect(h.post).not.toHaveBeenCalled();
});
it("uses one collection read per target and blocks bookmarks until a failed read is retried", async () => {
  h.viewer = "user";
  h.get.mockRejectedValue(new Error("Collection denied"));
  await render(Array.from({ length: 50 }, (_, n) => ({ id: String(n), title: `Episode ${n}` })));
  expect(h.get).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Collection denied");
  expect(button("contentGpsDiscovery.bookmark").disabled).toBe(true);
  h.get.mockResolvedValue({ items: [] });
  await click("contentGpsDiscovery.retry");
  expect(button("contentGpsDiscovery.bookmark").disabled).toBe(false);
  expect(h.post).not.toHaveBeenCalled();
});
