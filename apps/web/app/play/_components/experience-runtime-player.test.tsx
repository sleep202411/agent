import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { initializeExperienceRuntime } from "@repo/experience-engine";
import { scenePlaybackSignature } from "../../../../../packages/experience-player-react/src/experience-playback-checkpoint";
import type { ExperienceRuntimeManifest, ExperienceScene } from "@repo/shared/experience-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExperienceRuntimePlayer } from "./experience-runtime-player";
import { ApiRequestError } from "@/src/lib/api/api-client";
import { getStorySaveChannel } from "@/src/lib/story-saves";

const h = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    latest: vi.fn(),
    chapter: vi.fn(),
    clear: vi.fn(),
    put: vi.fn(),
    checkpoint: null as
      | null
      | ((
          checkpoint: { state: unknown; events: unknown[]; playback?: unknown },
          reason: "progress" | "transition" | "pause" | "seek" | "access"
        ) => void),
    accessCheckpoint: null as
      | null
      | ((checkpoint: { state: unknown; events: unknown[]; playback?: unknown }) => void),
    user: { id: "account-a" } as { id: string } | null,
    isLoading: false,
    isFetched: true,
    t: (key: string) => key,
    replace,
    router: { replace },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => h.router,
  usePathname: () => "/en-US/play/interactive-film/work",
}));
vi.mock("@/src/lib/api/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/api/api-client")>();
  const slot = (path: string) => {
    const url = new URL(path, "http://localhost");
    return [
      decodeURIComponent(url.pathname.split("/")[3]!),
      url.searchParams.get("chapterId") ?? "",
    ] as const;
  };
  return {
    ...actual,
    api: {
      get: async (path: string, config: { signal: AbortSignal }) => {
        const [gameId, chapterId] = slot(path);
        if (path.endsWith("/latest")) return h.latest(gameId, config.signal);
        const result = await h.chapter(gameId, chapterId, config.signal);
        if (result && "save" in result) return result;
        return { save: result ? { ...result, chapterId } : null, revision: result?.revision ?? 0 };
      },
      put: async (
        path: string,
        config: { data: { expectedRevision: number }; signal: AbortSignal; keepalive: boolean }
      ) => {
        const [gameId, chapterId] = slot(path);
        const result = await h.put(gameId, chapterId, config.data, config.signal, config.keepalive);
        return (
          result ?? {
            saved: true,
            updatedAt: "2026-10-04T12:00:00Z",
            revision: config.data.expectedRevision + 1,
          }
        );
      },
      delete: async (
        path: string,
        config: { params: { expectedRevision: number }; signal: AbortSignal }
      ) => {
        const [gameId, chapterId] = slot(path);
        const result = await h.clear(
          gameId,
          chapterId,
          config.signal,
          config.params.expectedRevision
        );
        return result ?? { cleared: true, revision: config.params.expectedRevision + 1 };
      },
    },
  };
});
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.user, isLoading: h.isLoading, isFetched: h.isFetched }),
}));
vi.mock("./story-community-access", () => ({
  useStoryCommunityAccess: () => ({ access: () => true, dialog: null }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => h.t }));
vi.mock("@/src/lib/play-session-reporter.http", () => ({
  createHttpPlaySessionReporter: () => ({}),
}));
vi.mock("@/src/lib/region/features", () => ({ hasFeature: () => false }));
vi.mock("../interactive-film/_components/play-session-report", () => ({
  PlaySessionReportView: () => null,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: React.ComponentProps<"a">) => <a href={String(href)}>{children}</a>,
}));
vi.mock("@repo/experience-player-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/experience-player-react")>()),
  ExperiencePlayer: ({
    accessCheckpoint,
    onCheckpoint,
    onAccessCheckpoint,
    playbackStatus,
  }: {
    accessCheckpoint?: {
      state: { currentSceneId: string };
      playback?: { sceneTimeMs: number; rate: number };
    };
    playbackStatus?: React.ReactNode;
    onCheckpoint: typeof h.checkpoint;
    onAccessCheckpoint: typeof h.accessCheckpoint;
  }) => {
    h.checkpoint = onCheckpoint;
    h.accessCheckpoint = onAccessCheckpoint;
    return (
      <>
        <div
          data-testid="player"
          data-restored-scene={accessCheckpoint?.state.currentSceneId ?? ""}
          data-restored-time={accessCheckpoint?.playback?.sceneTimeMs ?? ""}
          data-restored-rate={accessCheckpoint?.playback?.rate ?? ""}
        />
        {playbackStatus}
      </>
    );
  },
}));

