import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TimelineMediaPicker } from "./story-timeline-media-picker";
const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  submit: vi.fn(),
  clear: vi.fn(),
  close: vi.fn(),
  generation: 1,
}));
vi.mock("../api/story-timeline-media", () => ({
  fetchTimelineCandidates: h.fetch,
  timelineMediaPending: () => ({ read: h.read, save: h.save, submit: h.submit, clear: h.clear }),
}));
vi.mock("expo-image", () => ({ Image: () => <span>image</span> }));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <span>video preview</span>,
}));
vi.mock("../api/story-timeline-pending", () => ({
  timelinePending: () => ({ read: h.read, save: h.save, submit: h.submit, clear: h.clear }),
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/auth", () => ({ useAuth: () => ({}) }));
vi.mock("../context/story-chapter-context", () => ({ useStoryChapterContext: () => ({}) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000009" },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Alert: { alert: vi.fn() },
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => (
    <input
      value={value}
      disabled={!editable}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), chapterId: id(2), generation: 1 };
const clip = {
  id: id(5),
  stableKey: "clip",
  title: "First",
  kind: "image" as const,
  startMs: 0,
  durationMs: 1000,
  description: null,
  imagePrompt: "Frame",
  videoPrompt: null,
  negativePrompt: null,
  expectedVersion: 2,
};
const candidate = {
  asset: {
    id: id(6),
    kind: "video",
    status: "ready",
    moderationStatus: "approved",
    contentType: "video/mp4",
    previewUrl: "https://example.com/video.mp4",
  },
};
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
const click = async (key: string) => {
  await act(async () => button(key).click());
};
const render = async (canEdit = true) => {
  await act(async () =>
    root.render(
      <TimelineMediaPicker
        scope={scope}
        userId="user"
        sequenceId={id(4)}
        clip={clip}
        canEdit={canEdit}
        onDone={h.close}
      />
    )
  );
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.read.mockReturnValue(null);
  h.fetch.mockResolvedValue([candidate]);
  h.submit.mockResolvedValue({});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("previews on demand and submits the current clip version with the selected media kind", async () => {
  await render();
  expect(host.textContent).not.toContain("video preview");
  await click("timeline.previewMedia");
  expect(host.textContent).toContain("video preview");
  await click("timeline.useMedia");
  expect(h.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      sequenceId: id(4),
      clipId: id(5),
      input: {
        expectedVersion: 2,
        sourceMediaAssetId: id(6),
        kind: "video",
        imagePrompt: null,
        videoPrompt: "Frame",
      },
    })
  );
  expect(h.close).toHaveBeenCalledOnce();
});
it("keeps the exact pending replacement for explicit retry", async () => {
  h.submit.mockRejectedValueOnce(Error("Network"));
  await render();
  await click("timeline.useMedia");
  expect(host.textContent).toContain("Network");
  const command = h.submit.mock.calls[0][0];
  await click("timeline.retry");
  expect(h.submit.mock.calls[1][0]).toEqual(command);
});
it("recovers pending replacement even when the candidate list is unavailable", async () => {
  const command = {
    clientKey: id(9),
    sequenceId: id(4),
    clipId: id(5),
    input: {
      expectedVersion: 2,
      sourceMediaAssetId: id(6),
      kind: "video",
      imagePrompt: null,
      videoPrompt: "Frame",
    },
  };
  h.read.mockReturnValue(command);
  h.fetch.mockRejectedValue(Error("Unavailable"));
  await render();
  await click("timeline.retry");
  expect(h.submit).toHaveBeenCalledWith(command);
});
it("does not offer a mutation to read-only viewers", async () => {
  await render(false);
  expect(button("timeline.useMedia").disabled).toBe(true);
});
it("does not dispatch when durable storage fails", async () => {
  h.save.mockImplementation(() => {
    throw Error("Storage full");
  });
  await render();
  await click("timeline.useMedia");
  expect(h.submit).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Storage full");
});
