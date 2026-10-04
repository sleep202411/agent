import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VideoChannelPicker } from "./video-channel-picker";
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <span>video-player</span>,
}));
vi.mock("./channel-video-submit", () => ({ ChannelVideoSubmit: () => null }));
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  signedIn: true,
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  login: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ generation: h.generation, status: h.signedIn ? "authenticated" : "anonymous" }),
  useAuthGate: () => ({ requireAuth: h.login }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post, patch: h.patch } }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onInput={(e) => onChangeText(e.currentTarget.value)}
    />
  ),
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
const id = "11111111-1111-4111-8111-111111111111";
let root: Root, host: HTMLDivElement;
const render = () => act(async () => root.render(<VideoChannelPicker />));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.active = true;
  h.generation = 1;
  h.signedIn = true;
  vi.clearAllMocks();
  h.get.mockResolvedValue({ items: [{ id, title: "Community" }], nextCursor: null });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
it("loads only community channels after protected intent", async () => {
  await render();
  expect(h.get).not.toHaveBeenCalled();
  await click("channelVideos.submit");
  expect(h.get).toHaveBeenCalledWith(
    "/ip-commerce/ips",
    expect.objectContaining({
      params: {
        channelType: "community",
        q: undefined,
        locale: "en-US",
        limit: 20,
        cursor: undefined,
      },
    })
  );
  await click("Community");
  expect(button("channelVideos.changeChannel")).toBeDefined();
});
it("gates guest access", async () => {
  h.signedIn = false;
  await render();
  await click("channelVideos.submit");
  expect(h.login).toHaveBeenCalledOnce();
  expect(h.get).not.toHaveBeenCalled();
});
it("shows retry for failed catalog reads", async () => {
  h.get.mockRejectedValueOnce(new Error("Offline"));
  await render();
  await click("channelVideos.submit");
  expect(host.textContent).toContain("Offline");
  await click("channelSubmissions.retry");
  expect(button("Community")).toBeDefined();
});
it("deduplicates channel pages", async () => {
  h.get
    .mockResolvedValueOnce({ items: [{ id, title: "Community" }], nextCursor: "next" })
    .mockResolvedValue({ items: [{ id, title: "Community" }], nextCursor: null });
  await render();
  await click("channelVideos.submit");
  await click("channelSubmissions.more");
  expect(
    [...host.querySelectorAll("button")].filter((b) => b.textContent === "Community")
  ).toHaveLength(1);
});
