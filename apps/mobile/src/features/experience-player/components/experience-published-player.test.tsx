import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { ExperiencePublishedPlayer } from "./experience-published-player";
import type { ExperiencePlayerProps } from "./experience-player";
import { ApiRequestError } from "@/lib/api-client";
import messages from "@/i18n/messages/en-US.json";
const h = vi.hoisted(() => ({
  generation: 0,
  account: "account" as string | null,
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  player: {} as ExperiencePlayerProps,
  onApp: (_active: boolean) => {},
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  ActivityIndicator: () => <span>Loading</span>,
  StyleSheet: { create: (styles: unknown) => styles },
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
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.account ? "authenticated" : "anonymous",
    user: { id: h.account },
    generation: h.generation,
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({
  useAppActiveChange: (callback: typeof h.onApp) => {
    h.onApp = callback;
  },
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: keyof typeof messages) => messages[key] }));
vi.mock("@/lib/api-client", () => ({
  api: h,
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("../lib/experience-save-checkpoint", () => ({
  validateExperienceSaveCheckpoint: (_manifest: unknown, source: any) => {
    if (source.state.currentSceneId === "removed") throw new Error("Incompatible");
    return {
      state: source.state,
      events: source.events,
      ...(source.playback ? { playback: source.playback } : {}),
    };
  },
}));
vi.mock("./experience-player-with-access", () => ({
  ExperiencePlayerWithAccess: (props: ExperiencePlayerProps) => {
    h.player = props;
    return (
      <div>
        <span>Player: {props.copy.start}</span>
        <button onClick={props.onRestartRequested}>Restart</button>
        <span>{props.active === false ? "Frozen" : "Active"}</span>
      </div>
    );
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const runtime = {
  gameId: "game",
  buildId: "build",
  contentVersion: "release",
} as ExperienceRuntimeManifest;
const saved = {
  gameId: "game",
  chapterId: "one",
  contentVersion: "release",
  state: { currentSceneId: "scene" },
  events: [],
  revision: 3,
  updatedAt: "2026-10-05T00:00:00Z",
};
const copy = {
  starting: "Starting",
  start: "Start",
  continue: "Continue",
  restart: "Restart",
} as ExperiencePlayerProps["copy"];
const redirect = vi.fn();
let container: HTMLDivElement;
let root: Root;
const render = (chapter = "one", explicit = true) =>
  act(async () =>
    root.render(
      <ExperiencePublishedPlayer
        runtime={runtime}
        chapterId={chapter}
        availableChapterIds={["one", "two"]}
        explicitChapter={explicit}
        onSavedChapter={redirect}
        copy={copy}
        locale="en-US"
      />
    )
  );
const click = (label: string) =>
  act(async () => {
    const target = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === label
    );
    expect(target).toBeTruthy();
    target!.click();
  });
const checkpoint = () =>
  ({ state: { currentSceneId: "scene" }, events: [] }) as unknown as Parameters<
    NonNullable<ExperiencePlayerProps["onCheckpoint"]>
  >[0];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
  h.generation++;
  h.account = "account";
  vi.clearAllMocks();
  h.get
    .mockReset()
    .mockImplementation(async (path: string, options: any) =>
      path.endsWith("latest")
        ? saved
        : { save: { ...saved, chapterId: options.params.chapterId }, revision: 3 }
    );
  h.put.mockReset().mockImplementation(async (_path: string, options: any) => ({
    saved: true,
    revision: options.data.expectedRevision + 1,
    updatedAt: saved.updatedAt,
  }));
  h.delete.mockReset().mockImplementation(async (_path: string, options: any) => ({
    cleared: true,
    revision: options.params.expectedRevision + 1,
  }));
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("resolves existing progress before mounting Continue and restores the checkpoint", async () => {
  await render();
  expect(container.textContent).toContain("Player: Continue");
  expect(h.player.entryCheckpoint?.state.currentSceneId).toBe("scene");
  expect(h.put).not.toHaveBeenCalled();
});
it("keeps anonymous playback local", async () => {
  h.account = null;
  await render();
  expect(container.textContent).toContain("Player: Start");
  await act(async () => h.player.onCheckpoint!(checkpoint(), "transition"));
  expect(h.get).not.toHaveBeenCalled();
  expect(h.put).not.toHaveBeenCalled();
});
it("keeps failed reads out of fresh playback and allows retry", async () => {
  h.get.mockRejectedValueOnce(new Error("Service unavailable"));
  await render();
  expect(container.textContent).toContain("Service unavailable");
  expect(container.textContent).not.toContain("Player:");
  await click("Retry");
  expect(container.textContent).toContain("Player: Continue");
});
it("redirects to the saved chapter when none was explicitly selected", async () => {
  h.get.mockResolvedValueOnce({ ...saved, chapterId: "two" });
  await render("one", false);
  expect(redirect).toHaveBeenCalledExactlyOnceWith("two");
  expect(container.textContent).not.toContain("Player:");
});
it("throttles progress but flushes pauses immediately with sequential revisions", async () => {
  await render();
  await act(async () => h.player.onCheckpoint!(checkpoint(), "transition"));
  await act(async () => h.player.onCheckpoint!(checkpoint(), "progress"));
  expect(h.put).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(2999));
  expect(h.put).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(1));
  expect(h.put).toHaveBeenCalledTimes(2);
  await act(async () => h.player.onCheckpoint!(checkpoint(), "pause"));
  expect(h.put).toHaveBeenCalledTimes(3);
  expect(h.put.mock.calls.map((call) => call[1].data.expectedRevision)).toEqual([3, 4, 5]);
});
it("flushes pending progress when backgrounded", async () => {
  await render();
  await act(async () => h.player.onCheckpoint!(checkpoint(), "transition"));
  await act(async () => h.player.onCheckpoint!(checkpoint(), "progress"));
  await act(async () => h.onApp(false));
  expect(h.put).toHaveBeenCalledTimes(2);
});
it("exposes write errors and retries the pending checkpoint", async () => {
  await render();
  h.put.mockRejectedValueOnce(new Error("Network offline"));
  await act(async () => h.player.onCheckpoint!(checkpoint(), "transition"));
  expect(container.textContent).toContain("Network offline");
  await click("Retry");
  expect(h.put).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain("Network offline");
});
it("requires explicit reload on conflict rather than overwriting another device", async () => {
  await render();
  h.put.mockRejectedValueOnce(new ApiRequestError("SAVE_CONFLICT", "Changed elsewhere", 409));
  await act(async () => h.player.onCheckpoint!(checkpoint(), "transition"));
  expect(container.textContent).toContain("Saved progress changed");
  expect(container.textContent).not.toContain("Player:");
  h.get.mockResolvedValue({ save: { ...saved, revision: 4 }, revision: 4 });
  await click("Reload saved progress");
  expect(container.textContent).toContain("Player: Continue");
  expect(h.put).toHaveBeenCalledTimes(1);
});
it("preserves incompatible progress until restart successfully clears its slot", async () => {
  h.get.mockResolvedValue({
    save: { ...saved, state: { currentSceneId: "removed" } },
    revision: 3,
  });
  await render();
  expect(container.textContent).toContain("Saved progress cannot continue");
  expect(h.delete).not.toHaveBeenCalled();
  h.delete.mockRejectedValueOnce(new Error("Clear failed"));
  await click("Restart");
  expect(container.textContent).toContain("Clear failed");
  expect(container.textContent).not.toContain("Player:");
  await click("Restart");
  expect(container.textContent).toContain("Player: Start");
  expect(h.delete).toHaveBeenCalledTimes(2);
});
it("clears the addressed slot before accepting a restart from the player", async () => {
  await render();
  await click("Restart");
  expect(h.delete.mock.calls[0]![1].params).toEqual({ chapterId: "one", expectedRevision: 3 });
  expect(container.textContent).toContain("Player: Start");
  expect(h.player.entryCheckpoint).toBeUndefined();
});
it("rejects old player checkpoints after a successful restart tombstone", async () => {
  await render();
  const old = h.player.onCheckpoint!;
  await click("Restart");
  await act(async () => old(checkpoint(), "transition"));
  expect(h.put).not.toHaveBeenCalled();
  await act(async () => h.player.onCheckpoint!(checkpoint(), "transition"));
  expect(h.put.mock.calls[0]![1].data.expectedRevision).toBe(4);
});
it("retires old callbacks after account replacement", async () => {
  await render();
  const old = h.player.onCheckpoint!;
  h.generation++;
  h.account = "other";
  await render();
  await act(async () => old(checkpoint(), "transition"));
  expect(h.put).not.toHaveBeenCalled();
  await act(async () => h.player.onCheckpoint!(checkpoint(), "transition"));
  expect(h.put).toHaveBeenCalledTimes(1);
});
