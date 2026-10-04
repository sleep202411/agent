import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelVideos } from "./channel-videos";
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <span>video-player</span>,
}));
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
const scope = { ipId: "11111111-1111-4111-8111-111111111111", generation: 1, locale: "en-US" };
const id = "22222222-2222-4222-8222-222222222222";
const row = {
  id,
  title: "Film",
  description: "",
  status: "pending",
  version: 4,
  url: "https://media.example/video.mp4",
};
const page = { items: [row], canManage: true, nextCursor: null };
let root: Root, host: HTMLDivElement;
const render = () => act(async () => root.render(<ChannelVideos scope={scope} />));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.generation = 1;
  h.active = true;
  h.get.mockReset();
  h.patch.mockReset();
  h.get.mockResolvedValue(page);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
it("plays on intent and removes playback in background", async () => {
  await render();
  expect(host.textContent).not.toContain("video-player");
  await click("channelVideos.play");
  expect(host.textContent).toContain("video-player");
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
});
it("does not offer review to non-owners or bypass moderation", async () => {
  h.get.mockResolvedValue({ ...page, canManage: false, items: [{ ...row, url: null }] });
  await render();
  expect(button("channelSubmissions.approve")).toBeUndefined();
  expect(button("channelVideos.play")).toBeUndefined();
});
it("reconciles a lost response without replaying review", async () => {
  await render();
  h.patch.mockRejectedValue(new Error("Connection lost"));
  h.get.mockResolvedValue({ ...page, items: [{ ...row, status: "approved", version: 5 }] });
  await click("channelSubmissions.approve");
  expect(h.patch).toHaveBeenCalledOnce();
  expect(h.get).toHaveBeenCalledTimes(2);
  expect(button("channelSubmissions.approve")).toBeUndefined();
  expect(host.textContent).toContain("channelSubmissions.approved");
});
it("blocks stale actions after failed reconciliation until refresh", async () => {
  await render();
  h.patch.mockRejectedValue(new Error("Connection lost"));
  h.get.mockRejectedValue(new Error("Offline"));
  await click("channelSubmissions.reject");
  expect(button("channelSubmissions.reject")).toBeUndefined();
  expect(button("channelVideos.play")).toBeUndefined();
  h.get.mockResolvedValue({ ...page, canManage: false });
  await click("channelSubmissions.refresh");
  expect(button("channelSubmissions.reject")).toBeUndefined();
  expect(h.patch).toHaveBeenCalledOnce();
});
it("continues past a moderation-filtered empty page", async () => {
  h.get.mockResolvedValueOnce({ ...page, items: [], nextCursor: id }).mockResolvedValue(page);
  await render();
  await click("channelSubmissions.more");
  expect(host.textContent).toContain("Film");
});
it("does not dispatch after an account change", async () => {
  await render();
  h.generation++;
  await click("channelSubmissions.approve");
  expect(h.patch).not.toHaveBeenCalled();
});
