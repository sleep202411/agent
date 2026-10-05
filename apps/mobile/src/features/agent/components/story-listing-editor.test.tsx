import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryListingEditor } from "./story-listing-editor";
const h = vi.hoisted(() => ({
  load: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  pick: vi.fn(),
  resume: vi.fn(),
  saved: vi.fn(),
  discard: vi.fn(),
  media: vi.fn(),
}));
vi.mock("../api/story-listing-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/story-listing-api")>()),
  storyListing: () => h,
}));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <span>Video preview</span>,
}));
const storage = new Map<string, string>();
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, project: string) => ({
    read: () => storage.get(ns + user + project) ?? null,
    write: (v: string) => storage.set(ns + user + project, v),
  }),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.media } }));
vi.mock("../api/story-timeline-upload", () => ({
  timelineUpload: () => ({ read: () => null, pick: h.pick, resume: h.resume }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("expo-image", () => ({ Image: () => <span>Cover image</span> }));
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "request" } }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText(v: string): void;
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
  Alert: { alert: vi.fn() },
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
}));
const scope = { projectId: "project", chapterId: "chapter", generation: 1 };
const project = {
  id: "project",
  projectVersion: 4,
  status: "active",
  capabilities: ["story.read", "story.edit"],
  storeListing: null,
};
const candidate = { asset: { id: "image", kind: "image", status: "ready" } };
let host: HTMLDivElement, root: Root;
const click = async (label: string) => {
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });
};
beforeEach(async () => {
  vi.resetAllMocks();
  storage.clear();
  h.media.mockResolvedValue([]);
  h.load.mockResolvedValue({ project, pending: null });
  h.read.mockReturnValue(null);
  h.pick.mockResolvedValue(candidate);
  h.save.mockImplementation(async (command) => ({
    ...project,
    projectVersion: 5,
    storeListing: command.storeListing,
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <StoryListingEditor scope={scope} userId="owner" onClose={() => {}} onSaved={h.saved} />
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const fill = async (label: string, value: string) =>
  act(async () => {
    const input = host.querySelector('input[aria-label="' + label + '"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const reopen = async () => {
  await act(async () => root.render(null));
  await act(async () =>
    root.render(
      <StoryListingEditor scope={scope} userId="owner" onClose={() => {}} onSaved={h.saved} />
    )
  );
};
it("preserves local text across closing and reopening then saves the observed version", async () => {
  await fill("storyListing.description", "My draft");
  await reopen();
  expect(
    (host.querySelector('input[aria-label="storyListing.description"]') as HTMLInputElement).value
  ).toBe("My draft");
  await click("storyListing.save");
  expect(h.save).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedProjectVersion: 4,
      storeListing: expect.objectContaining({ description: "My draft" }),
    }),
    expect.any(AbortSignal)
  );
  expect(h.saved).toHaveBeenCalledTimes(1);
});
it("preserves stale drafts and prevents silent rebasing", async () => {
  await fill("storyListing.description", "Keep local");
  h.load.mockResolvedValue({ project: { ...project, projectVersion: 5 }, pending: null });
  await reopen();
  expect(host.textContent).toContain("storyListing.conflict");
  await click("storyListing.save");
  expect(h.save).not.toHaveBeenCalled();
  expect(
    (host.querySelector('input[aria-label="storyListing.description"]') as HTMLInputElement).value
  ).toBe("Keep local");
});
it("keeps uncertain saves for exact retry and locks edits", async () => {
  const command = {
    clientKey: "old",
    expectedProjectVersion: 4,
    storeListing: {
      description: "Pending",
      developer: "",
      tags: [],
      trailerAssetId: null,
      screenshotAssetIds: [],
    },
  };
  h.load.mockResolvedValue({ project, pending: command });
  h.read.mockReturnValue(command);
  await reopen();
  expect(
    (host.querySelector('input[aria-label="storyListing.description"]') as HTMLInputElement)
      .disabled
  ).toBe(true);
  await click("storyCover.retrySave");
  expect(h.save).toHaveBeenCalledWith(command, expect.any(AbortSignal));
});
it("disables editing for readers", async () => {
  h.load.mockResolvedValue({
    project: { ...project, capabilities: ["story.read"] },
    pending: null,
  });
  await reopen();
  await click("storyListing.save");
  expect(h.save).not.toHaveBeenCalled();
  expect(
    (host.querySelector('input[aria-label="storyListing.description"]') as HTMLInputElement)
      .disabled
  ).toBe(true);
});

it("selects a trailer and preserves screenshot order through reordering", async () => {
  const ids = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ];
  h.media.mockResolvedValue(
    ids.map((id, index) => ({
      asset: {
        id,
        kind: index === 2 ? "video" : "image",
        status: "ready",
        moderationStatus: "approved",
        contentType: index === 2 ? "video/mp4" : "image/png",
        previewUrl: "https://example.com/media",
      },
    }))
  );
  await reopen();
  await click("storyListing.selectScreenshot 1");
  await click("storyListing.selectScreenshot 2");
  await click("storyListing.selectTrailer 3");
  await click("storyListing.down");
  await click("storyListing.save");
  expect(h.save.mock.calls[0][0].storeListing).toMatchObject({
    trailerAssetId: ids[2],
    screenshotAssetIds: [ids[1], ids[0]],
  });
});
it("shows the exact pending values when no unsent draft remains", async () => {
  const value = {
    description: "Pending description",
    developer: "Owner",
    tags: [],
    trailerAssetId: null,
    screenshotAssetIds: [],
  };
  h.load.mockResolvedValue({
    project,
    pending: { clientKey: "pending", expectedProjectVersion: 4, storeListing: value },
  });
  await reopen();
  expect(
    (host.querySelector('input[aria-label="storyListing.description"]') as HTMLInputElement).value
  ).toBe("Pending description");
});
