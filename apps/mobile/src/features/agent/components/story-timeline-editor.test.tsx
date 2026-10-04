import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TimelineEditor } from "./story-timeline-editor";
vi.mock("./story-timeline-export-panel", () => ({ TimelineExportPanel: () => null }));
vi.mock("./story-timeline-preview", () => ({ TimelinePreview: () => <span>Saved preview</span> }));
vi.mock("./story-timeline-generation-panel", () => ({
  TimelineGenerationPanel: () => <span>Generation panel</span>,
}));
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
  timelineMediaPending: () => ({ read: () => null }),
}));
vi.mock("./story-timeline-media-picker", () => ({
  TimelineMediaPicker: () => <span>Media picker</span>,
}));
vi.mock("../api/story-timeline-api", async (original) => ({
  ...(await original<object>()),
  fetchTimelines: h.fetch,
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
const row = {
  id: id(3),
  projectId: id(1),
  chapterId: id(2),
  plotNodeId: "clip:opening",
  title: "Scene",
  durationMs: 1000,
  version: 2,
  status: "current",
  clips: [
    {
      id: id(5),
      stableKey: "clip",
      title: "First",
      rank: 0,
      kind: "image",
      track: "visual",
      startMs: 0,
      durationMs: 1000,
      description: null,
      imagePrompt: "Image",
      videoPrompt: null,
      negativePrompt: null,
      status: "current",
      version: 1,
    },
  ],
};
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
const click = async (key: string) => {
  await act(async () => button(key).click());
};
const render = async (canEdit = true, initialNodeId?: string) => {
  await act(async () =>
    root.render(
      <TimelineEditor
        scope={scope}
        userId="user"
        canEdit={canEdit}
        initialNodeId={initialNodeId}
        onClose={h.close}
      />
    )
  );
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.read.mockReturnValue(null);
  h.fetch.mockResolvedValue([row]);
  h.submit.mockResolvedValue({ ...row, version: 3, clips: [], durationMs: 0 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("removes the last clip and submits a versioned empty timeline", async () => {
  await render();
  await click("Scene");
  await click("timeline.remove");
  await click("timeline.save");
  expect(h.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      sequenceId: id(3),
      input: { expectedVersion: 2, durationMs: 0, clips: [] },
    })
  );
  expect(button("timeline.save").disabled).toBe(true);
});
it("recovers a pending request without allowing edits or sequence switching", async () => {
  const command = {
    version: 1,
    sequenceId: id(3),
    clientKey: id(9),
    input: { expectedVersion: 2, durationMs: 0, clips: [] },
  };
  h.read.mockReturnValue(command);
  await render();
  expect(button("Scene").disabled).toBe(true);
  expect(button("timeline.add").disabled).toBe(true);
  await click("timeline.retry");
  expect(h.submit).toHaveBeenCalledWith(command);
});
it("retains the original command after ambiguous failure", async () => {
  h.submit.mockRejectedValueOnce(Error("Network"));
  await render();
  await click("Scene");
  await click("timeline.remove");
  await click("timeline.save");
  expect(host.textContent).toContain("Network");
  const command = h.submit.mock.calls[0][0];
  await click("timeline.retry");
  expect(h.submit.mock.calls[1][0]).toEqual(command);
});
it("keeps read-only viewers from editing", async () => {
  await render(false);
  await click("Scene");
  expect(host.querySelector("input")!.disabled).toBe(true);
  expect(button("timeline.remove").disabled).toBe(true);
  expect(button("timeline.add").disabled).toBe(true);
});
it("does not submit invalid newly added clips", async () => {
  await render();
  await click("Scene");
  await click("timeline.add");
  await click("timeline.save");
  expect(h.submit).not.toHaveBeenCalled();
});
it("offers saved preview to viewers and removes it when an edit becomes unsaved", async () => {
  await render(false);
  await click("Scene");
  await click("timeline.showPreview");
  expect(host.textContent).toContain("Saved preview");
  await render(true);
  await click("timeline.add");
  expect(host.textContent).not.toContain("Saved preview");
  expect(button("timeline.showPreview")).toBeUndefined();
});

it("opens the exact graph-node timeline without selecting a different scene", async () => {
  h.fetch.mockResolvedValue([
    { ...row, id: id(8), plotNodeId: "clip:other", title: "Other", clips: [] },
    row,
  ]);
  await render(true, "clip:opening");
  expect([...host.querySelectorAll("input")].some((input) => input.value === "First")).toBe(true);
});
it("reports a missing diagnostic timeline without guessing another scene", async () => {
  await render(true, "clip:missing");
  expect(host.textContent).toContain("storyRepair.noTimeline");
  expect(host.querySelectorAll("input")).toHaveLength(0);
});
it("preserves a pending timeline instead of replacing it with the diagnostic target", async () => {
  h.read.mockReturnValue({
    version: 1,
    sequenceId: id(8),
    clientKey: id(9),
    input: { expectedVersion: 1, durationMs: 0, clips: [] },
  });
  await render(true, "clip:opening");
  expect(host.textContent).toContain("timeline.pendingHelp");
  expect([...host.querySelectorAll("input")].some((input) => input.value === "First")).toBe(false);
});
