vi.mock("./story-repair-sheet", () => ({ StoryRepairSheet: () => <span>Repair sheet</span> }));
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoryProjectHeaderActions } from "./story-project-header-actions";
const h = vi.hoisted(() => ({
  generation: 1,
  failed: false,
  errorKind: "service" as "auth" | "permission" | "service",
  login: vi.fn(),
  active: true,
  published: false,
  capabilities: ["story.read", "story.release", "story.edit", "story.build"],
  retry: vi.fn(),
  alert: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  offline: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/auth", () => ({
  useAuth: () => ({ generation: h.generation, user: { id: "user" } }),
  useAuthGate: () => ({ openLogin: h.login }),
}));
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
    chapterId: "11111111-1111-4111-8111-111111111111",
    capabilities: h.capabilities,
    draftRevision: 1,
    videoSnapshotHash: "a".repeat(64),
    loading: false,
    publication: h.published ? { gameId: "film", status: "published", rejectReason: null } : null,
    publicationLoading: false,
    publicationFailed: h.failed,
    publicationErrorKind: h.errorKind,
    publicationError: h.failed ? "Status read failed" : undefined,
    refreshPublication: h.retry,
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
  IconSitemap: () => null,
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
  h.failed = false;
  h.errorKind = "service";
  h.active = true;
  h.published = false;
  h.capabilities = ["story.read", "story.release", "story.edit", "story.build"];
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

it("opens status failure details and offers explicit retry", async () => {
  h.failed = true;
  await act(async () => root.render(<StoryProjectHeaderActions projectId="project" />));
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="agent.publish.retryStatus"]')!.click()
  );
  const [title, message, actions] = h.alert.mock.calls.at(-1)!;
  expect(title).toBe("agent.publish.statusUnavailable");
  expect(message).toContain("Status read failed");
  actions.find((action: { text: string }) => action.text === "agent.publish.retryStatus").onPress();
  expect(h.retry).toHaveBeenCalledOnce();
  expect(h.prepare).not.toHaveBeenCalled();
});

it("rejects the old confirmation when the retained header switches projects", async () => {
  await mount();
  const confirm = await confirmation();
  await act(async () => root.render(<StoryProjectHeaderActions projectId="other" />));
  await act(async () => confirm());
  expect(h.prepare).not.toHaveBeenCalled();
});
it("retires confirmation after permission loss", async () => {
  await mount();
  const confirm = await confirmation();
  h.capabilities = [];
  await mount();
  await act(async () => confirm());
  expect(h.prepare).not.toHaveBeenCalled();
});
it("aborts preparation when the retained screen loses focus", async () => {
  h.prepare.mockImplementation(() => new Promise(() => {}));
  await mount();
  const confirm = await confirmation();
  await act(async () => confirm());
  const signal = h.prepare.mock.calls[0][2] as AbortSignal;
  h.active = false;
  await mount();
  expect(signal.aborted).toBe(true);
});
it("an abandoned operation cannot unlock another project's active request", async () => {
  let rejectOld!: (error: Error) => void;
  h.prepare
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        })
    )
    .mockImplementation(() => new Promise(() => {}));
  await mount();
  const first = await confirmation();
  await act(async () => first());
  await act(async () => root.render(<StoryProjectHeaderActions projectId="other" />));
  const next = await confirmation();
  await act(async () => next());
  await act(async () => rejectOld(Error("Retired request")));
  await act(async () => next());
  expect(h.prepare).toHaveBeenCalledTimes(2);
  expect(h.alert.mock.calls.some((call) => call[1] === "Retired request")).toBe(false);
});

it("ignores an offline confirmation retained from another project", async () => {
  h.published = true;
  await mount();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="agent.publish.offline.action"]')!.click()
  );
  const confirm = h.alert.mock.calls.at(-1)![2][1].onPress;
  await act(async () => root.render(<StoryProjectHeaderActions projectId="other" />));
  await act(async () => confirm());
  expect(h.offline).not.toHaveBeenCalled();
});
it("supports a fresh confirmation after Strict Mode effect replay", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <StoryProjectHeaderActions projectId="film" />
      </StrictMode>
    )
  );
  const confirm = await confirmation();
  await act(async () => confirm());
  expect(h.submit).toHaveBeenCalledOnce();
});

it("refreshes status after an uncertain submission without claiming success", async () => {
  h.submit.mockRejectedValueOnce(Error("Submission could not be verified"));
  await mount();
  const confirm = await confirmation();
  await act(async () => confirm());
  expect(h.retry).toHaveBeenCalledOnce();
  expect(h.set).not.toHaveBeenCalled();
  expect(h.alert.mock.calls.some((call) => call[0] === "agent.publish.successTitle")).toBe(false);
});
it("refreshes status after an uncertain offline operation", async () => {
  h.published = true;
  h.offline.mockRejectedValueOnce(Error("Offline could not be verified"));
  await mount();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="agent.publish.offline.action"]')!.click()
  );
  const confirm = h.alert.mock.calls.at(-1)![2][1].onPress;
  await act(async () => confirm());
  expect(h.retry).toHaveBeenCalledOnce();
  expect(h.set).not.toHaveBeenCalled();
});

it("shows published status to readers without publish or offline controls", async () => {
  h.capabilities = ["story.read"];
  h.published = true;
  await mount();
  expect(host.textContent).toContain("agent.publish.status.published");
  expect(host.querySelector('button[aria-label="agent.publish.action"]')).toBeNull();
  expect(host.querySelector('button[aria-label="agent.publish.offline.action"]')).toBeNull();
});

