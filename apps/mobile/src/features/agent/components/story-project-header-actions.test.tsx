import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoryProjectHeaderActions } from "./story-project-header-actions";
const h = vi.hoisted(() => ({
  generation: 1,
  alert: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  offline: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@/auth", () => ({ useAuth: () => ({ generation: h.generation }) }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/features/agent/api/story-production-api", () => ({
  fillMessageTemplate: (s: string) => s,
}));
vi.mock("@/features/agent/api/interactive-film-publication-api", () => ({
  prepareInteractiveFilmRelease: h.prepare,
  submitInteractiveFilmRelease: h.submit,
  offlineInteractiveFilm: h.offline,
}));
vi.mock("@/features/agent/context/story-chapter-context", () => ({
  useStoryChapterContext: () => ({
    capabilities: ["story.release", "story.edit", "story.build"],
    draftRevision: 1,
    videoSnapshotHash: "a".repeat(64),
    loading: false,
    publication: null,
    publicationLoading: false,
    publicationFailed: false,
    setPublication: h.set,
  }),
}));
vi.mock("@tabler/icons-react-native", () => ({
  IconAlertTriangle: () => null,
  IconBolt: () => null,
  IconCheck: () => null,
  IconCloudOff: () => null,
  IconCloudUpload: () => null,
  IconLoader2: () => null,
}));
vi.mock("react-native", () => ({
  Alert: { alert: h.alert },
  StyleSheet: { create: (s: unknown) => s },
  ActivityIndicator: () => null,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children: ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
  }) => (
    <button onClick={onPress} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const mount = () => act(async () => root.render(<StoryProjectHeaderActions projectId="film" />));
async function confirmation() {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="agent.publish.action"]')!.click()
  );
  return h.alert.mock.calls.at(-1)![2][1].onPress as () => void;
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.prepare.mockResolvedValue({ gameId: "film" });
  h.submit.mockResolvedValue({ gameId: "film", status: "reviewing" });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("ignores a confirmation retained after leaving the workspace", async () => {
  await mount();
  const confirm = await confirmation();
  await act(async () => root.render(null));
  await act(async () => confirm());
  expect(h.prepare).not.toHaveBeenCalled();
});
it("ignores a confirmation retained after switching accounts", async () => {
  await mount();
  const confirm = await confirmation();
  h.generation = 2;
  await act(async () => confirm());
  expect(h.prepare).not.toHaveBeenCalled();
});
it("does not submit a prepared release after the original session ends", async () => {
  let resolve!: (v: unknown) => void;
  h.prepare.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await mount();
  const confirm = await confirmation();
  await act(async () => confirm());
  h.generation = 2;
  await act(async () => resolve({ gameId: "film" }));
  expect(h.submit).not.toHaveBeenCalled();
  expect(h.set).not.toHaveBeenCalled();
});
it("locks duplicate confirmation callbacks and applies a same-session receipt", async () => {
  await mount();
  const confirm = await confirmation();
  await act(async () => {
    confirm();
    confirm();
  });
  expect(h.prepare).toHaveBeenCalledOnce();
  expect(h.submit).toHaveBeenCalledOnce();
  expect(h.set).toHaveBeenCalledWith({ gameId: "film", status: "reviewing" });
});
it("aborts an in-flight preparation when the workspace unmounts", async () => {
  h.prepare.mockImplementation(() => new Promise(() => {}));
  await mount();
  const confirm = await confirmation();
  await act(async () => confirm());
  const signal = h.prepare.mock.calls[0][2] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  expect(h.submit).not.toHaveBeenCalled();
});
