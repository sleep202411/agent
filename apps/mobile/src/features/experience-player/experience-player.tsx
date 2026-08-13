import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  EXPERIENCE_CORE_RENDERER_ADAPTERS,
  advanceExperienceTimeline,
  createExperienceTimelineCursor,
  evaluateExperienceCondition,
  isExperienceRendererVisible,
  type ExperienceEventQueueResult,
  type ExperienceRuntimeController,
  type ExperienceRuntimeState,
  type ExperienceTimelineCursor,
} from "@repo/experience-engine";
import {
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_TEXT_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  ExperienceCoreChoiceRendererConfigSchema,
  ExperienceCoreTextRendererConfigSchema,
  ExperienceRuntimeManifestSchema,
  type ExperienceGraphNode,
  type ExperienceImageAsset,
  type ExperienceRendererInstance,
  type ExperienceRuntimeManifest,
  type ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";

import { ThemedText } from "@/components/themed-text";
import { resolveExperienceAssetUrl } from "@/config";
import { Spacing } from "@/constants/theme";
import { useScreenActive } from "@/hooks/use-app-active";

import type { ExperiencePlayerCopy } from "./experience-player-copy";
import { EXPERIENCE_START_ACCENT, ExperienceStartShell } from "./experience-start-shell";
import {
  loadExperienceTheme as defaultLoadExperienceTheme,
  type ExperienceThemeLoader,
} from "./experience-theme-loader";
import { createExperienceRuntime } from "./experience-runtime-host";
import { ExperienceVideoRenderer } from "./experience-video-renderer";
import { localize, resolvePlaybackLocale } from "./localize";
import { useExperienceAudioHost } from "./use-experience-audio-host";
import { useExperiencePreload } from "./use-experience-preload";
const START_ACCENT = EXPERIENCE_START_ACCENT;
export interface ExperiencePlayerProps {
  runtime: ExperienceRuntimeManifest;
  locale: string;
  copy: ExperiencePlayerCopy;
  randomSeed?: string;
  coverUrl?: string;
  /** Serial works: jump to the next chapter without leaving the play shell. */
  onNextChapter?: () => void;
  nextChapterLabel?: string;
  loadTheme?: ExperienceThemeLoader;
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
  onNextChapter,
  nextChapterLabel,
  loadTheme = defaultLoadExperienceTheme,
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
      return {
        ok: true as const,
        manifest: parsed.data,
        controller: createExperienceRuntime(parsed.data, {
          rendererAdapters: EXPERIENCE_CORE_RENDERER_ADAPTERS,
          randomSeed,
        }),
      };
    } catch (error) {
      return {
        ok: false as const,
        issues: [{ path: [] as PropertyKey[], message: runtimeErrorMessage(error) }],
      };
    }
  }, [randomSeed, runtime]);

  if (!prepared.ok) {
    return (
      <View style={styles.alert}>
        <ThemedText type="smallBold" style={styles.alertTitle}>
          {copy.invalidManifest}
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
      key={`${prepared.manifest.buildId}:${randomSeed}:${restartEpoch}`}
      manifest={prepared.manifest}
      controller={prepared.controller}
      locale={locale}
      copy={copy}
      coverUrl={coverUrl}
      onNextChapter={onNextChapter}
      nextChapterLabel={nextChapterLabel}
      loadTheme={loadTheme}
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
  onRestart,
}: {
  manifest: ExperienceRuntimeManifest;
  controller: ExperienceRuntimeController;
  locale: string;
  copy: ExperiencePlayerCopy;
  coverUrl?: string;
  onNextChapter?: () => void;
  nextChapterLabel?: string;
  loadTheme: ExperienceThemeLoader;
  onRestart: () => void;
}) {
  const [runtimeState, setRuntimeState] = useState(() => controller.state());
  const [openRendererIds, setOpenRendererIds] = useState<ReadonlySet<string>>(() => new Set());
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [theme, setTheme] = useState<ExperienceThemeConfig | null>(null);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
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
      let sceneChangeCount = 0;
      let latestSceneId: string | null = null;
      setOpenRendererIds((current) => {
        let next = new Set(current);
        result.effects.forEach((effect) => {
          if (effect.kind === "scene.changed") {
            next = new Set();
            sceneChangeCount += 1;
            latestSceneId = effect.toSceneId;
          }
          if (effect.kind === "renderer.command" && effect.commandType === "open") {
            next.add(effect.instanceId);
          }
        });
        return next;
      });
      if (sceneChangeCount > 0) {
        setSceneEpoch((value) => value + sceneChangeCount);
        timelineCursorRef.current = createExperienceTimelineCursor(
          latestSceneId ?? result.state.currentSceneId
        );
      }
    },
    [applyAudioEffects]
  );

  const run = useCallback(
    (operation: () => ExperienceEventQueueResult) => {
      try {
        applyResult(operation());
        return true;
      } catch (error) {
        if (isDiscardableLateInput(error)) return false;
        setRuntimeError(runtimeErrorMessage(error));
        return false;
      }
    },
    [applyResult]
  );

  useEffect(() => {
    const abortController = new AbortController();
    void loadTheme(manifest, abortController.signal)
      .then(setTheme)
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
    ) => run(() => controller.emitRendererOutcome({ instanceId, outcomeType, payload })),
    [controller, run]
  );

  const advanceTimeline = useCallback(
    (positionMs: number) => {
      const currentState = controller.state();
      const activeNode = findGraphNode(manifest, currentState.currentSceneId);
      if (!activeNode || activeNode.kind !== "scene") return;
      const advanced = advanceExperienceTimeline(activeNode, timelineCursorRef.current, positionMs);
      timelineCursorRef.current = advanced.cursor;
      if (advanced.events.length > 0) run(() => controller.dispatch(advanced.events));
    },
    [controller, manifest, run]
  );

  const currentNode = findGraphNode(manifest, runtimeState.currentSceneId);
  const scene = currentNode?.kind === "scene" ? currentNode : null;
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
   * all stop when the app leaves the foreground or the viewer leaves the page.
   */
  const presenting = useScreenActive();
  const presentingRef = useRef(presenting);
  useEffect(() => {
    presentingRef.current = presenting;
  }, [presenting]);
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
      advanceTimeline(elapsed);
      if (elapsed < clockDurationMs) {
        frame = requestAnimationFrame(tick);
        return;
      }
      if (ended) return;
      ended = true;
      run(() => controller.dispatch([{ type: "scene.clock-ended", sourceId: clockScene.sceneId }]));
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
        if (!run(() => controller.start())) {
          await suspendAudio();
          return;
        }
        setStarted(true);
      } catch (error) {
        await suspendAudio();
        setRuntimeError(runtimeErrorMessage(error));
      } finally {
        setStarting(false);
      }
    })();
  };

  if (runtimeError) {
    return (
      <View style={styles.centerPad}>
        <ThemedText type="smallBold" style={styles.lightText}>
          {copy.runtimeError}
        </ThemedText>
        <ThemedText type="code" style={styles.lightMuted}>
          {runtimeError}
        </ThemedText>
        <PrimaryButton label={copy.restart} accent={accent} onPress={onRestart} />
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

  return (
    <View style={styles.stage}>
      {visibleRenderers.map((renderer) => (
        <View
          key={`${scene?.sceneId}:${sceneEpoch}:${renderer.instanceId}`}
          style={[styles.rendererLayer, { zIndex: renderer.layer }]}
          pointerEvents="box-none"
        >
          <RendererPanel
            manifest={manifest}
            renderer={renderer}
            runtimeState={runtimeState}
            open={openRendererIds.has(renderer.instanceId)}
            locale={locale}
            copy={copy}
            accent={accent}
            onOutcome={emitOutcome}
            onRuntimeError={setRuntimeError}
            onTimelineTimeMs={advanceTimeline}
          />
        </View>
      ))}
    </View>
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
  onOutcome,
  onRuntimeError,
  onTimelineTimeMs,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  runtimeState: ExperienceRuntimeState;
  open: boolean;
  locale: string;
  copy: ExperiencePlayerCopy;
  accent: string;
  onOutcome: (
    instanceId: string,
    outcomeType: string,
    payload?: Record<string, never> | { choiceId: string }
  ) => void;
  onRuntimeError: (message: string) => void;
  onTimelineTimeMs: (timeMs: number) => void;
}) {
  const defaultLocale = manifest.localization.defaultLocale;

  if (renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID) {
    return (
      <ExperienceVideoRenderer
        manifest={manifest}
        renderer={renderer}
        copy={copy}
        onTimelineTimeMs={onTimelineTimeMs}
        onCompleted={() => onOutcome(renderer.instanceId, "media-ended", {})}
        onRuntimeError={onRuntimeError}
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
    return (
      <View style={styles.choiceOverlay} pointerEvents="box-none">
        <ThemedText type="smallBold" style={styles.choicePrompt}>
          {localize(config.prompt, locale, defaultLocale)}
        </ThemedText>
        {choices.length === 0 ? (
          <ThemedText type="small" style={styles.lightMuted}>
            {copy.noVisibleChoices}
          </ThemedText>
        ) : (
          choices.map((choice) => (
            <PrimaryButton
              key={choice.choiceId}
              label={localize(choice.label, locale, defaultLocale)}
              accent="rgba(255,255,255,0.14)"
              textColor="#FFFFFF"
              onPress={() =>
                onOutcome(renderer.instanceId, "choice-selected", { choiceId: choice.choiceId })
              }
            />
          ))
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
  stage: {
    flex: 1,
    backgroundColor: "#000000",
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
