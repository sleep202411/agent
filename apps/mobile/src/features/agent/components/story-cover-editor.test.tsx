import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryCoverEditor } from "./story-cover-editor";
const h = vi.hoisted(() => ({
  load: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  pick: vi.fn(),
  resume: vi.fn(),
  saved: vi.fn(),
}));
vi.mock("../api/story-cover-api", () => ({
  storyCover: () => h,
  usableStoryCover: (v: { kind: string; status: string } | null) =>
    v?.kind === "image" && v.status === "ready",
}));
vi.mock("../api/story-timeline-upload", () => ({
  timelineUpload: () => ({ read: () => null, pick: h.pick, resume: h.resume }),
}));
vi.mock("../api/story-timeline-media", () => ({ fetchTimelineCandidates: async () => [] }));
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
  cover: null,
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
  h.load.mockResolvedValue({ project, pending: null });
  h.read.mockReturnValue(null);
  h.pick.mockResolvedValue(candidate);
  h.save.mockResolvedValue({ ...project, projectVersion: 5, cover: candidate.asset });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <StoryCoverEditor scope={scope} userId="owner" onClose={() => {}} onSaved={h.saved} />
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("applies uploaded images immediately with the observed project version", async () => {
  await click("storyCover.upload");
  expect(h.pick).toHaveBeenCalledWith(expect.any(AbortSignal), true);
  expect(h.save).toHaveBeenCalledWith(
    { clientKey: "request", expectedProjectVersion: 4, coverAssetId: "image" },
    expect.any(AbortSignal)
  );
  expect(h.saved).toHaveBeenCalledOnce();
});
it("does not save when file selection is cancelled", async () => {
  h.pick.mockResolvedValue(null);
  await click("storyCover.upload");
  expect(h.save).not.toHaveBeenCalled();
  expect(h.saved).not.toHaveBeenCalled();
});
it("retries a failed final save without uploading the image again", async () => {
  const pending = { clientKey: "request", expectedProjectVersion: 4, coverAssetId: "image" };
  h.save.mockImplementationOnce(async () => {
    h.read.mockReturnValue(pending);
    throw Error("Lost cover reply");
  });
  await click("storyCover.upload");
  expect(host.textContent).toContain("Lost cover reply");
  await click("storyCover.retrySave");
  expect(h.pick).toHaveBeenCalledOnce();
  expect(h.save).toHaveBeenCalledTimes(2);
  expect(h.saved).toHaveBeenCalledOnce();
});
