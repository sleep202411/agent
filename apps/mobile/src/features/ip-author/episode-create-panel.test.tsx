import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpEpisodeCreatePanel } from "./episode-create-panel";
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://api.test" } },
}));
vi.mock("./episode-video-duration", () => ({ probeEpisodeVideoDuration: async () => null }));
const h = vi.hoisted(() => ({
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  pick: vi.fn(),
  selected: vi.fn(),
  storagePut: vi.fn(),
  push: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, post: h.post },
  ApiRequestError: class extends Error {
    status: number;
    constructor(_code: string, message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000004" },
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <div>web:{path}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      readOnly={!editable}
      aria-label={accessibilityLabel}
    />
  ),
}));

vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: vi.fn() }));
vi.mock("expo-image", () => ({
  Image: ({ source }: { source: { uri: string } }) => <img src={source.uri} alt="Cover" />,
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("./episode-video-source", () => ({ episodeVideoSource: h.selected }));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <div>Video preview</div>,
}));

const id = "11111111-1111-4111-8111-111111111111",
  assetId = "22222222-2222-4222-8222-222222222222",
  uploadId = "00000000-0000-4000-8000-000000000004";
const snapshot = { id, version: 1, sourceLocale: "en-US", episodes: [] };
const episode = {
  id: assetId,
  episodeNo: 1,
  sortOrder: 1000,
  status: "draft",
  title: "Episode",
  summary: "Summary",
  durationSeconds: null,
  isFreePreview: false,
  coverAsset: null,
  trailerAsset: null,
  mediaAsset: { id: assetId, url: null },
};
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () => root.render(<IpEpisodeCreatePanel ipId={id} userId="alice" generation={1} />));
const click = (label: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });
const type = (label: string, value: string) =>
  act(async () => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.active = true;
  h.focused = true;
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal("fetch", h.storagePut);
  h.storagePut.mockResolvedValue({ ok: true });
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///video.mp4", name: "video.mp4" }],
  });
  h.selected.mockReturnValue({
    name: "video.mp4",
    size: 3,
    contentType: "video/mp4",
    read: async () => new Uint8Array([1, 2, 3]),
  });
  h.get.mockResolvedValue({ ip: snapshot });
  h.post.mockImplementation(async (path: string) =>
    path === "/media/episode-uploads"
      ? {
          id: uploadId,
          partSize: 3,
          sizeBytes: 3,
          expiresAt: "2027-01-01T00:00:00Z",
          uploaded: false,
          parts: [],
        }
      : path.includes("/parts/")
        ? { url: "https://storage.test/part", headers: {} }
        : path.endsWith("/complete")
          ? { mediaAssetId: assetId, storageKey: "key", url: null }
          : path.endsWith("/media")
            ? { asset: { id: assetId, kind: "video" } }
            : { ip: { ...snapshot, version: 2, episodes: [episode] } }
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("persists editable metadata and uploaded media across remount, then creates an episode", async () => {
  await mount();
  await type("ipEpisodes.title", "Episode");
  await type("ipEpisodes.summary", "Summary");
  await click("ipEpisodeCreate.pick");
  expect(host.textContent).toContain("ipEpisodeCreate.videoReady");
  await act(async () => root.render(null));
  await mount();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipEpisodes.title"]')!.value).toBe(
    "Episode"
  );
  await click("ipEpisodeCreate.create");
  expect(host.textContent).toContain("ipEpisodeCreate.saved");
  expect(h.storagePut).toHaveBeenCalledOnce();
  expect(h.post.mock.calls.filter((c) => c[0].endsWith("/episodes"))).toHaveLength(1);
});
it("retains an uncertain creation after remount and requires a refreshed list before resolving", async () => {
  await mount();
  await type("ipEpisodes.title", "Episode");
  await type("ipEpisodes.summary", "Summary");
  await click("ipEpisodeCreate.pick");
  h.post.mockImplementation(async (path: string) => {
    if (path.endsWith("/episodes")) {
      h.get.mockResolvedValue({ ip: { ...snapshot, version: 2, episodes: [episode] } });
      throw Error("Response lost");
    }
    return { asset: { id: assetId, kind: "video" } };
  });
  await click("ipEpisodeCreate.create");
  expect(host.textContent).toContain("ipEpisodeCreate.pending");
  await act(async () => root.render(null));
  await mount();
  await click("common.retry");
  expect(h.post.mock.calls.filter((c) => c[0].endsWith("/episodes"))).toHaveLength(1);
  expect(host.textContent).not.toContain("ipEpisodeCreate.resolveConfirm");
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="ipEpisodes.title"]')!.readOnly
  ).toBe(true);
  await click("thread.refresh");
  expect(host.textContent).toContain("1. Episode");
  await click("ipEpisodeCreate.resolve");
  expect(host.textContent).toContain("ipEpisodeCreate.resolveConfirm");
  await click("ipEpisodeCreate.confirmDiscard");
  expect(host.textContent).not.toContain("ipEpisodeCreate.pending");
});
it("resumes an interrupted upload from the original checkpoint without a new session", async () => {
  await mount();
  h.storagePut.mockRejectedValueOnce(Error("Offline"));
  await click("ipEpisodeCreate.pick");
  expect(host.textContent).toContain("Offline");
  expect(host.textContent).toContain("ipEpisodeCreate.resume");
  await act(async () => root.render(null));
  await mount();
  await click("ipEpisodeCreate.resume");
  const starts = h.post.mock.calls.filter((c) => c[0] === "/media/episode-uploads");
  expect(starts).toHaveLength(2);
  expect(starts[0][1].data.id).toBe(starts[1][1].data.id);
  expect(host.textContent).toContain("ipEpisodeCreate.videoReady");
});
it("hides private drafts when access is revoked or the screen leaves foreground", async () => {
  await mount();
  await type("ipEpisodes.title", "Private episode");
  const { ApiRequestError } = await import("@/lib/api-client");
  h.get.mockRejectedValue(new ApiRequestError("DENIED", "Access removed", 403));
  await click("thread.refresh");
  expect(host.querySelector("input")).toBeNull();
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
});

it("retains the native picker across backgrounding without creating an episode automatically", async () => {
  let finish!: (value: unknown) => void;
  h.pick.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await mount();
  await type("ipEpisodes.title", "Episode");
  await type("ipEpisodes.summary", "Summary");
  await click("ipEpisodeCreate.pick");
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  await act(async () =>
    finish({ canceled: false, assets: [{ uri: "file:///video.mp4", name: "video.mp4" }] })
  );
  h.active = true;
  await mount();
  expect(host.textContent).toContain("ipEpisodeCreate.videoReady");
  expect(h.pick).toHaveBeenCalledOnce();
  expect(h.storagePut).toHaveBeenCalledOnce();
  expect(h.post.mock.calls.filter((c) => c[0].endsWith("/episodes"))).toHaveLength(0);
  await click("ipEpisodeCreate.create");
  expect(host.textContent).toContain("ipEpisodeCreate.saved");
});
for (const exit of ["route", "account"] as const) {
  it(`ignores a late picker result after ${exit} exit`, async () => {
    let finish!: (value: unknown) => void;
    h.pick.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await mount();
    await click("ipEpisodeCreate.pick");
    if (exit === "route") h.focused = false;
    else h.generation = 2;
    await mount();
    await act(async () =>
      finish({ canceled: false, assets: [{ uri: "file:///video.mp4", name: "video.mp4" }] })
    );
    expect(host.textContent).toBe("");
    expect(h.storagePut).not.toHaveBeenCalled();
    expect(h.post).not.toHaveBeenCalled();
  });
}
