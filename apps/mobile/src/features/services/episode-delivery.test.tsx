import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { EpisodeDelivery } from "./episode-delivery";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  focused: true,
  load: vi.fn(),
  submit: vi.fn(),
  review: vi.fn(),
  video: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./episode-delivery-api", () => ({
  fetchEpisodeDelivery: h.load,
  submitEpisodeDelivery: h.submit,
  reviewEpisodeDelivery: h.review,
  fetchEpisodeVideo: h.video,
}));
vi.mock("./conversation-file", () => ({ ConversationFile: () => <span>video preview</span> }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({
    children,
    style,
  }: {
    children: ReactNode;
    style?: { display?: "none" | "flex" };
  }) => <div style={{ display: style?.display }}>{children}</div>,
}));
vi.mock("@/features/crew-assets/asset-picker", () => ({
  CrewAssetPicker: ({ onSelect }: { onSelect: (rows: unknown[]) => void }) => (
    <>
      <button
        onClick={() =>
          onSelect([{ id: "asset", name: "movie", kind: "file", media: { kind: "video" } }])
        }
      >
        pick video
      </button>
      <button
        onClick={() =>
          onSelect([{ id: "image", name: "image", kind: "file", media: { kind: "image" } }])
        }
      >
        pick image
      </button>
    </>
  ),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children, style }: { children: ReactNode; style?: { display?: "none" | "flex" } }) => (
    <div style={{ display: style?.display }}>{children}</div>
  ),
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
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
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const data = {
  canSubmit: true,
  canReview: false,
  episode: {
    id: "episode",
    number: 1,
    title: "Pilot",
    status: "in_production",
    deliveries: [] as unknown[],
  },
};
const pending = {
  id: "delivery",
  episodeId: "episode",
  versionNumber: 1,
  assetNodeId: "asset",
  status: "submitted",
  createdAt: "2026-09-29T00:00:00Z",
  note: "",
  reviewNote: "",
  asset: { name: "movie" },
};
const render = () =>
  act(async () =>
    root.render(
      <EpisodeDelivery
        crewId="crew"
        episodeId="episode"
        userId="user"
        generation={1}
        onClose={h.close}
      />
    )
  );
const click = (name: string) => act(async () => button(name).click());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.focused = true;
  h.load.mockResolvedValue(data);
  h.video.mockResolvedValue({
    name: "movie",
    media: { id: "media", kind: "video", contentType: "video/mp4" },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("allows delivery without metadata manage permission and rejects non-video selections", async () => {
  await render();
  await click("episodeDelivery.select");
  await click("pick image");
  expect(host.textContent).toContain("episodeDelivery.videoRequired");
  expect(button("episodeDelivery.submit").disabled).toBe(true);
});
it("prevents duplicate submissions and freezes uncertain outcomes until refreshed", async () => {
  h.submit.mockRejectedValue(new Error("network failed"));
  await render();
  await click("episodeDelivery.select");
  await click("pick video");
  await act(async () => {
    button("episodeDelivery.submit").click();
    button("episodeDelivery.submit").click();
  });
  expect(h.submit).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("network failed");
  expect(button("episodeDelivery.submit").disabled).toBe(true);
  await click("thread.refresh");
  expect(h.load).toHaveBeenCalledTimes(2);
});
it("hides submissions while review is pending and hides reviewer actions from deliverers", async () => {
  h.load.mockResolvedValue({ ...data, episode: { ...data.episode, deliveries: [pending] } });
  await render();
  expect(button("episodeDelivery.submit")).toBeUndefined();
  expect(button("episodeDelivery.approve")).toBeUndefined();
  expect(host.textContent).toContain("video preview");
});
it("supports review independently, requires a rejection note, and prevents double approval", async () => {
  h.load.mockResolvedValue({
    ...data,
    canSubmit: false,
    canReview: true,
    episode: { ...data.episode, deliveries: [pending] },
  });
  h.review.mockResolvedValue({});
  await render();
  expect(button("episodeDelivery.reject").disabled).toBe(true);
  await act(async () => {
    button("episodeDelivery.approve").click();
    button("episodeDelivery.approve").click();
  });
  expect(h.review).toHaveBeenCalledTimes(1);
  expect(h.review).toHaveBeenCalledWith(pending, "approve", "", "user", 1);
  expect(host.textContent).toContain("episodeDelivery.saved");
});
it("does not let cancelled episodes submit", async () => {
  h.load.mockResolvedValue({ ...data, episode: { ...data.episode, status: "cancelled" } });
  await render();
  expect(button("episodeDelivery.select")).toBeUndefined();
});
it("ignores taps after the account changes", async () => {
  await render();
  await click("episodeDelivery.select");
  await click("pick video");
  h.generation = 2;
  await click("episodeDelivery.submit");
  expect(h.submit).not.toHaveBeenCalled();
  await render();
  expect(host.textContent).toBe("");
});

it("submits a rejection note for the selected version", async () => {
  h.load.mockResolvedValue({
    ...data,
    canSubmit: false,
    canReview: true,
    episode: { ...data.episode, deliveries: [pending] },
  });
  h.review.mockResolvedValue({});
  await render();
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="episodeDelivery.reviewNote"]'
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Correct the final cut"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("episodeDelivery.reject");
  expect(h.review).toHaveBeenCalledWith(pending, "reject", "Correct the final cut", "user", 1);
});
it("keeps refresh and navigation locked during a write", async () => {
  let resolve!: (value: unknown) => void;
  h.submit.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  await click("episodeDelivery.select");
  await click("pick video");
  await click("episodeDelivery.submit");
  expect(button("thread.refresh").disabled).toBe(true);
  expect(button("crewTasks.back").disabled).toBe(true);
  h.generation = 2;
  await act(async () => resolve({}));
  expect(host.textContent).not.toContain("episodeDelivery.saved");
});

it("retains the selected delivery asset and note through background without submitting", async () => {
  await render();
  await click("episodeDelivery.select");
  await click("pick video");
  const input = host.querySelector<HTMLInputElement>('input[aria-label="episodeDelivery.note"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Final cut ready"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  h.active = false;
  await render();
  expect((host.firstElementChild as HTMLElement).style.display).toBe("none");
  await click("episodeDelivery.submit");
  expect(h.submit).not.toHaveBeenCalled();
  h.active = true;
  await render();
  await click("episodeDelivery.submit");
  expect(h.submit).toHaveBeenCalledWith(data.episode.id, "asset", "Final cut ready", "user", 1);
});
