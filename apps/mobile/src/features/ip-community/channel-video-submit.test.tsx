import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelVideoSubmit } from "./channel-video-submit";
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <span>video-player</span>,
}));

const h = vi.hoisted(() => ({
  draft: null as any,
  upload: vi.fn(),
  confirm: vi.fn(),
  pick: vi.fn(),
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
  useAuth: () => ({
    generation: h.generation,
    user: { id: "owner" },
    status: h.signedIn ? "authenticated" : "anonymous",
  }),
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
  TextInput: ({ value, onChangeText, editable, accessibilityLabel }: any) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
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
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("./channel-video-upload", () => ({ uploadChannelVideo: h.upload }));
vi.mock("@/lib/media-upload", () => ({ confirmMobileMediaUpload: h.confirm }));
vi.mock("./channel-video-draft", () => ({
  channelVideoDraftStorage: () => ({
    read: () => h.draft,
    save: (d: any) => {
      h.draft = d;
    },
    clear: () => {
      h.draft = null;
    },
  }),
}));
const scope = { ipId: "11111111-1111-4111-8111-111111111111", generation: 1, locale: "en-US" };
const id = "22222222-2222-4222-8222-222222222222";
let root: Root, host: HTMLDivElement;
const done = vi.fn();
const render = () =>
  act(async () => root.render(<ChannelVideoSubmit scope={scope} onSubmitted={done} />));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.generation = 1;
  h.active = true;
  h.signedIn = true;
  h.draft = null;
  vi.clearAllMocks();
  h.get.mockResolvedValue({ community: true, open: true, canManage: false, items: [] });
  h.post.mockResolvedValue({ id, status: "pending" });
  h.confirm.mockResolvedValue({ mediaAssetId: id });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
it("gates guest intent", async () => {
  h.signedIn = false;
  await render();
  await click("channelVideos.submit");
  expect(h.login).toHaveBeenCalledOnce();
  expect(h.get).not.toHaveBeenCalled();
});
it("retries the saved asset and original text without uploading again", async () => {
  h.draft = { stage: "submit", input: { assetId: id, title: "Original", description: "Saved" } };
  await render();
  h.post.mockRejectedValueOnce(new Error("Connection lost"));
  await click("channelSubmissions.retry");
  expect(h.draft.input.assetId).toBe(id);
  expect(host.textContent).toContain("Connection lost");
  await click("channelSubmissions.retry");
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.post).toHaveBeenCalledTimes(2);
  expect(h.post.mock.calls[0][1].data).toEqual(h.post.mock.calls[1][1].data);
  expect(h.draft).toBeNull();
  expect(done).toHaveBeenCalledOnce();
});
it("recovers confirmation before submitting and freezes metadata", async () => {
  h.draft = {
    stage: "confirm",
    metadata: { title: "Saved", description: "Text" },
    confirmation: { storageKey: "key", kind: "episode_video", contentType: "video/mp4" },
  };
  await render();
  expect(host.querySelector("input")?.disabled).toBe(true);
  await click("channelSubmissions.retry");
  expect(h.confirm).toHaveBeenCalledOnce();
  expect(h.post.mock.calls[0][1].data).toEqual({
    assetId: id,
    title: "Saved",
    description: "Text",
  });
  expect(h.upload).not.toHaveBeenCalled();
});
it("retains recovery when the channel closes", async () => {
  h.draft = { stage: "submit", input: { assetId: id, title: "Saved", description: "" } };
  h.get.mockResolvedValue({ community: true, open: false, canManage: false, items: [] });
  await render();
  await click("channelSubmissions.retry");
  expect(h.post).not.toHaveBeenCalled();
  expect(h.draft).not.toBeNull();
  expect(host.textContent).toContain("channelSubmissions.closed");
});

it("uploads a new selection, checkpoints confirmation, then submits", async () => {
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///clip.mp4", name: "clip.mp4", mimeType: "video/mp4", size: 123 }],
  });
  h.upload.mockImplementation(async (_file, _scope, _signal, save) => {
    save({ storageKey: "key", kind: "episode_video", contentType: "video/mp4" });
    expect(h.draft.stage).toBe("confirm");
    return { mediaAssetId: id };
  });
  await render();
  await click("channelVideos.submit");
  const field = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      field,
      "New film"
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("channelVideos.choose");
  await click("channelSubmissions.send");
  expect(h.upload).toHaveBeenCalledOnce();
  expect(h.post).toHaveBeenCalledWith(
    expect.stringContaining("video-submissions"),
    expect.objectContaining({ data: { assetId: id, title: "New film", description: "" } })
  );
  expect(h.draft).toBeNull();
  expect(done).toHaveBeenCalledOnce();
});