it("offers sign-in for authentication errors without starting a release", async () => {
  h.failed = true;
  h.errorKind = "auth";
  await mount();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="agent.publish.retryStatus"]')!.click()
  );
  const actions = h.alert.mock.calls.at(-1)![2];
  actions.find((action: { text: string }) => action.text === "agent.publish.signIn").onPress();
  expect(h.login).toHaveBeenCalledOnce();
  expect(h.submit).not.toHaveBeenCalled();
});

it.each([
  [401, "auth"],
  [403, "permission"],
  [503, "service"],
] as const)(
  "explains publication action failure %s without replaying writes",
  async (status, kind) => {
    h.submit.mockRejectedValue(Object.assign(new Error("Backend detail"), { status }));
    await mount();
    const confirm = await confirmation();
    await act(async () => confirm());
    const [, message, buttons] = h.alert.mock.calls.at(-1)!;
    expect(message).toBe(`agent.publish.actionError.${kind}\n\nBackend detail`);
    expect(h.submit).toHaveBeenCalledOnce();
    expect(h.retry).toHaveBeenCalledOnce();
    const login = buttons.find((b: { text: string }) => b.text === "agent.publish.signIn");
    if (kind === "auth") {
      await act(async () => login.onPress());
      expect(h.login).toHaveBeenCalledOnce();
      expect(h.submit).toHaveBeenCalledOnce();
    } else expect(login).toBeUndefined();
  }
);

it("keeps snapshot conflict repair details without generic service guidance", async () => {
  h.prepare.mockRejectedValue(
    Object.assign(new Error("Refresh the changed snapshot"), { status: 409 })
  );
  await mount();
  const confirm = await confirmation();
  await act(async () => confirm());
  expect(h.alert.mock.calls.at(-1)![1]).toBe("Refresh the changed snapshot");
  expect(h.submit).not.toHaveBeenCalled();
});

it("explains offline permission failures and refreshes status without repeating the mutation", async () => {
  h.published = true;
  h.offline.mockRejectedValue(Object.assign(new Error("Release role revoked"), { status: 403 }));
  await mount();
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('button[aria-label="agent.publish.offline.action"]')!
      .click()
  );
  await act(async () => h.alert.mock.calls.at(-1)![2][1].onPress());
  expect(h.alert.mock.calls.at(-1)![1]).toBe(
    "agent.publish.actionError.permission\n\nRelease role revoked"
  );
  expect(h.offline).toHaveBeenCalledOnce();
  expect(h.retry).toHaveBeenCalledOnce();
});

it("shows every actionable release diagnostic and does not submit a failed candidate", async () => {
  h.prepare.mockRejectedValue(
    Object.assign(new Error("Missing first video"), {
      status: 422,
      responseBody: JSON.stringify({
        chapterId: "11111111-1111-4111-8111-111111111111",
        diagnostics: [
          { message: "Missing first video", nodeId: "clip:first" },
          { message: "Choice target is missing", nodeId: "decision:second" },
        ],
      }),
    })
  );
  await mount();
  const confirm = await confirmation();
  await act(async () => confirm());
  expect(h.alert.mock.calls.at(-1)![1]).toBe("Missing first video\n\nChoice target is missing");
  expect(h.submit).not.toHaveBeenCalled();
  expect(h.retry).toHaveBeenCalledOnce();
});

it.each(["clip:a", null])(
  "keeps repair usable after publication controls remount for diagnostic node %s",
  async (nodeId) => {
    h.prepare.mockRejectedValue(
      Object.assign(new Error("Broken target"), {
        status: 422,
        responseBody: JSON.stringify({
          chapterId: "11111111-1111-4111-8111-111111111111",
          diagnostics: [{ message: "Broken target", nodeId }],
        }),
      })
    );
    await mount();
    const confirm = await confirmation();
    await act(async () => confirm());
    const repair = h.alert.mock.calls
      .at(-1)![2]
      .find((b: { text: string }) => b.text === "storyRepair.title").onPress;
    h.failed = true;
    await mount();
    await act(async () => repair());
    expect(host.textContent).toContain("Repair sheet");
  }
);

it("shows preflight validation issues without opening an unscoped chapter or submitting", async () => {
  h.prepare.mockRejectedValue(
    Object.assign(new Error("Complete the saved story"), {
      status: 422,
      responseBody: JSON.stringify({
        code: "STORY_BUILD_DRAFT_NOT_BUILDABLE",
        issues: [{ path: ["graph", "nodes", 0, "next"], message: "Connect this scene" }],
      }),
    })
  );
  await mount();
  const confirm = await confirmation();
  await act(async () => confirm());
  const alert = h.alert.mock.calls.at(-1)!;
  expect(alert[1]).toBe("Complete the saved story\n\nConnect this scene");
  expect(alert[2].some((button: { text: string }) => button.text === "storyRepair.title")).toBe(
    false
  );
  expect(h.submit).not.toHaveBeenCalled();
  expect(h.retry).toHaveBeenCalledOnce();
});

it("opens the current chapter graph without requiring publication or a release role", async () => {
  h.capabilities = ["story.read"];
  await mount();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="storyNode.open"]')!.click()
  );
  expect(host.textContent).toContain("Repair sheet");
  expect(h.prepare).not.toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
});