const runtime = {
  gameId: "work",
  buildId: "build-new",
  contentVersion: "chapter-release-new",
  graph: {
    entrySceneId: "scene-one",
    nodes: [
      {
        kind: "scene",
        sceneId: "scene-one",
        clock: { kind: "none" },
        renderers: [],
        gestures: [],
        timeline: { cues: [] },
        anchors: [],
        eventBindings: [],
      },
    ],
  },
  assets: [],
  stateDefinitions: [],
  endings: [],
} as unknown as ExperienceRuntimeManifest;
const checkpoint = initializeExperienceRuntime(runtime);
const playback = {
  version: 1,
  sceneId: "scene-one",
  sceneSignature: scenePlaybackSignature(runtime.graph.nodes[0] as ExperienceScene),
  sceneTimeMs: 12340,
  cursor: { sceneId: "scene-one", positionMs: 12340, firedOnceCueIds: [] },
  openRendererIds: [],
  settledGestureIds: [],
  parkedEvents: [],
  media: [],
  playbackEnabled: false,
  fixedClockEnded: false,
  rate: 1.5,
};
const save = {
  gameId: "work",
  chapterId: "chapter-one",
  contentVersion: "chapter-release-old",
  state: checkpoint,
  events: [],
  updatedAt: "2026-10-04T09:00:00Z",
  revision: 4,
};
const availableChapterIds = ["chapter-one", "chapter-two"];

