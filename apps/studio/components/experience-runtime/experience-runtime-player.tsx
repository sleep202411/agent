"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID,
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  ExperienceCoreCheckpointRendererConfigSchema,
  ExperienceCoreChoiceRendererConfigSchema,
  ExperienceCoreVideoRendererConfigSchema,
  ExperienceRuntimeManifestSchema,
  type ExperienceCoreVideoRendererConfig,
  type ExperienceGraphNode,
  type ExperienceImageAsset,
  type ExperienceLocalizedText,
  type ExperienceRendererInstance,
  type ExperienceRuntimeManifest,
  type ExperienceRuntimeAsset,
  type ExperienceThemeConfig,
  type ExperienceVideoAsset,
} from "@repo/shared/experience-runtime";
import {
  EXPERIENCE_CORE_RENDERER_ADAPTERS,
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
import { IconAlertTriangle, IconArrowRight, IconRefresh } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { StudioVideoPlayer } from "@/components/media/studio-video-player";
import { ExperienceSpatialInteractionLayer } from "@/components/experience-runtime/experience-spatial-interaction-layer";
import { Button } from "@/components/ui/button";
import { createStudioExperienceRuntime } from "@/lib/experience-runtime-host";
import { loadExperienceTheme } from "@/lib/experience-theme-loader";
import { cn } from "@/lib/utils";
import type { StoryFrameProfile } from "@/lib/story-projects-api";

export function ExperienceRuntimePlayer({
  runtime,
  locale,
  frameProfile,
}: {
  runtime: Record<string, unknown>;
  locale: string;
  frameProfile: StoryFrameProfile;
}) {
  const t = useTranslations("storyStudio.build.player");
  const [restartEpoch, setRestartEpoch] = useState(0);
  const prepared = useMemo(() => {
    // A restart intentionally creates a new controller; runtime controllers
    // are single-session state owners and are never reset in place.
    void restartEpoch;
    const parsed = ExperienceRuntimeManifestSchema.safeParse(runtime);
    if (!parsed.success) return { ok: false as const, issues: parsed.error.issues };
    try {
      return {
        ok: true as const,
        manifest: parsed.data,
        controller: createStudioExperienceRuntime(parsed.data, {
          rendererAdapters: EXPERIENCE_CORE_RENDERER_ADAPTERS,
        }),
      };
    } catch (error) {
      return {
        ok: false as const,
        issues: [{ path: [], message: runtimeErrorMessage(error) }],
      };
    }
  }, [restartEpoch, runtime]);

  if (!prepared.ok) {
    return (
      <div role="alert" className="rounded-2xl bg-destructive/10 p-5 text-destructive">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <IconAlertTriangle className="size-4" />
          {t("invalidManifest")}
        </div>
        <ul className="mt-3 space-y-1.5 font-mono text-[10px] leading-5 text-destructive/78">
          {prepared.issues.slice(0, 8).map((issue, index) => (
            <li key={`${issue.path.join(".")}:${index}`}>
              {issue.path.join(".") || t("manifestRoot")} — {issue.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ActiveExperienceRuntimePlayer
      key={`${prepared.manifest.buildId}:${restartEpoch}`}
      manifest={prepared.manifest}
      controller={prepared.controller}
      locale={locale}
      frameProfile={frameProfile}
      onRestart={() => setRestartEpoch((value) => value + 1)}
    />
  );
}

function ActiveExperienceRuntimePlayer({
  manifest,
  controller,
  locale,
  frameProfile,
  onRestart,
}: {
  manifest: ExperienceRuntimeManifest;
  controller: ExperienceRuntimeController;
  locale: string;
  frameProfile: StoryFrameProfile;
  onRestart: () => void;
}) {
  const t = useTranslations("storyStudio.build.player");
  const [runtimeState, setRuntimeState] = useState(() => controller.state());
  const [openRendererIds, setOpenRendererIds] = useState<ReadonlySet<string>>(() => new Set());
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [sceneTimeMs, setSceneTimeMs] = useState(0);
  const [theme, setTheme] = useState<ExperienceThemeConfig | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const timelineCursorRef = useRef<ExperienceTimelineCursor>(
    createExperienceTimelineCursor(runtimeState.currentSceneId)
  );

  const applyResult = useCallback((result: ExperienceEventQueueResult) => {
    setRuntimeState(result.state);
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
      setSceneTimeMs(0);
      timelineCursorRef.current = createExperienceTimelineCursor(
        latestSceneId ?? result.state.currentSceneId
      );
    }
  }, []);

  const run = useCallback(
    (operation: () => ExperienceEventQueueResult) => {
      try {
        applyResult(operation());
      } catch (error) {
        setRuntimeError(runtimeErrorMessage(error));
      }
    },
    [applyResult]
  );

  useEffect(() => {
    const abortController = new AbortController();
    void loadExperienceTheme(manifest, abortController.signal)
      .then(setTheme)
      .catch((error: unknown) => {
        if (abortController.signal.aborted) return;
        setRuntimeError(runtimeErrorMessage(error));
      });
    return () => abortController.abort();
  }, [manifest]);

  useEffect(() => {
    if (!theme) return;
    if (startedRef.current) return;
    startedRef.current = true;
    run(() => controller.start());
  }, [controller, run, theme]);

  const currentNode = findGraphNode(manifest, runtimeState.currentSceneId);
  const scene = currentNode?.kind === "scene" ? currentNode : null;
  const playbackLocale = resolvePlaybackLocale(manifest, locale);
  const endingId = runtimeState.completedEndingId ?? null;
  const ending = endingId
    ? (manifest.endings.find((candidate) => candidate.endingId === endingId) ?? null)
    : null;

  const emitOutcome = useCallback(
    (
      instanceId: string,
      outcomeType: string,
      payload: Record<string, never> | { choiceId: string }
    ) => run(() => controller.emitRendererOutcome({ instanceId, outcomeType, payload })),
    [controller, run]
  );

  const advanceTimeline = useCallback(
    (positionMs: number) => {
      setSceneTimeMs(positionMs);
      const currentState = controller.state();
      const activeNode = findGraphNode(manifest, currentState.currentSceneId);
      if (!activeNode || activeNode.kind !== "scene") return;
      const advanced = advanceExperienceTimeline(activeNode, timelineCursorRef.current, positionMs);
      timelineCursorRef.current = advanced.cursor;
      if (advanced.events.length > 0) run(() => controller.dispatch(advanced.events));
    },
    [controller, manifest, run]
  );

  const emitRuntimeEvents = useCallback(
    (events: readonly ExperienceRuntimeEvent[]) => run(() => controller.dispatch(events)),
    [controller, run]
  );

  return (
    <PlayerFrame frameProfile={frameProfile} style={theme ? themeStyle(theme) : undefined}>
      {scene ? (
        scene.renderers
          .filter((renderer) =>
            isExperienceRendererVisible(manifest, runtimeState, renderer.instanceId)
          )
          .sort((left, right) => left.layer - right.layer)
          .map((renderer) => (
            <CoreRenderer
              key={`${scene.sceneId}:${sceneEpoch}:${renderer.instanceId}`}
              manifest={manifest}
              renderer={renderer}
              runtimeState={runtimeState}
              open={openRendererIds.has(renderer.instanceId)}
              locale={playbackLocale}
              frameProfile={frameProfile}
              onTimelineTimeMs={advanceTimeline}
              onOutcome={emitOutcome}
              onRuntimeError={setRuntimeError}
            />
          ))
      ) : (
        <div className="absolute inset-0 bg-black" />
      )}

      {scene && !endingId ? (
        <ExperienceSpatialInteractionLayer
          manifest={manifest}
          scene={scene}
          runtimeState={runtimeState}
          sceneTimeMs={sceneTimeMs}
          locale={playbackLocale}
          frameProfile={frameProfile}
          onEvents={emitRuntimeEvents}
          onRuntimeError={setRuntimeError}
        />
      ) : null}

      {endingId && !runtimeError ? (
        <div
          role="dialog"
          aria-modal="true"
          className="absolute inset-0 z-50 grid place-items-center bg-black/78 p-6 text-center backdrop-blur-md"
        >
          <div className="max-w-lg">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-white/42 uppercase">
              {t("endingEyebrow")}
            </p>
            <h3 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-white">
              {ending
                ? localize(ending.title, playbackLocale, manifest.localization.defaultLocale)
                : t("unknownEnding", { endingId })}
            </h3>
            {ending?.summary ? (
              <p className="mt-3 text-sm leading-6 text-white/56">
                {localize(ending.summary, playbackLocale, manifest.localization.defaultLocale)}
              </p>
            ) : null}
            <Button type="button" variant="default" size="lg" className="mt-6" onClick={onRestart}>
              <IconRefresh className="size-4" />
              {t("playAgain")}
            </Button>
          </div>
        </div>
      ) : null}

      {runtimeError ? (
        <div
          role="alertdialog"
          aria-modal="true"
          className="absolute inset-0 z-[60] grid place-items-center bg-black/82 p-6 text-center backdrop-blur-md"
        >
          <div className="max-w-md">
            <IconAlertTriangle className="mx-auto size-6 text-destructive" />
            <h3 className="mt-4 text-sm font-semibold text-white">{t("errors.runtimeTitle")}</h3>
            <p className="mt-2 text-xs leading-5 text-white/56">{runtimeError}</p>
            <Button type="button" variant="secondary" className="mt-5" onClick={onRestart}>
              <IconRefresh className="size-3.5" />
              {t("restart")}
            </Button>
          </div>
        </div>
      ) : null}
    </PlayerFrame>
  );
}

function CoreRenderer({
  manifest,
  renderer,
  runtimeState,
  open,
  locale,
  frameProfile,
  onTimelineTimeMs,
  onOutcome,
  onRuntimeError,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  runtimeState: ExperienceRuntimeState;
  open: boolean;
  locale: string;
  frameProfile: StoryFrameProfile;
  onTimelineTimeMs: (timeMs: number) => void;
  onOutcome: (
    instanceId: string,
    outcomeType: string,
    payload: Record<string, never> | { choiceId: string }
  ) => void;
  onRuntimeError: (message: string) => void;
}) {
  if (renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID) {
    return (
      <CoreVideoRenderer
        manifest={manifest}
        renderer={renderer}
        frameProfile={frameProfile}
        onTimelineTimeMs={onTimelineTimeMs}
        onCompleted={() => onOutcome(renderer.instanceId, "media-ended", {})}
        onRuntimeError={onRuntimeError}
      />
    );
  }
  if (renderer.rendererId === EXPERIENCE_CORE_CHOICE_RENDERER_ID) {
    return (
      <CoreChoiceRenderer
        manifest={manifest}
        renderer={renderer}
        runtimeState={runtimeState}
        open={open}
        locale={locale}
        onSelect={(choiceId) => onOutcome(renderer.instanceId, "choice-selected", { choiceId })}
      />
    );
  }
  if (renderer.rendererId === EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID) {
    return (
      <CoreCheckpointRenderer
        renderer={renderer}
        open={open}
        onSelect={(actionId) => onOutcome(renderer.instanceId, actionId, {})}
      />
    );
  }
  return null;
}

function CoreVideoRenderer({
  manifest,
  renderer,
  frameProfile,
  onTimelineTimeMs,
  onCompleted,
  onRuntimeError,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  frameProfile: StoryFrameProfile;
  onTimelineTimeMs: (timeMs: number) => void;
  onCompleted: () => void;
  onRuntimeError: (message: string) => void;
}) {
  const t = useTranslations("storyStudio.build.player");
  const config = ExperienceCoreVideoRendererConfigSchema.parse(renderer.config);
  const [sequenceIndex, setSequenceIndex] = useState(0);
  const [terminalMode, setTerminalMode] = useState<
    { kind: "held" } | { kind: "loop"; assetId: string; clipStartTime?: number } | null
  >(null);
  const completionTimerRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const missingAssetRef = useRef<string | null>(null);
  const clip = config.sequence[sequenceIndex];
  const assetId = terminalMode?.kind === "loop" ? terminalMode.assetId : clip?.assetId;
  const media = assetId ? resolveVideoMedia(manifest.assets, assetId, frameProfile) : null;
  const posterAssetId = clip?.posterAssetId ?? config.posterAssetId;
  const poster = posterAssetId
    ? resolveImageUri(manifest.assets, posterAssetId, frameProfile)
    : undefined;
  const timelineOffsetMs = sequenceTimelineOffsetMs(
    manifest.assets,
    config,
    sequenceIndex,
    frameProfile
  );

  useEffect(
    () => () => {
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (media || !assetId || missingAssetRef.current === assetId) return;
    missingAssetRef.current = assetId;
    onRuntimeError(t("errors.media", { assetId }));
  }, [assetId, media, onRuntimeError, t]);

  const completeRenderer = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleted();
  };

  const advanceSequence = () => {
    if (sequenceIndex + 1 < config.sequence.length) {
      setTerminalMode(null);
      setSequenceIndex((value) => value + 1);
      return;
    }
    completeRenderer();
  };

  const handleEnd = () => {
    if (!clip || terminalMode?.kind === "loop") return;
    const behavior = clip.endBehavior;
    if (behavior.behavior === "advance") {
      advanceSequence();
      return;
    }
    if (behavior.behavior === "hold-last-frame") {
      setTerminalMode({ kind: "held" });
      if (behavior.durationMs !== undefined) {
        completionTimerRef.current = window.setTimeout(advanceSequence, behavior.durationMs);
      }
      return;
    }
    if (behavior.behavior === "loop") {
      setTerminalMode({ kind: "loop", assetId: behavior.assetId });
      return;
    }
    const durationSeconds = media ? media.variant.durationMs / 1_000 : 0;
    setTerminalMode({
      kind: "loop",
      assetId: clip.assetId,
      clipStartTime: Math.max(0, durationSeconds - behavior.tailSeconds),
    });
  };

  if (!clip || !assetId || !media) return null;

  return (
    <div className="absolute inset-0" style={{ zIndex: renderer.layer }}>
      <StudioVideoPlayer
        key={`${renderer.instanceId}:${sequenceIndex}:${terminalMode?.kind ?? "sequence"}:${assetId}`}
        source={{ src: media.variant.uri, type: media.variant.mediaType }}
        ariaLabel={t("videoLabel", { nodeId: renderer.instanceId })}
        controlDensity="full"
        autoPlay={config.autoplay && terminalMode?.kind !== "held"}
        muted={media.asset.audioMode === "none"}
        loop={terminalMode?.kind === "loop"}
        clipStartTime={terminalMode?.kind === "loop" ? terminalMode.clipStartTime : undefined}
        poster={poster}
        fit={config.fit}
        onEnd={handleEnd}
        onTimeUpdate={(currentTimeSeconds) =>
          onTimelineTimeMs(timelineOffsetMs + Math.round(currentTimeSeconds * 1_000))
        }
        onPlaybackError={() => onRuntimeError(t("errors.media", { assetId }))}
        className="size-full"
      />
    </div>
  );
}

function CoreChoiceRenderer({
  manifest,
  renderer,
  runtimeState,
  open,
  locale,
  onSelect,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  runtimeState: ExperienceRuntimeState;
  open: boolean;
  locale: string;
  onSelect: (choiceId: string) => void;
}) {
  const t = useTranslations("storyStudio.build.player");
  const promptId = useId();
  const config = ExperienceCoreChoiceRendererConfigSchema.parse(renderer.config);
  const visible = config.initiallyOpen || open;
  if (!visible) return null;
  const choices = config.choices.filter(
    (choice) =>
      !choice.visibleWhen ||
      evaluateExperienceCondition(choice.visibleWhen, runtimeState, {
        type: "runtime.visibility",
      })
  );

  return (
    <div
      role="group"
      aria-labelledby={promptId}
      className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/88 to-transparent px-5 pt-20 pb-5 sm:px-7 sm:pb-7"
      style={{ zIndex: renderer.layer }}
    >
      <p id={promptId} className="text-center text-sm font-semibold text-white sm:text-base">
        {localize(config.prompt, locale, manifest.localization.defaultLocale)}
      </p>
      {choices.length > 0 ? (
        <div className="mx-auto mt-4 grid max-w-2xl gap-2 sm:grid-cols-2">
          {choices.map((choice) => (
            <button
              key={choice.choiceId}
              type="button"
              onClick={() => onSelect(choice.choiceId)}
              className="min-h-12 rounded-xl bg-white/[0.12] px-4 py-3 text-left text-xs font-semibold text-white backdrop-blur-xl transition hover:bg-white/[0.18] focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none"
              aria-label={
                choice.accessibilityLabel
                  ? localize(choice.accessibilityLabel, locale, manifest.localization.defaultLocale)
                  : undefined
              }
            >
              {localize(choice.label, locale, manifest.localization.defaultLocale)}
            </button>
          ))}
        </div>
      ) : (
        <p role="alert" className="mt-3 text-center text-xs text-white/52">
          {t("noVisibleChoices")}
        </p>
      )}
    </div>
  );
}

function CoreCheckpointRenderer({
  renderer,
  open,
  onSelect,
}: {
  renderer: ExperienceRendererInstance;
  open: boolean;
  onSelect: (actionId: string) => void;
}) {
  const t = useTranslations("storyStudio.build.player");
  const titleId = useId();
  const config = ExperienceCoreCheckpointRendererConfigSchema.parse(renderer.config);
  if (!config.initiallyOpen && !open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="absolute inset-0 flex items-end bg-gradient-to-t from-black via-black/90 to-black/20 px-5 pt-24 pb-5 text-center sm:px-7 sm:pb-7"
      style={{ zIndex: renderer.layer }}
    >
      <div className="mx-auto max-w-xl rounded-[20px] bg-white/[0.09] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.42)] backdrop-blur-2xl sm:p-5">
        <p id={titleId} className="text-sm font-semibold text-white">
          {t("checkpoint.prompt")}
        </p>
        <p className="mt-1.5 text-xs leading-5 text-white/48">{t("checkpoint.description")}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {config.actionIds.map((actionId) => (
            <Button
              key={actionId}
              type="button"
              variant="default"
              size="lg"
              className="min-w-40"
              onClick={() => onSelect(actionId)}
            >
              {t("checkpoint.continue")}
              <IconArrowRight className="size-4" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerFrame({
  frameProfile,
  style,
  children,
}: {
  frameProfile: StoryFrameProfile;
  style?: CSSProperties;
  children: React.ReactNode;
}) {
  const t = useTranslations("storyStudio.build.player");
  return (
    <div
      role="region"
      aria-label={t("regionLabel")}
      style={style}
      className={cn(
        "relative mx-auto w-full overflow-hidden rounded-2xl bg-[var(--experience-color-background,#000)] text-[var(--experience-color-text,#fff)] shadow-2xl",
        frameProfile === "portrait_9_16" ? "aspect-[9/16] max-w-[440px]" : "aspect-video"
      )}
    >
      {children}
    </div>
  );
}

function findGraphNode(
  manifest: ExperienceRuntimeManifest,
  sceneId: string
): ExperienceGraphNode | undefined {
  return manifest.graph.nodes.find((node) => node.sceneId === sceneId);
}

function resolvePlaybackLocale(
  manifest: ExperienceRuntimeManifest,
  requestedLocale: string
): string {
  if (manifest.localization.locales.includes(requestedLocale)) return requestedLocale;
  const requestedLanguage = requestedLocale.split("-")[0]?.toLowerCase();
  const sameLanguage = manifest.localization.locales.find(
    (locale) => locale.split("-")[0]?.toLowerCase() === requestedLanguage
  );
  return sameLanguage ?? manifest.localization.defaultLocale;
}

function localize(value: ExperienceLocalizedText, locale: string, defaultLocale: string): string {
  return value[locale] ?? value[defaultLocale] ?? Object.values(value)[0] ?? "";
}

function resolveVideoMedia(
  assets: readonly ExperienceRuntimeAsset[],
  assetId: string,
  frameProfile: StoryFrameProfile
): { asset: ExperienceVideoAsset; variant: ExperienceVideoAsset["variants"][number] } | null {
  const asset = assets.find(
    (candidate): candidate is ExperienceVideoAsset =>
      candidate.assetId === assetId && candidate.kind === "video"
  );
  if (!asset) return null;
  const orientation = frameProfile === "portrait_9_16" ? "portrait" : "landscape";
  const variant =
    asset.variants.find((candidate) => candidate.orientation === orientation) ?? asset.variants[0];
  return variant ? { asset, variant } : null;
}

function resolveImageUri(
  assets: readonly ExperienceRuntimeAsset[],
  assetId: string,
  frameProfile: StoryFrameProfile
): string | undefined {
  const asset = assets.find(
    (candidate): candidate is ExperienceImageAsset =>
      candidate.assetId === assetId && candidate.kind === "image"
  );
  if (!asset) return undefined;
  const orientation = frameProfile === "portrait_9_16" ? "portrait" : "landscape";
  return (
    asset.variants.find((candidate) => candidate.orientation === orientation) ?? asset.variants[0]
  )?.uri;
}

function sequenceTimelineOffsetMs(
  assets: readonly ExperienceRuntimeAsset[],
  config: ExperienceCoreVideoRendererConfig,
  sequenceIndex: number,
  frameProfile: StoryFrameProfile
): number {
  return config.sequence.slice(0, sequenceIndex).reduce((total, clip) => {
    const media = resolveVideoMedia(assets, clip.assetId, frameProfile);
    return total + (media?.variant.durationMs ?? 0);
  }, 0);
}

function runtimeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown experience runtime error";
}

function themeStyle(theme: ExperienceThemeConfig): CSSProperties & Record<`--${string}`, string> {
  const token = (key: string, fallback: string): string => {
    const value = theme.tokens[key];
    return value === undefined ? fallback : String(value);
  };
  return {
    colorScheme: theme.colorScheme,
    "--experience-color-background": token("color.background", "#000000"),
    "--experience-color-surface": token("color.surface", "#18181a"),
    "--experience-color-text": token("color.text", "#ffffff"),
    "--experience-color-text-muted": token("color.textMuted", "#a1a1aa"),
    "--experience-color-accent": token("color.accent", "#ef233c"),
    "--experience-radius-panel": `${token("radius.panel", "20")}px`,
    "--experience-spacing-unit": `${token("spacing.unit", "4")}px`,
  };
}
