import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpEpisodeMediaPanel } from "./episode-media-panel";
vi.mock("./episode-video-duration", () => ({ probeEpisodeVideoDuration: async () => null }));
const h = vi.hoisted(() => ({
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  del: vi.fn(),
  fileSource: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  pick: vi.fn(),
  selected: vi.fn(),
  storagePut: vi.fn(),
  push: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, post: h.post, delete: h.del },
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
vi.mock("./selected-media", () => ({ selectedMedia: h.selected }));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <div>Video preview</div>,
}));

vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://api.test" } },
}));
vi.mock("./episode-video-source", () => ({ episodeVideoSource: h.fileSource }));
const id = "11111111-1111-4111-8111-111111111111",
  episodeId = "22222222-2222-4222-8222-222222222222",
  assetId = "33333333-3333-4333-8333-333333333333",
  uploadId = "00000000-0000-4000-8000-000000000004";
const asset = { id: assetId, kind: "image", url: "https://cdn.test/poster.png" };
const episode = {
  id: episodeId,
  episodeNo: 1,
  sortOrder: 1000,
  status: "draft",
  title: "Episode",
  summary: "Summary",
  durationSeconds: null,
  isFreePreview: false,
  coverAsset: null,
  mediaAsset: null,
  trailerAsset: null,
};
const snapshot = { id, version: 1, sourceLocale: "en-US", episodes: [episode] };
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () =>
    root.render(
      <IpEpisodeMediaPanel ipId={id} episodeId={episodeId} userId="alice" generation={1} />
    )
  );
