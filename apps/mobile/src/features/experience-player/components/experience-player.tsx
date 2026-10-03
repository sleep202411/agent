import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import {
  ExperienceRuntimeInvariantError,
  ExperienceAccessRequiredError,
  advanceExperienceTimeline,
  createExperienceTimelineCursor,
  evaluateExperienceCondition,
  isExperienceRendererVisible,
  type ExperienceEventQueueResult,
  type ExperienceRuntimeController,
  type ExperienceRuntimeEvent,
  type ExperienceRuntimeState,
  type ExperienceTimelineCursor,
} from "@repo/experience-engine";
import {
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_TEXT_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID,
  ExperienceCoreWorldModelRendererConfigSchema,
  ExperienceCoreChoiceRendererConfigSchema,
  ExperienceCoreTextRendererConfigSchema,
  ExperienceRuntimeManifestSchema,
  type ExperienceAccessRequirement,
  type ExperienceGraphNode,
  type ExperienceImageAsset,
  type ExperienceRendererInstance,
  type ExperienceRuntimeManifest,
  type ExperienceScene,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";

import { ThemedText } from "@/components/themed-text";
import { resolveExperienceAssetUrl } from "@/config";
import { Spacing } from "@/constants/theme";
import { ScreenActiveGateContext, useScreenActive } from "@/hooks/use-app-active";

import { useExperienceAudioHost } from "../hooks/use-experience-audio-host";
import { useExperiencePreload } from "../hooks/use-experience-preload";
import { EXPERIENCE_PLAY_ORIENTATION } from "../lib/experience-media";
import type { ExperiencePlayerAccess } from "../lib/experience-player-access";
import type { ExperiencePlayerCopy } from "../lib/experience-player-copy";
import { createExperienceRuntime } from "../lib/experience-runtime-host";
import {
  loadExperienceTheme as defaultLoadExperienceTheme,
  type ExperienceThemeLoader,
} from "../lib/experience-theme-loader";
import { localize, localizeVisible, resolvePlaybackLocale } from "../lib/localize";
import { ExperienceSpatialLayer } from "./experience-spatial-layer";
import { EXPERIENCE_START_ACCENT, ExperienceStartShell } from "./experience-start-shell";
import {
  ExperienceVideoRenderer,
  type ExperienceMediaPlaybackHandle,
} from "./experience-video-renderer";
import { assertWorldPreviewScope, type WorldPreviewScope } from "../world/world-preview-manifest";
const ExperienceWorldRenderer = lazy(() =>
  import("../world/experience-world-renderer").then((module) => ({
    default: module.ExperienceWorldRenderer,
  }))
);
const START_ACCENT = EXPERIENCE_START_ACCENT;

export type { ExperiencePlayerAccess };

export interface ExperiencePlayerProps {
  runtime: ExperienceRuntimeManifest;
  locale: string;
  copy: ExperiencePlayerCopy;
  randomSeed?: string;
  coverUrl?: string;
  access?: ExperiencePlayerAccess;
  /** Serial works: jump to the next chapter without leaving the play shell. */
  onNextChapter?: () => void;
  nextChapterLabel?: string;
  loadTheme?: ExperienceThemeLoader;
  active?: boolean;
  worldScope?: WorldPreviewScope;
}

/**
 * Native experience host: engine + cinematic start + expo-video + expo-audio.
 */
export function ExperiencePlayer({
  runtime,
  locale,
  copy,
  randomSeed: initialRandomSeed,
  coverUrl,
  access,
  onNextChapter,
  nextChapterLabel,
  loadTheme = defaultLoadExperienceTheme,
  active = true,
  worldScope,
}: ExperiencePlayerProps) {
  const [restartEpoch, setRestartEpoch] = useState(0);
  const [randomSeed, setRandomSeed] = useState(
    () => initialRandomSeed ?? `experience-player:${Date.now()}`
  );

  const prepared = useMemo(() => {
    const parsed = ExperienceRuntimeManifestSchema.safeParse(runtime);
    if (!parsed.success) {
      return { ok: false as const, issues: parsed.error.issues };
    }
    try {
      if (worldScope) assertWorldPreviewScope(parsed.data, worldScope);
      return {
        ok: true as const,
        manifest: parsed.data,
        controller: createExperienceRuntime(parsed.data, {
          randomSeed,
          canAccess: access?.canAccess,
          worldStreaming: Boolean(worldScope),
        }),
      };
    } catch (error) {
      return {
        ok: false as const,
        unavailable:
          error instanceof ExperienceRuntimeInvariantError &&
          (error.code === "CAPABILITY_UNSUPPORTED" || error.code === "RENDERER_UNAVAILABLE"),
        issues: [{ path: [] as PropertyKey[], message: runtimeErrorMessage(error) }],
      };
    }
  }, [access, randomSeed, restartEpoch, runtime, worldScope]);

  if (!prepared.ok) {
    return (
      <View style={styles.alert}>
        <ThemedText type="smallBold" style={styles.alertTitle}>
          {"unavailable" in prepared && prepared.unavailable
            ? copy.unsupportedRuntime
            : copy.invalidManifest}
        </ThemedText>
        {prepared.issues.slice(0, 8).map((issue, index) => (
          <ThemedText
            key={`${String(issue.path.join("."))}:${index}`}
            type="code"
            style={styles.alertBody}
          >
            {issue.path.join(".") || copy.manifestRoot} — {issue.message}
          </ThemedText>
        ))}
      </View>
    );
  }

  return (
    <ActiveExperienceRuntimePlayer
      key={`${prepared.manifest.buildId}:${randomSeed}:${restartEpoch}:${worldScope?.generation ?? ""}:${worldScope?.workspaceId ?? ""}:${worldScope?.projectId ?? ""}`}
      access={access}
      manifest={prepared.manifest}
      controller={prepared.controller}
      locale={locale}
      copy={copy}
      coverUrl={coverUrl}
      onNextChapter={onNextChapter}
      nextChapterLabel={nextChapterLabel}
      loadTheme={loadTheme}
      active={active}
      worldScope={worldScope}
      onRestart={() => {
        setRandomSeed(
          globalThis.crypto?.randomUUID?.() ?? `experience-player:${Date.now()}:${restartEpoch + 1}`
        );
        setRestartEpoch((value) => value + 1);
      }}
    />
  );
}

function ActiveExperienceRuntimePlayer({
  manifest,
  controller,
  locale,
  copy,
  coverUrl,
  onNextChapter,
  nextChapterLabel,
  loadTheme,
  active,
  onRestart,
  access,
  worldScope,
}: {
  manifest: ExperienceRuntimeManifest;
  controller: ExperienceRuntimeController;
  locale: string;
  copy: ExperiencePlayerCopy;
  coverUrl?: string;
  onNextChapter?: () => void;
  nextChapterLabel?: string;
  loadTheme: ExperienceThemeLoader;
  active: boolean;
  onRestart: () => void;
  access?: ExperiencePlayerAccess;
  worldScope?: WorldPreviewScope;
}) {
  const [runtimeState, setRuntimeState] = useState(() => controller.state());
  const [openRendererIds, setOpenRendererIds] = useState<ReadonlySet<string>>(() => new Set());
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [sceneTimeMs, setSceneTimeMs] = useState(0);
  const [theme, setTheme] = useState<ExperienceThemeConfig | null>(null);
  const [started, setStarted] = useState(false);
  const [viewerPaused, setViewerPaused] = useState(false);
  const stageTapRef = useRef<{ x: number; y: number; time: number; sceneId: string } | null>(null);
  const gestureTapGuardRef = useRef<((x: number, y: number) => boolean) | null>(null);
  const registerGestureTapGuard = useCallback(
    (guard: ((x: number, y: number) => boolean) | null) => {
      gestureTapGuardRef.current = guard;
    },
    []
  );
  const screenActive = useScreenActive();
  const [lastScreenActive, setLastScreenActive] = useState(screenActive);
  if (lastScreenActive !== screenActive) {
    setLastScreenActive(screenActive);
    if (!screenActive && started) setViewerPaused(true);
  }
  const presentingRef = useRef(false);
  const deferredOutcomesRef = useRef<(() => void)[]>([]);
  const [starting, setStarting] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [timelineHoldGate, setTimelineHoldGate] = useState(false);
  const timelineHoldGateRef = useRef(false);
  useEffect(() => {
    timelineHoldGateRef.current = timelineHoldGate;
  }, [timelineHoldGate]);
  const accessPendingRef = useRef(false);
  const [accessPending, setAccessPending] = useState(false);
  const [retryAccess, setRetryAccess] = useState<(() => void) | null>(null);
  const [nodeGate, setNodeGate] = useState<ExperienceGraphNode | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const preload = useExperiencePreload(manifest);
  const playbackLocale = resolvePlaybackLocale(manifest, locale);
  const {
    unlock: unlockAudio,
    suspend: suspendAudio,
    applyEffects: applyAudioEffects,
  } = useExperienceAudioHost(manifest, playbackLocale, setRuntimeError);
  const timelineCursorRef = useRef<ExperienceTimelineCursor>(
    createExperienceTimelineCursor(runtimeState.currentSceneId)
  );
  const parkedGestureEventsRef = useRef<ExperienceRuntimeEvent[]>([]);
  const worldEndHandlesRef = useRef(new Map<string, () => Promise<void>>());
  const pendingWorldEndsRef = useRef(new Set<string>());
  const playbackHandlesRef = useRef(new Map<string, ExperienceMediaPlaybackHandle>());
  const playbackEnabledRef = useRef(false);
  const defaultLocale = manifest.localization.defaultLocale;
  const title = localize(manifest.metadata.title, locale, defaultLocale);
  const accent = themeColor(theme, "color.accent", START_ACCENT);
  // Warm paper tone when remote cover cannot load (TLS / 404) — avoid void black.
  const surface = themeColor(theme, "color.surface", "#2a241c");
  const coverCandidates = useMemo(
    () => resolveCoverCandidates(manifest, coverUrl),
    [coverUrl, manifest]
  );
  const [coverIndex, setCoverIndex] = useState(0);
  const [coverCandidatesKey, setCoverCandidatesKey] = useState(coverCandidates);
  // Adjust during render — an effect that only resets state is a cascading
  // render the React Compiler rejects (react-hooks/set-state-in-effect).
  if (coverCandidates !== coverCandidatesKey) {
    setCoverCandidatesKey(coverCandidates);
    setCoverIndex(0);
  }
  const activeCoverUri =
    coverIndex < coverCandidates.length ? coverCandidates[coverIndex] : undefined;

  const applyResult = useCallback(
    (result: ExperienceEventQueueResult) => {
      setRuntimeState(result.state);
      applyAudioEffects(result.effects);
      result.effects.forEach((effect) => {
        if (effect.kind === "scene.changed") {
          worldEndHandlesRef.current.clear();
          pendingWorldEndsRef.current.clear();
          return;
        }
        if (effect.kind !== "renderer.command") return;
        if (effect.commandType === "end") {
          const end = worldEndHandlesRef.current.get(effect.instanceId);
          if (end) void end().catch((error) => setRuntimeError(runtimeErrorMessage(error)));
          else pendingWorldEndsRef.current.add(effect.instanceId);
          return;
        }
        const handle = playbackHandlesRef.current.get(effect.instanceId);
        if (!handle) return;
        if (effect.commandType === "play") {
          playbackEnabledRef.current = true;
          if (presentingRef.current && !timelineHoldGateRef.current) {
            void handle
              .play()
              .catch((error: unknown) => setRuntimeError(runtimeErrorMessage(error)));
          }
          return;
        }
        if (effect.commandType === "pause") {
          playbackEnabledRef.current = false;
          handle.pause();
          return;
        }
        if (effect.commandType === "seek") {
          const timeMs = effect.payload.timeMs;
          if (typeof timeMs === "number") handle.seek(timeMs / 1_000);
        }
      });
      let latestSceneId: string | null = null;
      const sceneChangeEffects = result.effects.filter(
        (effect): effect is Extract<typeof effect, { kind: "scene.changed" }> => {
          if (effect.kind !== "scene.changed") return false;
          latestSceneId = effect.toSceneId;
          return true;
        }
      );
      setOpenRendererIds((current) => {
        let next = new Set(current);
        result.effects.forEach((effect) => {
          if (effect.kind === "scene.changed") {
            next = new Set();
          }
          if (effect.kind === "renderer.command" && effect.commandType === "open") {
            next.add(effect.instanceId);
          }
        });
        return next;
      });
      if (sceneChangeEffects.length > 0) {
        setSceneEpoch((value) => value + sceneChangeEffects.length);
        setSceneTimeMs(0);
        setTimelineHoldGate(false);
        parkedGestureEventsRef.current = [];
        timelineCursorRef.current = createExperienceTimelineCursor(
          latestSceneId ?? result.state.currentSceneId
        );
      }
    },
    [applyAudioEffects]
  );

  const run = useCallback(
    async (operation: () => ExperienceEventQueueResult, cancellable = false) => {
      if (accessPendingRef.current) return false;
      const attempt = async (): Promise<boolean> => {
        try {
          applyResult(operation());
          setRetryAccess(null);
          return true;
        } catch (error) {
          if (error instanceof ExperienceAccessRequiredError && access) {
            accessPendingRef.current = true;
            setAccessPending(true);
            playbackHandlesRef.current.forEach((handle) => handle.pause());
            try {
              await suspendAudio();
              const alreadyOwned = access.checkAccess
                ? await access.checkAccess(error.requirement)
                : access.canAccess(error.requirement);
              if (!aliveRef.current) return false;
              let allowed = alreadyOwned;
              if (!alreadyOwned) {
                const lockedNode = manifest.graph.nodes.find(
                  (node) => node.access?.key === error.requirement.key
                );
                setNodeGate(lockedNode ?? null);
                allowed = await access.requestAccess(error.requirement);
              }
              if (!aliveRef.current) return false;
              if (allowed) {
                if (!access.canAccess(error.requirement)) {
                  throw new Error("The unlock could not be verified.");
                }
                setNodeGate(null);
                return await attempt();
              }
              if (!cancellable) setRetryAccess(() => continueSession);
              return false;
            } catch (failure) {
              if (aliveRef.current) {
                setRuntimeError(runtimeErrorMessage(failure));
                if (!cancellable) setRetryAccess(() => continueSession);
              }
              return false;
            } finally {
              if (aliveRef.current) {
                accessPendingRef.current = false;
                setAccessPending(false);
                setNodeGate(null);
              }
            }
          }
          if (isDiscardableLateInput(error)) return false;
          setRuntimeError(runtimeErrorMessage(error));
          return false;
        }
      };
      const continueSession = () => {
        if (accessPendingRef.current) return;
        void (async () => {
          const ok = await attempt();
          if (!ok || !aliveRef.current) return;
          setRuntimeError(null);
          if (!playbackEnabledRef.current) {
            playbackEnabledRef.current = true;
            setStarted(true);
          }
        })();
      };
      return attempt();
    },
    [access, applyResult, controller, manifest, suspendAudio]
  );

  useEffect(() => {
    const abortController = new AbortController();
    void Promise.resolve()
      .then(() => {
        abortController.signal.throwIfAborted();
        return loadTheme(manifest, abortController.signal);
      })
      .then((loadedTheme) => {
        if (!abortController.signal.aborted) setTheme(loadedTheme);
      })
      .catch((error: unknown) => {
        // Theme is decorative for Phase B — do not hard-fail the session.
        if (!abortController.signal.aborted) {
          console.warn("[experience-player] theme load failed", runtimeErrorMessage(error));
        }
      });
    return () => abortController.abort();
  }, [loadTheme, manifest]);

  const emitOutcome = useCallback(
    (
      instanceId: string,
      outcomeType: string,
      payload: Record<string, never> | { choiceId: string } = {}
    ) => {
      const deliver = () => {
        void run(() => controller.emitRendererOutcome({ instanceId, outcomeType, payload }), true);
      };
      if (!presentingRef.current || timelineHoldGateRef.current) {
        deferredOutcomesRef.current.push(deliver);
        return;
      }
      deliver();
    },
    [controller, run]
  );

  const flushParkedGestureEvents = useCallback(
    (positionMs: number) => {
      if (parkedGestureEventsRef.current.length === 0) return;
      const due = parkedGestureEventsRef.current.filter(
        (event) => positionMs >= parkedEventBranchAtMs(manifest, event)
      );
      if (due.length === 0) return;
      parkedGestureEventsRef.current = parkedGestureEventsRef.current.filter(
        (event) => !due.includes(event)
      );
      void run(() => controller.dispatch(due));
    },
    [controller, manifest, run]
  );

  const advanceTimeline = useCallback(
    (rendererInstanceId: string | null, positionMs: number) => {
      if (!presentingRef.current || (rendererInstanceId !== null && timelineHoldGateRef.current))
        return;
      const currentState = controller.state();
      const activeNode = findGraphNode(manifest, currentState.currentSceneId);
      if (!activeNode || activeNode.kind !== "scene") return;
      if (!timelineReportDrivesScene(activeNode.clock, rendererInstanceId)) return;
      setSceneTimeMs(positionMs);
      const advanced = advanceExperienceTimeline(activeNode, timelineCursorRef.current, positionMs);
      timelineCursorRef.current = advanced.cursor;
      if (advanced.events.length > 0) void run(() => controller.dispatch(advanced.events));
      flushParkedGestureEvents(positionMs);
    },
    [controller, manifest, run, flushParkedGestureEvents]
  );

  const emitRuntimeEvents = useCallback(
    (events: readonly ExperienceRuntimeEvent[]) => {
      if (!presentingRef.current) return;
      const parked = events.filter(
        (event) =>
          event.type.startsWith("gesture.") &&
          timelineCursorRef.current.positionMs < parkedEventBranchAtMs(manifest, event) - 1e-6
      );
      if (parked.length === 0) {
        void run(() => controller.dispatch(events));
        return;
      }
      const immediate = events.filter((event) => !parked.includes(event));
      parkedGestureEventsRef.current.push(...parked);
      if (immediate.length > 0) void run(() => controller.dispatch(immediate));
    },
    [controller, manifest, run]
  );

  const currentNode = findGraphNode(manifest, runtimeState.currentSceneId);
  const entryLocked = Boolean(currentNode?.access && !access?.canAccess(currentNode.access));
  const scene = !entryLocked && currentNode?.kind === "scene" ? currentNode : null;
  const endingId = runtimeState.completedEndingId ?? null;
  const ending = endingId
    ? (manifest.endings.find((candidate) => candidate.endingId === endingId) ?? null)
    : null;

  const visibleRenderers = useMemo(() => {
    if (!scene) return [] as ExperienceRendererInstance[];
    return scene.renderers
      .filter((renderer) =>
        isExperienceRendererVisible(manifest, runtimeState, renderer.instanceId)
      )
      .sort((left, right) => left.layer - right.layer);
  }, [manifest, runtimeState, scene]);

  /**
   * One gate for everything that runs: video, audio cues, and the scene clock
   * all stop when the app leaves the foreground, the viewer leaves the page, or
   * the host pauses us (chapter switch in flight).
   */
  const presenting =
    screenActive && active && !viewerPaused && !accessPending && !retryAccess && !runtimeError;

  useEffect(() => {
    presentingRef.current = presenting;
    if (presenting && !timelineHoldGate) {
      const pending = deferredOutcomesRef.current.splice(0);
      pending.forEach((deliver) => deliver());
    }
  }, [presenting, timelineHoldGate]);
  /** Pause / resume hook published by the scene-clock effect while it runs. */
  const clockGateRef = useRef<((active: boolean) => void) | null>(null);

  // Fixed scene clock (same path as web player). Pause wall-clock accrual while
  // away so resume does not skip ahead of the frozen video.
  const clockScene = scene?.clock.kind === "fixed" ? scene : null;
  const clockDurationMs = clockScene?.clock.kind === "fixed" ? clockScene.clock.durationMs : null;
  useEffect(() => {
    if (!clockScene || clockDurationMs === null || !started || endingId) return;
    let frame: number | null = null;
    let ended = false;
    const startedAt = performance.now();
    let pausedTotal = 0;
    let pausedAt: number | null = presentingRef.current ? null : performance.now();

    const tick = () => {
      frame = null;
      if (pausedAt !== null) return;
      const elapsed = Math.min(performance.now() - startedAt - pausedTotal, clockDurationMs);
      advanceTimeline(null, elapsed);
      if (elapsed < clockDurationMs) {
        frame = requestAnimationFrame(tick);
        return;
      }
      if (ended) return;
      ended = true;
      emitRuntimeEvents([{ type: "scene.clock-ended", sourceId: clockScene.sceneId }]);
    };

    clockGateRef.current = (active) => {
      if (active) {
        if (pausedAt !== null) {
          pausedTotal += performance.now() - pausedAt;
          pausedAt = null;
        }
        if (!ended && frame === null) frame = requestAnimationFrame(tick);
        return;
      }
      if (pausedAt === null) pausedAt = performance.now();
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    };

    if (pausedAt === null) frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      clockGateRef.current = null;
    };
  }, [
    advanceTimeline,
    clockDurationMs,
    clockScene,
    controller,
    emitRuntimeEvents,
    endingId,
    run,
    sceneEpoch,
    started,
  ]);

  // Registered above while a fixed clock is running; the gate below is declared
  // after it so the running clock is always the one being paused or resumed.
  useEffect(() => {
    clockGateRef.current?.(presenting);
  }, [presenting]);

  useEffect(() => {
    if (!started) return;
    if (presenting) {
      // A resume that cannot reclaim the audio session leaves every later cue
      // silent, which is worth telling the viewer about.
      unlockAudio().catch((error: unknown) => setRuntimeError(runtimeErrorMessage(error)));
      return;
    }
    // Failing to hand the session back on the way out costs the viewer nothing.
    suspendAudio().catch(() => undefined);
  }, [presenting, started, suspendAudio, unlockAudio]);

  const handleStart = () => {
    if (starting || started) return;
    setStarting(true);
    setRuntimeError(null);
    void (async () => {
      try {
        await unlockAudio();
        const ok = await run(() => controller.start());
        if (!ok) {
          await suspendAudio();
          return;
        }
        playbackEnabledRef.current = true;
        setStarted(true);
      } catch (error) {
        await suspendAudio();
        setRuntimeError(runtimeErrorMessage(error));
      } finally {
        setStarting(false);
      }
    })();
  };

  useEffect(() => {
    if (!started) return;
    if (!presenting || timelineHoldGate || accessPending) {
      playbackHandlesRef.current.forEach((handle) => handle.pause());
      return;
    }
    if (!playbackEnabledRef.current) return;
    playbackHandlesRef.current.forEach((handle) => {
      void handle.play().catch(() => undefined);
    });
  }, [started, timelineHoldGate, accessPending, presenting]);

  const registerWorldEndHandle = useCallback(
    (instanceId: string, handle: (() => Promise<void>) | null) => {
      if (!handle) {
        worldEndHandlesRef.current.delete(instanceId);
        return;
      }
      worldEndHandlesRef.current.set(instanceId, handle);
      if (pendingWorldEndsRef.current.delete(instanceId))
        void handle().catch((error) => setRuntimeError(runtimeErrorMessage(error)));
    },
    []
  );

  const registerPlaybackHandle = useCallback(
    (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => {
      if (!handle) {
        playbackHandlesRef.current.delete(instanceId);
        return;
      }
      playbackHandlesRef.current.set(instanceId, handle);
      if (
        !presentingRef.current ||
        !playbackEnabledRef.current ||
        timelineHoldGate ||
        accessPendingRef.current
      )
        return;
      void handle.play().catch(() => undefined);
    },
    [timelineHoldGate]
  );

  if (runtimeError) {
    return (
      <View style={styles.centerPad}>
        <ThemedText type="smallBold" style={styles.lightText}>
          {copy.runtimeError}
        </ThemedText>
        <ThemedText type="code" style={styles.lightMuted}>
          {runtimeError}
        </ThemedText>
        {retryAccess ? (
          <PrimaryButton label={copy.continue} accent={accent} onPress={retryAccess} />
        ) : (
          <PrimaryButton label={copy.restart} accent={accent} onPress={onRestart} />
        )}
      </View>
    );
  }

  if (endingId) {
    const endingTitle = ending ? localize(ending.title, locale, defaultLocale) : copy.unknownEnding;
    const endingSummary = ending?.summary ? localize(ending.summary, locale, defaultLocale) : null;

    return (
      <View style={styles.endingPad}>
        <ThemedText type="code" style={styles.endingEyebrow}>
          {copy.endingEyebrow}
        </ThemedText>
        <ThemedText type="subtitle" style={styles.endingTitle}>
          {endingTitle}
        </ThemedText>
        {endingSummary ? (
          <ThemedText type="small" style={styles.endingSummary}>
            {endingSummary}
          </ThemedText>
        ) : null}
        <View style={styles.endingActions}>
          {onNextChapter && nextChapterLabel ? (
            <PrimaryButton label={nextChapterLabel} accent={accent} onPress={onNextChapter} />
          ) : null}
          <PrimaryButton
            label={copy.playAgain}
            accent={onNextChapter ? "rgba(255,255,255,0.16)" : accent}
            onPress={onRestart}
          />
        </View>
      </View>
    );
  }

  if (!started) {
    const summary = manifest.metadata.summary
      ? localize(manifest.metadata.summary, locale, defaultLocale)
      : null;
    const mediaLoading = !preload.done;
    const loadingPercent = mediaLoading ? preload.percent : null;
    const loadingMediaLabel =
      loadingPercent != null ? `${copy.loadingMedia} ${loadingPercent}%` : null;
    return (
      <ExperienceStartShell
        eyebrow={copy.interactiveFilm}
        title={title}
        summary={summary}
        coverUri={activeCoverUri}
        surface={surface}
        ctaLabel={starting ? copy.starting : copy.start}
        ctaDisabled={starting || mediaLoading}
        loadingMediaLabel={loadingMediaLabel}
        loadingMediaPercent={loadingPercent}
        onPressCta={handleStart}
        onCoverError={() => setCoverIndex((index) => index + 1)}
      />
    );
  }

  const canPauseFromPicture = () =>
    presenting &&
    !!scene &&
    started &&
    !endingId &&
    !scene.renderers.some(
      (renderer) => renderer.rendererId === EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID
    );
  const awayFromGesture = (event: GestureResponderEvent) =>
    !gestureTapGuardRef.current?.(event.nativeEvent.pageX, event.nativeEvent.pageY);

  return (
    // Renderers own the media players, so the host pause reaches them by context
    // rather than through every layer of renderer props. Timeline-control hold
    // pauses via playback handles, not this gate — otherwise the still clock
    // and video presenting effect would fight the hold.
    <ScreenActiveGateContext.Provider value={presenting}>
      <View
        style={styles.stage}
        // Bubble-phase responder negotiation leaves choices, hotspots, scrolling
        // text and controls with their own responders. Never capture their taps.
        onStartShouldSetResponder={(event) =>
          canPauseFromPicture() && event.nativeEvent.touches.length === 1 && awayFromGesture(event)
        }
        onResponderGrant={(event) => {
          stageTapRef.current = scene
            ? {
                x: event.nativeEvent.pageX,
                y: event.nativeEvent.pageY,
                time: Date.now(),
                sceneId: scene.sceneId,
              }
            : null;
        }}
        onResponderStart={(event) => {
          if (event.nativeEvent.touches.length !== 1) stageTapRef.current = null;
        }}
        onResponderMove={(event) => {
          const start = stageTapRef.current;
          if (
            start &&
            (event.nativeEvent.touches.length !== 1 ||
              Math.hypot(event.nativeEvent.pageX - start.x, event.nativeEvent.pageY - start.y) > 8)
          )
            stageTapRef.current = null;
        }}
        onResponderRelease={(event) => {
          const start = stageTapRef.current;
          stageTapRef.current = null;
          if (
            start &&
            start.sceneId === scene?.sceneId &&
            Date.now() - start.time <= 500 &&
            Math.hypot(event.nativeEvent.pageX - start.x, event.nativeEvent.pageY - start.y) <= 8 &&
            canPauseFromPicture() &&
            awayFromGesture(event)
          ) {
            // Suppress the touch compatibility click: the newly mounted Resume
            // overlay must not consume the same tap that paused the picture.
            event.preventDefault();
            setViewerPaused(true);
          }
        }}
        onResponderTerminate={() => {
          stageTapRef.current = null;
        }}
      >
        {visibleRenderers.map((renderer) => (
          <View
            key={`${scene?.sceneId}:${sceneEpoch}:${renderer.instanceId}`}
            style={[styles.rendererLayer, { zIndex: renderer.layer }]}
            pointerEvents={presenting ? "box-none" : "none"}
            accessibilityElementsHidden={!presenting}
            importantForAccessibility={presenting ? "auto" : "no-hide-descendants"}
          >
            <ScreenActiveGateContext.Provider value={presenting && !timelineHoldGate}>
              <RendererPanel
                manifest={manifest}
                renderer={renderer}
                runtimeState={runtimeState}
                open={openRendererIds.has(renderer.instanceId)}
                locale={locale}
                copy={copy}
                accent={accent}
                formatPrice={access?.formatPrice}
                onOutcome={emitOutcome}
                onRuntimeError={setRuntimeError}
                onTimelineTimeMs={(positionMs) => advanceTimeline(renderer.instanceId, positionMs)}
                onPlaybackInterrupted={() => setViewerPaused(true)}
                onPlaybackRefused={() => setViewerPaused(true)}
                onPlaybackHandle={registerPlaybackHandle}
                worldScope={worldScope}
                onWorldEndHandle={registerWorldEndHandle}
              />
            </ScreenActiveGateContext.Provider>
          </View>
        ))}
        {scene && started && !endingId && !accessPending && !retryAccess ? (
          <ExperienceSpatialLayer
            key={scene.sceneId}
            manifest={manifest}
            scene={scene}
            runtimeState={runtimeState}
            sceneTimeMs={sceneTimeMs}
            locale={playbackLocale}
            viewerLocale={locale}
            orientation={EXPERIENCE_PLAY_ORIENTATION}
            onEvents={emitRuntimeEvents}
            onRuntimeError={setRuntimeError}
            onTimelineHoldGateChange={setTimelineHoldGate}
            onGestureTapGuardChange={registerGestureTapGuard}
          />
        ) : null}
        {scene && !accessPending && !retryAccess ? (
          viewerPaused ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.resume}
              onPress={() => {
                // Invoke play during the tap itself: browsers may reject an effect's
                // later attempt after transient user activation has expired.
                if (screenActive && !timelineHoldGate && !accessPending && !retryAccess) {
                  playbackHandlesRef.current.forEach((handle) => {
                    void handle
                      .play({ userGesture: true })
                      .catch((error: unknown) => setRuntimeError(runtimeErrorMessage(error)));
                  });
                }
                setViewerPaused(false);
              }}
              style={styles.pauseOverlay}
            >
              <ThemedText type="smallBold" style={styles.lightText}>
                {copy.paused}
              </ThemedText>
              <ThemedText type="small" style={styles.lightText}>
                {copy.resume}
              </ThemedText>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.pause}
              onPress={() => setViewerPaused(true)}
              style={styles.pauseControl}
            >
              <ThemedText type="small" style={styles.lightText}>
                {copy.pause}
              </ThemedText>
            </Pressable>
          )
        ) : null}
        {nodeGate ? <View pointerEvents="none" style={styles.nodeGate} /> : null}
        {retryAccess && started && !nodeGate ? (
          <View style={styles.retryOverlay}>
            <PrimaryButton label={copy.continue} accent={accent} onPress={retryAccess} />
          </View>
        ) : null}
      </View>
    </ScreenActiveGateContext.Provider>
  );
}

