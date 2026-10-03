import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpMediaPanel } from "./media-panel";
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
vi.mock("./selected-media", () => ({ selectedMedia: h.selected }));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <div>Video preview</div>,
}));
const id = "11111111-1111-4111-8111-111111111111",
  assetId = "22222222-2222-4222-8222-222222222222";
const asset = { id: assetId, kind: "image", url: "https://cdn.example/new.png" };
const snapshot = { id, version: 1, coverAsset: null, trailerAsset: null };
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () => root.render(<IpMediaPanel ipId={id} userId="alice" generation={1} />));
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
    assets: [{ uri: "file:///cover.png", name: "cover.png", mimeType: "image/png" }],
  });
  h.selected.mockResolvedValue({ size: 100, put: h.storagePut });
  h.storagePut.mockResolvedValue({ ok: true });
  h.get.mockResolvedValue({ ip: snapshot });
  h.post.mockImplementation(async (path: string) =>
    path === "/media/upload-url"
      ? { uploadUrl: "https://storage.example/file", method: "PUT", headers: {}, storageKey: "key" }
      : path === "/media/confirm"
        ? { mediaAssetId: assetId, storageKey: "key" }
        : { asset }
  );
  h.put.mockResolvedValue({ ip: { ...snapshot, version: 2, coverAsset: asset } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("uploads a cover, attaches it and displays the saved preview", async () => {
  await mount();
  await click("ipMedia.uploadCover");
  expect(host.textContent).toContain("ipMedia.saved");
  expect(host.querySelector("img")?.src).toBe(asset.url);
  expect(h.put.mock.calls[0][1].data).toEqual({ coverAssetId: assetId, expectedVersion: 1 });
});
it("recovers a lost attachment response after remount without uploading or writing twice", async () => {
  let saved = false;
  h.put.mockImplementation(async () => {
    saved = true;
    throw Error("Response lost");
  });
  h.get.mockImplementation(async () => ({
    ip: saved ? { ...snapshot, version: 2, coverAsset: asset } : snapshot,
  }));
  await mount();
  await click("ipMedia.uploadCover");
  expect(host.textContent).toContain("ipMedia.pending");
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "ipMedia.uploadTrailer")
      ?.disabled
  ).toBe(true);
  await act(async () => root.render(null));
  await mount();
  await click("common.retry");
  expect(h.storagePut).toHaveBeenCalledTimes(1);
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("ipMedia.saved");
});
it("requires refresh and an explicit apply action after a concurrent update", async () => {
  await mount();
  h.get.mockResolvedValue({ ip: { ...snapshot, version: 4 } });
  await click("ipMedia.uploadCover");
  expect(h.put).not.toHaveBeenCalled();
  expect(host.textContent).toContain("changed during upload");
  expect(host.textContent).not.toContain("ipMedia.applyUploaded");
  await click("thread.refresh");
  expect(host.textContent).toContain("ipMedia.applyUploaded");
  h.put.mockResolvedValue({ ip: { ...snapshot, version: 5, coverAsset: asset } });
  await click("ipMedia.applyUploaded");
  expect(h.put.mock.calls[0][1].data.expectedVersion).toBe(4);
  expect(h.storagePut).toHaveBeenCalledTimes(1);
});
it("removes private previews on denied refresh and when the screen is inactive", async () => {
  h.get.mockResolvedValue({
    ip: { ...snapshot, coverAsset: asset, trailerAsset: { ...asset, kind: "video" } },
  });
  await mount();
  await click("ipMedia.preview");
  expect(host.textContent).toContain("Video preview");
  const { ApiRequestError } = await import("@/lib/api-client");
  h.get.mockRejectedValue(new ApiRequestError("DENIED", "Access removed", 403));
  await click("thread.refresh");
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).not.toContain("Video preview");
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
});

for (const slot of ["cover", "trailer"] as const) {
  it(`completes the ${slot} picker handoff across backgrounding once`, async () => {
    let finish!: (value: unknown) => void;
    h.pick.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const selectedAsset = { ...asset, kind: slot === "cover" ? "image" : "video" };
    const previous = h.post.getMockImplementation()!;
    h.post.mockImplementation(async (path: string, options: unknown) =>
      path.endsWith("/media") ? { asset: selectedAsset } : previous(path, options)
    );
    h.put.mockResolvedValue({
      ip: {
        ...snapshot,
        version: 2,
        [slot === "cover" ? "coverAsset" : "trailerAsset"]: selectedAsset,
      },
    });
    await mount();
    await click(slot === "cover" ? "ipMedia.uploadCover" : "ipMedia.uploadTrailer");
    h.active = false;
    await mount();
    expect(host.textContent).toBe("");
    await act(async () =>
      finish({
        canceled: false,
        assets: [
          {
            uri: "file:///media",
            name: slot === "cover" ? "cover.png" : "trailer.mp4",
            mimeType: slot === "cover" ? "image/png" : "video/mp4",
          },
        ],
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
  it(`ignores a picker result after ${exit} exit`, async () => {
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
        assets: [{ uri: "file:///cover.png", name: "cover.png", mimeType: "image/png" }],
      })
    );
    expect(host.textContent).toBe("");
    expect(h.post).not.toHaveBeenCalled();
    expect(h.storagePut).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });
}
