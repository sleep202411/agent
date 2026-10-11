import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpEpisodesPanel } from "./episodes-panel";
const h = vi.hoisted(() => ({
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  openMedia: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
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
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <div>Video preview</div>,
}));
const id = "11111111-1111-4111-8111-111111111111",
  episodeId = "22222222-2222-4222-8222-222222222222";
const episode = {
  id: episodeId,
  episodeNo: 3,
  sortOrder: 3000,
  status: "published",
  title: "Original",
  summary: "Summary",
  durationSeconds: 100,
  isFreePreview: false,
  coverAsset: null,
  mediaAsset: { id: episodeId, url: "https://cdn.example/video.mp4" },
  trailerAsset: null,
};
const snapshot = { id, version: 1, sourceLocale: "en-US", episodes: [episode] };
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () =>
    root.render(
      <IpEpisodesPanel ipId={id} userId="alice" generation={1} onOpenMedia={h.openMedia} />
    )
  );
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
  h.get.mockResolvedValue({ ip: snapshot });
  h.put.mockResolvedValue({
    ip: { ...snapshot, version: 2, episodes: [{ ...episode, title: "Edited" }] },
  });
  h.del.mockResolvedValue({ ip: { ...snapshot, version: 2, episodes: [] } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("lists episodes, validates unchanged edits and saves a changed title", async () => {
  await mount();
  expect(host.textContent).toContain("3. Original");
  await click("ipEpisodes.edit");
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "ipEpisodes.save")?.disabled
  ).toBe(true);
  await type("ipEpisodes.title", "Edited");
  await click("ipEpisodes.save");
  expect(h.put.mock.calls[0][1].data.expectedVersion).toBe(1);
  expect(host.textContent).toContain("3. Edited");
  expect(host.textContent).toContain("ipEpisodes.saved");
});
it("requires explicit deletion confirmation and supports cancellation", async () => {
  await mount();
  await click("ipEpisodes.delete");
  expect(h.del).not.toHaveBeenCalled();
  await click("common.cancel");
  expect(host.textContent).not.toContain("ipEpisodes.confirmDelete");
  await click("ipEpisodes.delete");
  await click("ipEpisodes.confirmDelete");
  expect(h.del).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("ipEpisodes.empty");
});
it("recovers unknown edits across remount without repeating the write", async () => {
  let saved = false;
  h.put.mockImplementation(async () => {
    saved = true;
    throw Error("Lost response");
  });
  h.get.mockImplementation(async () => ({
    ip: saved ? { ...snapshot, version: 2, episodes: [{ ...episode, title: "Edited" }] } : snapshot,
  }));
  await mount();
  await click("ipEpisodes.edit");
  await type("ipEpisodes.title", "Edited");
  await click("ipEpisodes.save");
  expect(host.textContent).toContain("ipEpisodes.pending");
  await act(async () => root.render(null));
  await mount();
  await click("common.retry");
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("ipEpisodes.saved");
});
it("surfaces protected-order deletion rejection without losing the episode", async () => {
  const { ApiRequestError } = await import("@/lib/api-client");
  h.del.mockRejectedValue(new ApiRequestError("ORDERS", "Episode has orders", 400));
  await mount();
  await click("ipEpisodes.delete");
  await click("ipEpisodes.confirmDelete");
  expect(host.textContent).toContain("Episode has orders");
  expect(host.textContent).toContain("3. Original");
  expect(host.textContent).not.toContain("ipEpisodes.pending");
});
it("clears stale editing on conflict and hides private content after access removal", async () => {
  await mount();
  await click("ipEpisodes.edit");
  await type("ipEpisodes.title", "Edited");
  h.get.mockResolvedValue({ ip: { ...snapshot, version: 4 } });
  await click("ipEpisodes.save");
  expect(h.put).not.toHaveBeenCalled();
  expect(host.querySelectorAll("input")).toHaveLength(0);
  await click("thread.refresh");
  await click("ipEpisodes.preview");
  expect(host.textContent).toContain("Video preview");
  const { ApiRequestError } = await import("@/lib/api-client");
  h.get.mockRejectedValue(new ApiRequestError("DENIED", "Denied", 403));
  await click("thread.refresh");
  expect(host.textContent).not.toContain("Original");
  expect(host.textContent).not.toContain("Video preview");
});
it("validates duration and saves the selected visibility and free-preview fields", async () => {
  h.put.mockImplementation(async (_path: string, options: { data: Record<string, unknown> }) => ({
    ip: { ...snapshot, version: 2, episodes: [{ ...episode, ...options.data }] },
  }));
  await mount();
  await click("ipEpisodes.edit");
  await type("ipEpisodes.duration", "2.5");
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "ipEpisodes.save")?.disabled
  ).toBe(true);
  await type("ipEpisodes.duration", "250");
  await click("☐ ipEpisodes.freePreview");
  await click("○ ipEpisodes.hidden");
  await click("ipEpisodes.save");
  expect(h.put.mock.calls[0][1].data).toMatchObject({
    durationSeconds: 250,
    isFreePreview: true,
    status: "hidden",
  });
  expect(host.textContent).toContain("ipEpisodes.saved");
});

it("opens media management for the selected existing episode", async () => {
  await mount();
  await click("ipEpisodeMedia.heading");
  expect(h.openMedia).toHaveBeenCalledWith(episodeId);
});

it("retains unsaved edits across backgrounding and saves only on request", async () => {
  await mount();
  await click("ipEpisodes.edit");
  await type("ipEpisodes.title", "Edited");
  h.active = false;
  await mount();
  expect(host.querySelector("input")).toBeNull();
  h.active = true;
  await mount();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipEpisodes.title"]')?.value).toBe(
    "Edited"
  );
  expect(h.put).not.toHaveBeenCalled();
  await click("ipEpisodes.save");
  expect(h.put).toHaveBeenCalledOnce();
  expect(h.put.mock.calls[0][1].data.expectedVersion).toBe(1);
});
it("retires unsent editor state when the route is left", async () => {
  await mount();
  await click("ipEpisodes.edit");
  await type("ipEpisodes.title", "Unsent");
  h.focused = false;
  await mount();
  expect(host.textContent).toBe("");
  h.focused = true;
  await mount();
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="ipEpisodes.title"]')?.value
  ).not.toBe("Unsent");
  expect(h.put).not.toHaveBeenCalled();
});