const click = (label: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
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
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///poster.png", name: "poster.png", mimeType: "image/png" }],
  });
  h.selected.mockResolvedValue({ size: 100, put: h.storagePut });
  h.storagePut.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", h.storagePut);
  h.fileSource.mockReturnValue({
    name: "source.mp4",
    size: 3,
    contentType: "video/mp4",
    read: async () => new Uint8Array([1, 2, 3]),
  });
  h.get.mockResolvedValue({ ip: snapshot });
  h.post.mockImplementation(async (path: string) =>
    path === "/media/upload-url"
      ? { uploadUrl: "https://storage.test/cover", method: "PUT", headers: {}, storageKey: "key" }
      : path === "/media/confirm"
        ? { mediaAssetId: assetId, storageKey: "key" }
        : path === "/media/episode-uploads"
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
              ? { mediaAssetId: assetId, storageKey: "source", url: null }
              : { asset }
  );
  h.put.mockResolvedValue({
    ip: { ...snapshot, version: 2, episodes: [{ ...episode, coverAsset: asset }] },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("recovers a cover attachment after reload without uploading or updating the episode twice", async () => {
  h.put.mockImplementation(async () => {
    h.get.mockResolvedValue({
      ip: { ...snapshot, version: 2, episodes: [{ ...episode, coverAsset: asset }] },
    });
    throw Error("Response lost");
  });
  await mount();
  await click("ipMedia.uploadCover");
  expect(host.textContent).toContain("ipEpisodeMedia.pending");
  await act(async () => root.render(null));
  await mount();
  await click("common.retry");
  expect(h.storagePut).toHaveBeenCalledOnce();
  expect(h.put).toHaveBeenCalledOnce();
  expect(host.querySelector("img")?.src).toBe(asset.url);
  expect(host.textContent).toContain("ipMedia.saved");
});
it("requires refresh and explicit apply after a conflicting version", async () => {
  await mount();
  h.get.mockResolvedValue({ ip: { ...snapshot, version: 4 } });
  await click("ipMedia.uploadCover");
  expect(h.put).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("ipMedia.applyUploaded");
  await click("thread.refresh");
  h.put.mockResolvedValue({
    ip: { ...snapshot, version: 5, episodes: [{ ...episode, coverAsset: asset }] },
  });
  await click("ipMedia.applyUploaded");
  expect(h.put.mock.calls[0][1].data.expectedVersion).toBe(4);
  expect(h.storagePut).toHaveBeenCalledOnce();
});
it("resumes source replacement with the same checkpoint after an interrupted upload", async () => {
  h.storagePut.mockRejectedValueOnce(Error("Offline"));
  await mount();
  await click("ipEpisodeMedia.replaceSource");
  expect(host.textContent).toContain("Offline");
  await act(async () => root.render(null));
  await mount();
  const previous = h.post.getMockImplementation()!;
  h.post.mockImplementation(async (path: string, options: unknown) =>
    path.endsWith("/media") ? { asset: { ...asset, kind: "video" } } : previous(path, options)
  );
  h.put.mockResolvedValue({
    ip: {
      ...snapshot,
      version: 2,
      episodes: [{ ...episode, mediaAsset: { ...asset, url: "https://cdn.test/video.mp4" } }],
    },
  });
  await click("ipEpisodeCreate.resume");
  expect(host.textContent).toContain("ipMedia.saved");
  const starts = h.post.mock.calls.filter((c) => c[0] === "/media/episode-uploads");
  expect(starts).toHaveLength(2);
  expect(starts[0][1].data.id).toBe(starts[1][1].data.id);
  await click("ipEpisodes.preview");
  expect(host.textContent).toContain("Video preview");
});
it("removes covers only after confirmation and keeps the source video", async () => {
  const existing = {
    ...episode,
    coverAsset: asset,
    mediaAsset: { id: assetId, url: "https://cdn.test/video.mp4" },
  };
  h.get.mockResolvedValue({ ip: { ...snapshot, episodes: [existing] } });
  h.put.mockResolvedValue({
    ip: { ...snapshot, version: 2, episodes: [{ ...existing, coverAsset: null }] },
  });
  await mount();
  await click("ipEpisodeMedia.removeCover");
  await click("common.cancel");
  expect(h.put).not.toHaveBeenCalled();
  await click("ipEpisodeMedia.removeCover");
  await click("ipEpisodeCreate.confirmDiscard");
  expect(h.put.mock.calls[0][1].data).toEqual({ coverAssetId: null, expectedVersion: 1 });
  expect(host.querySelector("img")).toBeNull();
  await click("ipEpisodes.preview");
  expect(host.textContent).toContain("Video preview");
});
it("cancels unfinished multipart work only after confirmation", async () => {
  h.storagePut.mockRejectedValueOnce(Error("Offline"));
  await mount();
  await click("ipEpisodeMedia.replaceSource");
  await click("ipEpisodeMedia.cancelUpload");
  await click("common.cancel");
  expect(h.del).not.toHaveBeenCalled();
  await click("ipEpisodeMedia.cancelUpload");
  await click("ipEpisodeCreate.confirmDiscard");
  expect(h.del.mock.calls[0][0]).toBe(`/media/episode-uploads/${uploadId}`);
  expect(host.textContent).not.toContain("ipEpisodeMedia.pending");
});
it("hides private media after denied refresh and when inactive", async () => {
  h.get.mockResolvedValue({ ip: { ...snapshot, episodes: [{ ...episode, coverAsset: asset }] } });
  await mount();
  const { ApiRequestError } = await import("@/lib/api-client");
  h.get.mockRejectedValue(new ApiRequestError("DENIED", "Access removed", 403));
  await click("thread.refresh");
  expect(host.querySelector("img")).toBeNull();
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
});

for (const action of ["ipMedia.uploadCover", "ipEpisodeMedia.replaceSource"]) {
  it(`retains ${action} across the native picker background handoff`, async () => {
    let finish!: (value: unknown) => void;
    h.pick.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const previous = h.post.getMockImplementation()!;
    if (action === "ipEpisodeMedia.replaceSource") {
      h.post.mockImplementation(async (path: string, options: unknown) =>
        path.endsWith("/media") ? { asset: { ...asset, kind: "video" } } : previous(path, options)
      );
      h.put.mockResolvedValue({
        ip: {
          ...snapshot,
          version: 2,
          episodes: [
            { ...episode, mediaAsset: { id: assetId, url: "https://cdn.test/video.mp4" } },
          ],
        },
      });
    }
    await mount();
    await click(action);
    h.active = false;
    await mount();
    expect(host.textContent).toBe("");
    await act(async () =>
      finish({
        canceled: false,
        assets: [{ uri: "file:///poster.png", name: "poster.png", mimeType: "image/png" }],
      })
    );
    h.active = true;
    await mount();
    expect(host.textContent).toContain("ipMedia.saved");
    expect(h.pick).toHaveBeenCalledOnce();
    expect(h.storagePut).toHaveBeenCalledOnce();
    expect(h.put).toHaveBeenCalledOnce();
  });
}
for (const exit of ["route", "account"] as const) {
  it(`ignores media selected after ${exit} exit`, async () => {
    let finish!: (value: unknown) => void;
    h.pick.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await mount();
    await click("ipMedia.uploadCover");
    if (exit === "route") h.focused = false;
    else h.generation = 2;
    await mount();
    await act(async () =>
      finish({
        canceled: false,
        assets: [{ uri: "file:///poster.png", name: "poster.png", mimeType: "image/png" }],
      })
    );
    expect(host.textContent).toBe("");
    expect(h.storagePut).not.toHaveBeenCalled();
    expect(h.post).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });
}