let session = 0;
describe("published chapter save resolution", () => {
  let root: Root, container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    h.latest.mockReset().mockResolvedValue(save);
    h.chapter.mockReset().mockResolvedValue(save);
    h.clear.mockReset().mockResolvedValue(undefined);
    h.replace.mockReset();
    h.put.mockReset().mockResolvedValue(undefined);
    h.user = { id: "account-a" };
    h.isLoading = false;
    h.isFetched = true;
    h.checkpoint = null;
    h.accessCheckpoint = null;
    sessionStorage.clear();
    document.cookie = `satoken=session-${++session}; path=/`;
    window.history.replaceState(null, "", "/en-US/play/interactive-film/work");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    document.cookie = "satoken=; max-age=0; path=/";
  });
  async function render() {
    await act(async () =>
      root.render(
        <ExperienceRuntimePlayer
          runtime={runtime}
          locale="en-US"
          randomSeed="test"
          chapterId="chapter-one"
          availableChapterIds={availableChapterIds}
        />
      )
    );
  }
  it("does not redirect into a chapter removed from the current release or erase its save", async () => {
    h.latest.mockResolvedValue({ ...save, chapterId: "removed-chapter" });
    await render();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "saveChapterUnavailable"
    );
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
  });
  it("continues an older compatible snapshot using the existing engine validation", async () => {
    await render();
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-scene")
    ).toBe("scene-one");
    expect(h.clear).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
  });
  it("redirects to an existing saved chapter even when that chapter release version changed", async () => {
    h.latest.mockResolvedValue({ ...save, chapterId: "chapter-two" });
    await render();
    expect(h.replace).toHaveBeenCalledWith("/en-US/play/interactive-film/work?chapter=chapter-two");
    expect(h.clear).not.toHaveBeenCalled();
  });
  it("keeps an incompatible checkpoint until the player explicitly starts over", async () => {
    h.chapter.mockResolvedValue({
      ...save,
      state: { ...checkpoint, currentSceneId: "deleted-scene" },
    });
    await render();
    expect(h.clear).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "saveStateUnavailable"
    );
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
  });
  it("does not start a fresh run when an explicit restart cannot clear the saved progress", async () => {
    window.history.replaceState(null, "", "/en-US/play/interactive-film/work?restart=1");
    h.clear.mockRejectedValue(new Error("Delete failed"));
    await render();
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Delete failed");
    expect(window.location.search).toContain("restart=1");
  });
  it("resolves a new chapter before mounting the player when navigating within the same game", async () => {
    await render();
    expect(container.querySelector('[data-testid="player"]')).not.toBeNull();
    window.history.replaceState(null, "", "/en-US/play/interactive-film/work?chapter=chapter-two");
    h.chapter.mockReturnValue(new Promise(() => {}));
    await act(async () =>
      root.render(
        <ExperienceRuntimePlayer
          runtime={{ ...runtime, buildId: "build-two", contentVersion: "chapter-two-new" }}
          locale="en-US"
          randomSeed="test"
          chapterId="chapter-two"
          availableChapterIds={availableChapterIds}
        />
      )
    );
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
  });
  it("conditionally clears each affected chapter before an explicit restart", async () => {
    let finish!: () => void;
    h.latest.mockResolvedValue({ ...save, chapterId: "removed-chapter" });
    h.clear.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(h.clear.mock.calls.map((call) => call[1])).toEqual(["chapter-one"]);
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    await act(async () => finish());
    expect(h.clear.mock.calls.map((call) => call[1])).toEqual(["chapter-one", "removed-chapter"]);
    expect(h.clear.mock.calls.map((call) => call[3])).toEqual([4, 4]);
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-scene")
    ).toBe("");
  });
  it("retries a failed explicit restart and clears the latest removed chapter before starting", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/en-US/play/interactive-film/work?restart=1");
    h.latest.mockResolvedValue({ ...save, chapterId: "removed-chapter" });
    h.clear.mockRejectedValueOnce(new Error("Delete failed"));
    await render();
    expect(container.textContent).toContain("Delete failed");
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(container.querySelector('[data-testid="player"]')).not.toBeNull();
    expect(window.location.search).toBe("");
    expect(h.clear.mock.calls.map((call) => call[1])).toContain("removed-chapter");
  });
  it("preserves the restart intent and shows a lookup failure instead of clearing an unknown slot", async () => {
    window.history.replaceState(null, "", "/en-US/play/interactive-film/work?restart=1");
    h.latest.mockRejectedValue(new Error("Save lookup failed"));
    await render();
    expect(container.textContent).toContain("Save lookup failed");
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    expect(h.clear).not.toHaveBeenCalled();
    expect(window.location.search).toContain("restart=1");
  });
  it("replaces account A's checkpoint before resolving account B's progress", async () => {
    await render();
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-scene")
    ).toBe("scene-one");
    h.user = { id: "account-b" };
    document.cookie = "satoken=session-b; path=/";
    h.latest.mockReturnValue(new Promise(() => {}));
    await render();
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    expect(h.latest).toHaveBeenCalledTimes(2);
    expect(h.latest.mock.calls[0]?.[1]?.aborted).toBe(true);
  });
  it("does not issue the old account's queued deletion after its cookie changes", async () => {
    let finish!: () => void;
    window.history.replaceState(null, "", "/en-US/play/interactive-film/work?restart=1");
    h.latest.mockResolvedValue({ ...save, chapterId: "chapter-two" });
    h.clear.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    await render();
    expect(h.clear).toHaveBeenCalledOnce();
    document.cookie = "satoken=session-b; path=/";
    await act(async () => finish());
    expect(h.clear).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    h.user = { id: "account-b" };
    h.latest.mockResolvedValue(null);
    h.chapter.mockResolvedValue(null);
    await render();
    expect(h.clear).toHaveBeenCalledOnce();
    expect(window.location.search).toBe("");
  });
  it("prevents account A's queued writes and pagehide flush from reaching account B", async () => {
    vi.useFakeTimers();
    await render();
    await act(async () => {
      h.checkpoint?.({ state: { ...checkpoint, status: "active" }, events: [] }, "progress");
      h.checkpoint?.({ state: { ...checkpoint, marker: "new" }, events: [] }, "progress");
    });
    expect(h.put).toHaveBeenCalledOnce();
    const oldState = h.checkpoint;
    h.user = { id: "account-b" };
    document.cookie = "satoken=session-b; path=/";
    h.latest.mockResolvedValue(null);
    h.chapter.mockResolvedValue(null);
    await render();
    await act(async () => {
      oldState?.({ state: checkpoint, events: [] }, "pause");
      vi.advanceTimersByTime(3000);
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(h.put).toHaveBeenCalledOnce();
    expect(h.put.mock.calls[0]?.[3]?.aborted).toBe(true);
  });
  it("keeps anonymous playback local and namespaces recharge checkpoints after sign-in", async () => {
    h.user = null;
    await render();
    expect(h.latest).not.toHaveBeenCalled();
    await act(async () => {
      h.checkpoint?.({ state: checkpoint, events: [] }, "progress");
      h.accessCheckpoint?.({ state: checkpoint, events: [] });
    });
    expect(h.put).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("story-access-resume:work:build-new:anonymous")).not.toBeNull();
    h.user = { id: "account-a" };
    h.latest.mockResolvedValue(null);
    h.chapter.mockResolvedValue(null);
    await render();
    await act(async () => {
      h.accessCheckpoint?.({ state: checkpoint, events: [] });
      h.checkpoint?.({ state: checkpoint, events: [] }, "access");
    });
    expect(sessionStorage.getItem("story-access-resume:work:build-new:account-a")).not.toBeNull();
    expect(h.put).toHaveBeenCalledOnce();
  });
  it("waits for the account lookup instead of starting an anonymous run during authentication", async () => {
    h.user = null;
    h.isLoading = true;
    h.isFetched = false;
    await render();
    expect(container.textContent).toBe("starting");
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    expect(h.latest).not.toHaveBeenCalled();
    h.user = { id: "account-a" };
    h.isLoading = false;
    h.isFetched = true;
    await render();
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-scene")
    ).toBe("scene-one");
  });
  it("keeps progress untouched after a failed save read and restores it after retry", async () => {
    h.latest.mockRejectedValueOnce(new Error("Save service HTTP 503")).mockResolvedValueOnce(save);
    await render();
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Save service HTTP 503"
    );
    expect(h.put).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-scene")
    ).toBe("scene-one");
    expect(h.latest).toHaveBeenCalledTimes(2);
  });
  it("does not bootstrap again when the same published runtime and chapter table arrive as new objects", async () => {
    await render();
    await act(async () =>
      root.render(
        <ExperienceRuntimePlayer
          runtime={{ ...runtime }}
          locale="en-US"
          randomSeed="test"
          chapterId="chapter-one"
          availableChapterIds={[...availableChapterIds]}
        />
      )
    );
    expect(h.latest).toHaveBeenCalledOnce();
  });
  it("finishes an explicit restart across StrictMode's cancelled initial effect", async () => {
    window.history.replaceState(null, "", "/en-US/play/interactive-film/work?restart=1");
    await act(async () =>
      root.render(
        <StrictMode>
          <ExperienceRuntimePlayer
            runtime={runtime}
            locale="en-US"
            randomSeed="test"
            chapterId="chapter-one"
            availableChapterIds={availableChapterIds}
          />
        </StrictMode>
      )
    );
    expect(h.clear).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="player"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(window.location.search).toBe("");
  });
  it("retains the newest queued progress when an older write rejects", async () => {
    vi.useFakeTimers();
    let rejectOld!: (error: Error) => void;
    h.put.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectOld = reject;
      })
    );
    await render();
    await act(async () => {
      h.checkpoint?.({ state: { ...checkpoint, status: "active" }, events: [] }, "progress");
      h.checkpoint?.({ state: { ...checkpoint, marker: "new" }, events: [] }, "progress");
    });
    await act(async () => rejectOld(new Error("Write failed")));
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(h.put.mock.calls[1]?.[2]?.state).toEqual({ ...checkpoint, marker: "new" });
    expect(h.put.mock.calls[1]?.[4]).toBe(true);
  });
  it("serializes forced checkpoint writes so an older request cannot arrive after newer progress", async () => {
    let resolveOld!: () => void;
    h.put.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveOld = resolve;
      })
    );
    await render();
    await act(async () => {
      h.checkpoint?.({ state: checkpoint, events: [] }, "progress");
    });
    await act(async () =>
      h.checkpoint?.({ state: checkpoint, events: [{ type: "latest-gate" }] }, "access")
    );
    expect(h.put).toHaveBeenCalledOnce();
    await act(async () => resolveOld());
    expect(h.put).toHaveBeenCalledTimes(2);
    expect(h.put.mock.calls[1]?.[2]?.events).toEqual([{ type: "latest-gate" }]);
  });
  it("restores seconds, pause and speed from a compatible republished checkpoint", async () => {
    h.chapter.mockResolvedValue({ ...save, playback });
    await render();
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-time")
    ).toBe("12340");
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-rate")
    ).toBe("1.5");
    expect(h.put).not.toHaveBeenCalled();
  });
  it("preserves a seconds checkpoint when its media or scene no longer matches", async () => {
    h.chapter.mockResolvedValue({ ...save, playback: { ...playback, sceneSignature: "changed" } });
    await render();
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    expect(container.textContent).toContain("saveStateUnavailable");
    expect(h.put).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
  });
  it("merges playback progress for three seconds but saves a seek immediately", async () => {
    vi.useFakeTimers();
    await render();
    expect(h.put).not.toHaveBeenCalled();
    await act(async () => h.checkpoint?.({ state: checkpoint, events: [], playback }, "progress"));
    expect(h.put).toHaveBeenCalledOnce();
    await act(async () => {
      h.checkpoint?.(
        { state: checkpoint, events: [], playback: { ...playback, sceneTimeMs: 13000 } },
        "progress"
      );
      h.checkpoint?.(
        { state: checkpoint, events: [], playback: { ...playback, sceneTimeMs: 14000 } },
        "progress"
      );
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(h.put).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(h.put.mock.calls[1]?.[2]?.playback.sceneTimeMs).toBe(14000);
    await act(async () =>
      h.checkpoint?.(
        {
          state: checkpoint,
          events: [{ type: "parked" }],
          playback: { ...playback, sceneTimeMs: 10000 },
        },
        "seek"
      )
    );
    expect(h.put.mock.calls[2]?.[2]).toMatchObject({
      events: [{ type: "parked" }],
      playback: { sceneTimeMs: 10000 },
      expectedRevision: 6,
    });
  });
  it("shows an upstream save failure and only reports saved after its retry succeeds", async () => {
    h.put.mockRejectedValueOnce(new Error("Save database unavailable"));
    await render();
    await act(async () => h.checkpoint?.({ state: checkpoint, events: [], playback }, "pause"));
    expect(container.textContent).toContain("Save database unavailable");
    expect(container.textContent).not.toContain("saveSaved");
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(container.textContent).toContain("saveSaved");
    expect(container.textContent).not.toContain("Save database unavailable");
    expect(h.put.mock.calls[1]?.[2]).toMatchObject({ playback, expectedRevision: 4 });
  });
  it("does not overwrite a cross-device conflict and reloads the saved checkpoint only by choice", async () => {
    h.put.mockRejectedValueOnce(
      new ApiRequestError("SAVE_CONFLICT", "Newer device progress exists", 409)
    );
    await render();
    await act(async () => h.checkpoint?.({ state: checkpoint, events: [], playback }, "pause"));
    expect(container.textContent).toContain("Newer device progress exists");
    expect(container.textContent).toContain("saveConflictHint");
    await act(async () => {
      h.checkpoint?.(
        { state: checkpoint, events: [], playback: { ...playback, sceneTimeMs: 999 } },
        "seek"
      );
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(h.put).toHaveBeenCalledOnce();
    const remote = {
      ...save,
      revision: 7,
      playback: {
        ...playback,
        sceneTimeMs: 16000,
        cursor: { ...playback.cursor, positionMs: 16000 },
      },
    };
    h.latest.mockResolvedValue(remote);
    h.chapter.mockResolvedValue(remote);
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-time")
    ).toBe("16000");
    expect(h.put).toHaveBeenCalledOnce();
    await act(async () => h.checkpoint?.({ state: checkpoint, events: [], playback }, "pause"));
    expect(h.put.mock.calls[1]?.[2]?.expectedRevision).toBe(7);
  });
  it("carries seconds and parked events through the recharge-return checkpoint", async () => {
    await render();
    await act(async () => h.accessCheckpoint?.({ state: checkpoint, events: [], playback }));
    expect(
      JSON.parse(sessionStorage.getItem("story-access-resume:work:build-new:account-a")!).playback
    ).toEqual(playback);
    await act(async () => root.render(null));
    window.history.replaceState(null, "", "/en-US/play/interactive-film/work?recharge=1");
    await render();
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-time")
    ).toBe("12340");
    expect(h.put).not.toHaveBeenCalled();
  });
  it("waits for a prior SPA view's final write before restoring the same slot", async () => {
    let finish!: () => void;
    h.put.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await render();
    await act(async () => h.checkpoint?.({ state: checkpoint, events: [], playback }, "progress"));
    await act(async () => root.render(null));
    h.latest.mockClear();
    await render();
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    expect(h.latest).not.toHaveBeenCalled();
    h.latest.mockResolvedValue({ ...save, revision: 5, playback });
    h.chapter.mockResolvedValue({ ...save, revision: 5, playback });
    await act(async () => finish());
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-time")
    ).toBe("12340");
  });
  function coldRecharge(revision: number | undefined = 4) {
    sessionStorage.setItem(
      "story-access-resume:work:build-new:account-a",
      JSON.stringify({
        state: checkpoint,
        events: [],
        playback,
        contentVersion: runtime.contentVersion,
        ...(revision === undefined ? {} : { saveRevision: revision }),
      })
    );
    // Discard the module writer, as a new document after top-up would do.
    getStorySaveChannel("cold-document-reset", "work", "chapter-one");
    window.history.replaceState(null, "", "/en-US/play/interactive-film/work?recharge=1");
  }
  it("reads a cold recharge return's base revision before resuming its local gate checkpoint", async () => {
    coldRecharge();
    h.chapter.mockResolvedValue({ ...save, playback: null });
    await render();
    expect(h.chapter).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-time")
    ).toBe("12340");
    await act(async () => h.checkpoint?.({ state: checkpoint, events: [], playback }, "pause"));
    expect(h.put.mock.calls[0]?.[2]?.expectedRevision).toBe(4);
  });
  it("accepts a cold recharge checkpoint whose own write was acknowledged at n + 1", async () => {
    coldRecharge();
    h.chapter.mockResolvedValue({
      ...save,
      contentVersion: runtime.contentVersion,
      revision: 5,
      playback: Object.fromEntries(Object.entries(playback).reverse()),
    });
    await render();
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-time")
    ).toBe("12340");
    expect(h.put).not.toHaveBeenCalled();
    await act(async () => h.checkpoint?.({ state: checkpoint, events: [], playback }, "pause"));
    expect(h.put.mock.calls[0]?.[2]?.expectedRevision).toBe(5);
  });
  it("blocks a cold recharge bridge from overwriting different progress at n + 1", async () => {
    coldRecharge();
    const remote = {
      ...save,
      contentVersion: runtime.contentVersion,
      revision: 5,
      playback: { ...playback, sceneTimeMs: 15000 },
    };
    h.chapter.mockResolvedValue(remote);
    await render();
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    expect(container.textContent).toContain("saveConflictHint");
    expect(h.put).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("story-access-resume:work:build-new:account-a")).not.toBeNull();
    h.latest.mockResolvedValue(remote);
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-time")
    ).toBe("15000");
    expect(h.put).not.toHaveBeenCalled();
  });
  it("does not treat later device revisions as its own recharge acknowledgement", async () => {
    coldRecharge();
    h.chapter.mockResolvedValue({
      ...save,
      contentVersion: runtime.contentVersion,
      revision: 6,
      playback,
    });
    await render();
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    expect(container.textContent).toContain("saveConflictHint");
    expect(h.put).not.toHaveBeenCalled();
  });
  it("uses an authoritative save for a legacy recharge bridge without a revision", async () => {
    coldRecharge();
    const raw = JSON.parse(sessionStorage.getItem("story-access-resume:work:build-new:account-a")!);
    delete raw.saveRevision;
    sessionStorage.setItem("story-access-resume:work:build-new:account-a", JSON.stringify(raw));
    h.chapter.mockResolvedValue({
      ...save,
      revision: 5,
      playback: { ...playback, sceneTimeMs: 16000 },
    });
    await render();
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-time")
    ).toBe("16000");
    expect(h.put).not.toHaveBeenCalled();
  });
  it("keeps a revisionless recharge checkpoint when there is no authoritative save", async () => {
    coldRecharge();
    const raw = JSON.parse(sessionStorage.getItem("story-access-resume:work:build-new:account-a")!);
    delete raw.saveRevision;
    sessionStorage.setItem("story-access-resume:work:build-new:account-a", JSON.stringify(raw));
    h.chapter.mockResolvedValue(null);
    await render();
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    expect(container.textContent).toContain("saveRechargeRevisionMissing");
    expect(h.put).not.toHaveBeenCalled();
  });
  it("preserves a cold recharge checkpoint while a failed revision read is retried", async () => {
    coldRecharge();
    h.chapter
      .mockRejectedValueOnce(new Error("Save slot HTTP 503"))
      .mockResolvedValueOnce({ ...save, playback: null });
    await render();
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    expect(container.textContent).toContain("Save slot HTTP 503");
    expect(h.put).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("story-access-resume:work:build-new:account-a")).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-time")
    ).toBe("12340");
    expect(sessionStorage.getItem("story-access-resume:work:build-new:account-a")).toBeNull();
  });
  it("binds the recharge bridge after an older in-flight save before its own write", async () => {
    let finishOld!: () => void;
    let finishGate!: () => void;
    h.put
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishOld = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishGate = resolve;
          })
      );
    await render();
    await act(async () =>
      h.checkpoint?.(
        { state: checkpoint, events: [], playback: { ...playback, sceneTimeMs: 1000 } },
        "progress"
      )
    );
    await act(async () => {
      h.accessCheckpoint?.({ state: checkpoint, events: [], playback });
      h.checkpoint?.({ state: checkpoint, events: [], playback }, "access");
    });
    expect(
      JSON.parse(sessionStorage.getItem("story-access-resume:work:build-new:account-a")!)
        .saveRevision
    ).toBe(4);
    await act(async () => finishOld());
    expect(h.put).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(sessionStorage.getItem("story-access-resume:work:build-new:account-a")!)
        .saveRevision
    ).toBe(5);
    await act(async () => finishGate());
    expect(
      JSON.parse(sessionStorage.getItem("story-access-resume:work:build-new:account-a")!)
        .saveRevision
    ).toBe(6);
    await act(async () => root.render(null));
    getStorySaveChannel("cold-document-reset", "work", "chapter-one");
    h.chapter.mockResolvedValue({
      ...save,
      contentVersion: runtime.contentVersion,
      revision: 6,
      playback,
    });
    window.history.replaceState(null, "", "/en-US/play/interactive-film/work?recharge=1");
    await render();
    expect(
      container.querySelector('[data-testid="player"]')?.getAttribute("data-restored-time")
    ).toBe("12340");
    expect(h.put).toHaveBeenCalledTimes(2);
  });
  it("resolves a renewed session for the same account instead of silently rejecting every later save", async () => {
    await render();
    const oldCheckpoint = h.checkpoint;
    document.cookie = "satoken=renewed-session; path=/";
    let resolveRead!: (value: typeof save) => void;
    h.latest.mockImplementationOnce(
      () =>
        new Promise<typeof save>((resolve) => {
          resolveRead = resolve;
        })
    );
    await render();
    expect(container.querySelector('[data-testid="player"]')).toBeNull();
    expect(h.latest).toHaveBeenCalledTimes(2);
    await act(async () => oldCheckpoint?.({ state: checkpoint, events: [], playback }, "pause"));
    expect(h.put).not.toHaveBeenCalled();
    await act(async () => resolveRead(save));
    await act(async () => h.checkpoint?.({ state: checkpoint, events: [], playback }, "pause"));
    expect(h.put).toHaveBeenCalledOnce();
    expect(h.put.mock.calls[0]?.[2]?.expectedRevision).toBe(4);
  });
});