function RendererPanel({
  manifest,
  renderer,
  runtimeState,
  open,
  locale,
  copy,
  accent,
  formatPrice,
  onOutcome,
  onRuntimeError,
  onTimelineTimeMs,
  onPlaybackHandle,
  onPlaybackRefused,
  onPlaybackInterrupted,
  worldScope,
  onWorldEndHandle,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  runtimeState: ExperienceRuntimeState;
  open: boolean;
  locale: string;
  copy: ExperiencePlayerCopy;
  accent: string;
  formatPrice?: (amount: number) => string;
  onOutcome: (
    instanceId: string,
    outcomeType: string,
    payload?: Record<string, never> | { choiceId: string }
  ) => void;
  onRuntimeError: (message: string) => void;
  onTimelineTimeMs: (timeMs: number) => void;
  onPlaybackRefused: () => void;
  onPlaybackInterrupted: () => void;
  onPlaybackHandle: (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => void;
  worldScope?: WorldPreviewScope;
  onWorldEndHandle: (instanceId: string, handle: (() => Promise<void>) | null) => void;
}) {
  const defaultLocale = manifest.localization.defaultLocale;

  if (renderer.rendererId === EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID && worldScope) {
    const config = ExperienceCoreWorldModelRendererConfigSchema.parse(renderer.config);
    return (
      <Suspense
        fallback={
          <View style={styles.centerPad}>
            <ThemedText type="small" style={styles.lightText}>
              {copy.loadingMedia}
            </ThemedText>
          </View>
        }
      >
        <ExperienceWorldRenderer
          scope={{ ...worldScope, worldId: config.worldId }}
          config={config}
          onCompleted={() => onOutcome(renderer.instanceId, "world-completed", {})}
          onError={(error) => onRuntimeError(runtimeErrorMessage(error))}
          onEndHandle={(handle) => onWorldEndHandle(renderer.instanceId, handle)}
        />
      </Suspense>
    );
  }

  if (renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID) {
    return (
      <ExperienceVideoRenderer
        manifest={manifest}
        renderer={renderer}
        copy={copy}
        onTimelineTimeMs={onTimelineTimeMs}
        onCompleted={() => onOutcome(renderer.instanceId, "media-ended", {})}
        onRuntimeError={onRuntimeError}
        onPlaybackInterrupted={onPlaybackInterrupted}
        onPlaybackRefused={onPlaybackRefused}
        onPlaybackHandle={onPlaybackHandle}
      />
    );
  }

  if (renderer.rendererId === EXPERIENCE_CORE_TEXT_RENDERER_ID) {
    const config = ExperienceCoreTextRendererConfigSchema.parse(renderer.config);
    const textTitle = config.title ? localize(config.title, locale, defaultLocale) : null;
    const body = localize(config.body, locale, defaultLocale);
    return (
      <ScrollView
        style={styles.textOverlay}
        contentContainerStyle={styles.textOverlayContent}
        keyboardShouldPersistTaps="handled"
      >
        {textTitle ? (
          <ThemedText type="smallBold" style={styles.lightText}>
            {textTitle}
          </ThemedText>
        ) : null}
        <ThemedText type="small" style={styles.lightMuted}>
          {body}
        </ThemedText>
        {config.completion === "continue" ? (
          <PrimaryButton
            label={copy.continue}
            accent={accent}
            onPress={() => onOutcome(renderer.instanceId, "text-completed", {})}
          />
        ) : null}
      </ScrollView>
    );
  }

  if (renderer.rendererId === EXPERIENCE_CORE_CHOICE_RENDERER_ID) {
    const config = ExperienceCoreChoiceRendererConfigSchema.parse(renderer.config);
    if (!config.initiallyOpen && !open) {
      return null;
    }
    const choices = config.choices.filter(
      (choice) =>
        !choice.visibleWhen ||
        evaluateExperienceCondition(choice.visibleWhen, runtimeState, {
          type: "runtime.visibility",
        })
    );
    const promptText = localizeVisible(config.prompt, locale, defaultLocale);
    return (
      <View style={styles.choiceOverlay} pointerEvents="box-none">
        {promptText ? (
          <ThemedText type="smallBold" style={styles.choicePrompt}>
            {promptText}
          </ThemedText>
        ) : null}
        {choices.length === 0 ? (
          <ThemedText type="small" style={styles.lightMuted}>
            {copy.noVisibleChoices}
          </ThemedText>
        ) : (
          choices.map((choice) => {
            const requirement = choiceRouteAccess(
              manifest,
              runtimeState,
              renderer.instanceId,
              choice.choiceId
            );
            const price =
              requirement && formatPrice ? formatPrice(requirement.communityPointPrice) : null;
            const label = localize(choice.label, locale, defaultLocale);
            return (
              <PrimaryButton
                key={choice.choiceId}
                label={price ? `${label} · ${price}` : label}
                accent="rgba(255,255,255,0.14)"
                textColor="#FFFFFF"
                onPress={() =>
                  onOutcome(renderer.instanceId, "choice-selected", { choiceId: choice.choiceId })
                }
              />
            );
          })
        )}
      </View>
    );
  }

  return null;
}

function PrimaryButton({
  label,
  accent,
  textColor = "#FFFFFF",
  disabled,
  onPress,
}: {
  label: string;
  accent: string;
  textColor?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        { alignSelf: "stretch" },
        (disabled || pressed) && { opacity: disabled ? 0.5 : 0.85 },
      ]}
    >
      <View style={[styles.button, { backgroundColor: accent }]}>
        <Text style={[styles.buttonLabel, { color: textColor }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

function findGraphNode(
  manifest: ExperienceRuntimeManifest,
  sceneId: string
): ExperienceGraphNode | undefined {
  return manifest.graph.nodes.find((node) => node.sceneId === sceneId);
}

function choiceRouteAccess(
  manifest: ExperienceRuntimeManifest,
  runtimeState: ExperienceRuntimeState,
  instanceId: string,
  choiceId: string
): ExperienceAccessRequirement | undefined {
  return manifest.graph.nodes
    .flatMap((node) => node.eventBindings)
    .filter(
      (binding) =>
        binding.on.type === "renderer.outcome" &&
        binding.on.sourceId === instanceId &&
        binding.on.qualifierId === "choice-selected"
    )
    .flatMap((binding) => binding.routes)
    .find(
      (route) =>
        !route.when ||
        evaluateExperienceCondition(route.when, runtimeState, {
          type: "renderer.outcome",
          sourceId: instanceId,
          qualifierId: "choice-selected",
          payload: { choiceId },
        })
    )?.access;
}

/**
 * A media time report may only drive a scene whose clock that renderer owns.
 * Renderer clocks name their video instance; host-owned reports (the fixed
 * rAF clock) pass null and are always accepted. The guard exists for the
 * dying-video race: after a scene change the outgoing element can still fire
 * one last timeupdate carrying the old scene's final position.
 */
function timelineReportDrivesScene(
  clock: ExperienceScene["clock"],
  rendererInstanceId: string | null
): boolean {
  if (clock.kind !== "renderer") return true;
  return clock.rendererInstanceId === rendererInstanceId;
}

/**
 * Resolves when a gesture outcome event may actually route. The safe branch
 * frame defaults to the interaction window end, so interactions authored
 * before `branchAtMs` existed keep cutting exactly where they used to.
 */
function parkedEventBranchAtMs(
  manifest: ExperienceRuntimeManifest,
  event: ExperienceRuntimeEvent
): number {
  if (!event.sourceId) return 0;
  const gesture = manifest.graph.nodes
    .filter(
      (node): node is Extract<ExperienceGraphNode, { kind: "scene" }> => node.kind === "scene"
    )
    .flatMap((node) => node.gestures)
    .find((candidate) => candidate.gestureId === event.sourceId);
  if (gesture?.holdFrame) return 0;
  return gesture?.branchAtMs ?? gesture?.activeWindow?.endMs ?? 0;
}

/** Match web: cover from runtime assets; landscape variant preferred for cinematic. */
function resolveCoverCandidates(
  manifest: ExperienceRuntimeManifest,
  fallbackUrl?: string
): string[] {
  const uris: string[] = [];
  const push = (raw?: string) => {
    if (!raw?.trim()) return;
    const absolute = absolutizeAssetUri(raw.trim());
    if (!absolute || uris.includes(absolute)) return;
    uris.push(absolute);
  };

  const assetId = manifest.metadata.coverAssetId;
  if (assetId) {
    const asset = manifest.assets.find(
      (candidate): candidate is ExperienceImageAsset =>
        candidate.assetId === assetId && candidate.kind === "image"
    );
    if (asset) {
      push(asset.variants.find((variant) => variant.orientation === "landscape")?.uri);
      for (const variant of asset.variants) push(variant.uri);
    }
  }
  push(fallbackUrl);
  return uris;
}

/** Root-relative theme/cover paths are web-hosted; native fetch needs an absolute URL. */
function absolutizeAssetUri(uri: string): string | undefined {
  const resolved = resolveExperienceAssetUrl(uri);
  return resolved || undefined;
}

function themeColor(theme: ExperienceThemeConfig | null, key: string, fallback: string): string {
  const value = theme?.tokens[key];
  if (value === undefined || value === null) return fallback;
  const asString = String(value).trim();
  return asString.length > 0 ? asString : fallback;
}

function runtimeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown experience runtime error";
}

const DISCARDABLE_INPUT_CODES = new Set(["RUNTIME_NOT_STARTED"]);

function isDiscardableLateInput(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "ExperienceRuntimeInvariantError") {
    return false;
  }
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && DISCARDABLE_INPUT_CODES.has(code);
}

const styles = StyleSheet.create({
  alert: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.two,
    justifyContent: "center",
  },
  alertTitle: { color: "#fecaca" },
  alertBody: { color: "rgba(254,202,202,0.7)" },
  centerPad: {
    flex: 1,
    padding: Spacing.four,
    justifyContent: "center",
    gap: Spacing.three,
  },
  endingPad: {
    flex: 1,
    padding: Spacing.four,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.three,
  },
  endingEyebrow: {
    color: "rgba(255,255,255,0.65)",
    textAlign: "center",
  },
  endingTitle: {
    color: "#FFFFFF",
    textAlign: "center",
    maxWidth: 640,
  },
  endingSummary: {
    color: "rgba(255,255,255,0.62)",
    textAlign: "center",
    maxWidth: 520,
  },
  endingActions: {
    gap: Spacing.two,
    maxWidth: 420,
    width: "100%",
  },
  pauseControl: {
    position: "absolute",
    right: 12,
    top: 12,
    zIndex: 1000,
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 8,
  },
  pauseOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1001,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  stage: {
    flex: 1,
    backgroundColor: "#000000",
  },
  nodeGate: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
    zIndex: 40,
  },
  retryOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.five,
    zIndex: 41,
  },
  rendererLayer: {
    ...StyleSheet.absoluteFill,
  },
  textOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  textOverlayContent: {
    flexGrow: 1,
    padding: Spacing.five,
    gap: Spacing.two,
    justifyContent: "center",
  },
  choiceOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.seven,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  choicePrompt: {
    color: "#FFFFFF",
    textAlign: "center",
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.two,
    minWidth: 180,
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  lightText: { color: "#FFFFFF" },
  lightMuted: { color: "rgba(255,255,255,0.65)" },
});
