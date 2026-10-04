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
  resolveCrew: vi.fn(),
  generation: 1,
  active: true,
  uploadRead: vi.fn(),
  uploadPick: vi.fn(),
  uploadResume: vi.fn(),
}));
vi.mock("../api/story-crew-candidate-selection", () => ({ resolveCrewCandidate: h.resolveCrew }));
vi.mock("./story-crew-candidate-list", () => ({
  CrewCandidateList: ({ add, disabled }: { add: (id: string) => void; disabled: boolean }) => (
    <button disabled={disabled} onClick={() => add("crew-media")}>
      Crew choice
    </button>
  ),
}));
vi.mock("../api/story-timeline-media", () => ({
  fetchTimelineCandidates: h.fetch,
  timelineMediaPending: () => ({ read: h.read, save: h.save, submit: h.submit, clear: h.clear }),
}));
vi.mock("../api/story-timeline-upload", () => ({
  timelineUpload: () => ({
    read: h.uploadRead,
    clear: vi.fn(),
    pick: h.uploadPick,
    resume: h.uploadResume,
  }),
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
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
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
  h.active = true;
  h.read.mockReturnValue(null);
  h.uploadRead.mockReturnValue(null);
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

it("recovers an interrupted upload and requires explicit clip selection", async () => {
  h.uploadRead.mockReturnValue({ name: "image.png", clientKey: "storage-key" });
  h.uploadResume.mockResolvedValue(candidate);
  await render();
  expect(button("timeline.useMedia").disabled).toBe(true);
  await click("timeline.retryUpload");
  expect(h.uploadResume).toHaveBeenCalledOnce();
  expect(h.submit).not.toHaveBeenCalled();
  expect(button("timeline.useMedia").disabled).toBe(false);
});
it("does not upload for viewers", async () => {
  await render(false);
  expect(button("timeline.uploadMedia").disabled).toBe(true);
});
it("cancels the active upload when leaving the picker", async () => {
  let signal: AbortSignal | undefined;
  h.uploadPick.mockImplementation((value: AbortSignal) => {
    signal = value;
    return new Promise(() => {});
  });
  await render();
  await click("timeline.uploadMedia");
  expect(signal?.aborted).toBe(false);
  await act(async () => root.render(null));
  expect(signal?.aborted).toBe(true);
});

it("imports a Crew candidate before durably binding its media ID to the clip", async () => {
  h.resolveCrew.mockResolvedValue(candidate);
  await render();
  await click("storyCandidates.importCrew");
  await click("Crew choice");
  expect(h.resolveCrew).toHaveBeenCalledWith(
    scope,
    "user",
    "crew-media",
    ["image", "video"],
    id(9),
    expect.any(AbortSignal)
  );
  expect(h.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({ sourceMediaAssetId: id(6), kind: "video" }),
    })
  );
});
it("does not create a binding command when Crew import is uncertain", async () => {
  h.resolveCrew.mockRejectedValue(Error("Import interrupted"));
  await render();
  await click("storyCandidates.importCrew");
  await click("Crew choice");
  expect(h.save).not.toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Import interrupted");
});

it("does not bind a late Crew import after leaving the screen", async () => {
  let finish!: (value: unknown) => void;
  h.resolveCrew.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("storyCandidates.importCrew");
  await click("Crew choice");
  const signal = h.resolveCrew.mock.calls[0][5] as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish(candidate));
  expect(h.save).not.toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
});
