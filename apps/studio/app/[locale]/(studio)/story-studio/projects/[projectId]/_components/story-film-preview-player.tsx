"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconPlayerPlayFilled,
  IconRefresh,
  IconRoute,
} from "@tabler/icons-react";
import {
  InteractiveFilmReleaseSchema,
  type InteractiveFilmRelease,
  type RuntimeImageAsset,
  type RuntimeVideoAsset,
  type RuntimeVideoVariant,
  type RuntimeVisualVariant,
} from "@repo/shared/interactive-film-runtime";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StoryFrameProfile } from "@/lib/story-projects-api";
import {
  createFilmChoiceTransition,
  createFilmCheckpointTransition,
  createStoryFilmPreviewSession,
  filmSequenceTimeSeconds,
  filmTimecodeDelayWithinHoldMs,
  isFilmRouterNode,
  localizedFilmText,
  resolveFilmPlaybackLocale,
  resolveFilmRuntimeNode,
  resolveFilmSequenceEndAction,
  selectFilmAutoRoute,
  STORY_CHECKPOINT_RENDERER_ID,
  visibleFilmChoices,
  type StoryFilmPreviewSession,
} from "./story-film-runtime";

export function StoryFilmPreviewPlayer({
  runtime,
  locale,
  frameProfile,
}: {
  runtime: Record<string, unknown>;
  locale: string;
  frameProfile: StoryFrameProfile;
}) {
  const t = useTranslations("storyStudio.build.player");
  const parsed = useMemo(() => InteractiveFilmReleaseSchema.safeParse(runtime), [runtime]);

  if (!parsed.success) {
    return (
      <div role="alert" className="rounded-2xl bg-destructive/10 p-5 text-destructive">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <IconAlertTriangle className="size-4" />
          {t("invalidManifest")}
        </div>
        <ul className="mt-3 space-y-1.5 font-mono text-[10px] leading-5 text-destructive/78">
          {parsed.error.issues.slice(0, 8).map((issue, index) => (
            <li key={`${issue.path.join(".")}:${index}`}>
              {issue.path.join(".") || t("manifestRoot")} — {issue.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ParsedStoryFilmPreviewPlayer
      key={`${parsed.data.releaseId}:${parsed.data.contentVersion}`}
      release={parsed.data}
      locale={locale}
      frameProfile={frameProfile}
    />
  );
}

function ParsedStoryFilmPreviewPlayer({
  release,
  locale,
  frameProfile,
}: {
  release: InteractiveFilmRelease;
  locale: string;
  frameProfile: StoryFrameProfile;
}) {
  const t = useTranslations("storyStudio.build.player");
  const choicePromptId = useId();
  const [restartKey, setRestartKey] = useState(0);
  const [navigation, setNavigation] = useState(() => ({
    nodeId: release.entryNodeId,
    session: createStoryFilmPreviewSession(release.initialState),
  }));
  const [sequenceIndex, setSequenceIndex] = useState(0);
  const [choicesVisible, setChoicesVisible] = useState(false);
  const [checkpointVisible, setCheckpointVisible] = useState(false);
  const [choiceSelected, setChoiceSelected] = useState(false);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [reaction, setReaction] = useState<{
    assetId: string;
    nextNodeId: string;
    session: StoryFilmPreviewSession;
  } | null>(null);
  const [loopAssetId, setLoopAssetId] = useState<string | null>(null);
  const [loopTailSeconds, setLoopTailSeconds] = useState<number | null>(null);
  const [hold, setHold] = useState<{
    durationMs: number;
    sequenceIndex: number | null;
    choiceDelayMs: number | null;
  } | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const resolution = useMemo(
    () => resolveFilmRuntimeNode(release, navigation.nodeId, navigation.session),
    [navigation, release]
  );
  const scene = resolution.ok && !isFilmRouterNode(resolution.node) ? resolution.node : null;
  const session = navigation.session;
  const playbackLocale = resolveFilmPlaybackLocale(release.locales, locale, release.defaultLocale);

  const resetScenePlayback = useCallback(() => {
    setSequenceIndex(0);
    setChoicesVisible(false);
    setCheckpointVisible(false);
    setChoiceSelected(false);
    setReaction(null);
    setLoopAssetId(null);
    setLoopTailSeconds(null);
    setHold(null);
    setRuntimeError(null);
  }, []);

  const transitionTo = useCallback(
    (nextNodeId: string, nextSession: StoryFilmPreviewSession) => {
      resetScenePlayback();
      setEndingId(null);
      setNavigation({ nodeId: nextNodeId, session: nextSession });
      // A valid route may loop back to the same node and asset. Bump the
      // playback epoch so React always remounts the ended media element.
      setRestartKey((value) => value + 1);
    },
    [resetScenePlayback]
  );

  const completeScene = useCallback(() => {
    if (!scene) return;
    switch (scene.exit.kind) {
      case "auto": {
        const route = selectFilmAutoRoute(scene.exit, session);
        if (route) transitionTo(route.nextNodeId, session);
        else setRuntimeError(t("errors.noRoute", { nodeId: scene.nodeId }));
        break;
      }
      case "choice":
        setChoicesVisible(true);
        break;
      case "ending":
        setEndingId(scene.exit.endingId);
        break;
      case "external-overlay":
        if (
          scene.exit.rendererId === STORY_CHECKPOINT_RENDERER_ID &&
          createFilmCheckpointTransition(session, scene.exit)
        ) {
          setCheckpointVisible(true);
        } else if (scene.exit.rendererId === STORY_CHECKPOINT_RENDERER_ID) {
          setRuntimeError(t("errors.checkpointContract", { nodeId: scene.nodeId }));
        } else {
          setRuntimeError(t("errors.externalOverlay", { rendererId: scene.exit.rendererId }));
        }
        break;
    }
  }, [scene, session, t, transitionTo]);

  useEffect(() => {
    if (!hold) return;
    const completionTimer = window.setTimeout(() => {
      setHold(null);
      if (hold.sequenceIndex === null) completeScene();
      else setSequenceIndex(hold.sequenceIndex);
    }, hold.durationMs);
    const choiceTimer =
      hold.choiceDelayMs === null
        ? null
        : window.setTimeout(() => setChoicesVisible(true), hold.choiceDelayMs);
    return () => {
      window.clearTimeout(completionTimer);
      if (choiceTimer !== null) window.clearTimeout(choiceTimer);
    };
  }, [completeScene, hold]);

  const restart = () => {
    resetScenePlayback();
    const initialSession = createStoryFilmPreviewSession(release.initialState);
    setNavigation({ nodeId: release.entryNodeId, session: initialSession });
    setEndingId(null);
    setRuntimeError(null);
    setRestartKey((value) => value + 1);
  };

  if (!resolution.ok) {
    return (
      <PlayerFrame frameProfile={frameProfile}>
        <PlayerMessage
          title={t("errors.runtimeTitle")}
          description={t(`errors.${resolution.code}`, { nodeId: resolution.nodeId })}
          onRestart={restart}
        />
      </PlayerFrame>
    );
  }

  if (!scene) {
    return (
      <PlayerFrame frameProfile={frameProfile}>
        <PlayerMessage
          title={t("errors.runtimeTitle")}
          description={t("errors.routerNotResolved")}
          onRestart={restart}
        />
      </PlayerFrame>
    );
  }

  const ending = endingId
    ? (release.endings.find((candidate) => candidate.endingId === endingId) ?? null)
    : null;
  const shouldShowChoices =
    !runtimeError &&
    !choiceSelected &&
    scene.exit.kind === "choice" &&
    (choicesVisible || scene.exit.trigger.kind === "overlay-ready");
  const choices =
    shouldShowChoices && scene.exit.kind === "choice"
      ? visibleFilmChoices(scene.exit, session)
      : [];
  const checkpointTransition =
    checkpointVisible && scene.exit.kind === "external-overlay"
      ? createFilmCheckpointTransition(session, scene.exit)
      : null;

  const selectChoice = (choice: (typeof choices)[number]) => {
    const transition = createFilmChoiceTransition(session, choice);
    setChoicesVisible(false);
    setChoiceSelected(true);
    if (transition.reactionAssetId) {
      setReaction({
        assetId: transition.reactionAssetId,
        nextNodeId: transition.nextNodeId,
        session: transition.session,
      });
      return;
    }
    transitionTo(transition.nextNodeId, transition.session);
  };

  const onSceneVideoEnded = () => {
    if (reaction) {
      transitionTo(reaction.nextNodeId, reaction.session);
      return;
    }
    if (scene.presentation.kind !== "video") return;
    if (loopTailSeconds !== null) return;
    if (loopAssetId) return;

    const sequence = scene.presentation.sequence;
    const clip = sequence[sequenceIndex];
    if (!clip) {
      setRuntimeError(t("errors.sequence", { nodeId: scene.nodeId }));
      return;
    }
    const action = resolveFilmSequenceEndAction(clip, sequenceIndex, sequence.length);
    switch (action.kind) {
      case "advance":
        setSequenceIndex(action.sequenceIndex);
        break;
      case "hold":
        setHold({
          durationMs: action.durationMs,
          sequenceIndex: action.sequenceIndex,
          choiceDelayMs:
            scene.exit.kind === "choice" && scene.exit.trigger.kind === "timecode"
              ? filmTimecodeDelayWithinHoldMs(
                  scene.exit.trigger.atSeconds,
                  filmSequenceTimeSeconds(
                    sequenceDurationsSeconds,
                    sequenceIndex,
                    resolveVideoMedia(release, clip.assetId, frameProfile)?.durationSeconds ?? 0
                  ),
                  action.durationMs
                )
              : null,
        });
        break;
      case "complete":
        completeScene();
        break;
      case "loop-tail":
        setLoopTailSeconds(action.tailSeconds);
        completeScene();
        break;
      case "loop":
        setLoopAssetId(action.assetId);
        completeScene();
        break;
    }
  };

  const sequenceDurationsSeconds =
    scene.presentation.kind === "video"
      ? scene.presentation.sequence.map((clip) => {
          const duration =
            resolveVideoMedia(release, clip.assetId, frameProfile)?.durationSeconds ?? 0;
          const holdSeconds =
            clip.endBehavior.behavior === "hold-last-frame" && clip.endBehavior.durationMs
              ? clip.endBehavior.durationMs / 1_000
              : 0;
          return duration + holdSeconds;
        })
      : [];

  const onTimeUpdate = (seconds: number) => {
    if (
      scene.exit.kind === "choice" &&
      scene.exit.trigger.kind === "timecode" &&
      filmSequenceTimeSeconds(sequenceDurationsSeconds, sequenceIndex, seconds) >=
        scene.exit.trigger.atSeconds
    ) {
      setChoicesVisible(true);
    }
  };

  const reactionMedia = reaction
    ? resolveVideoMedia(release, reaction.assetId, frameProfile)
    : null;
  const sequenceClip =
    scene.presentation.kind === "video" ? scene.presentation.sequence[sequenceIndex] : undefined;
  const sceneAssetId = loopAssetId ?? sequenceClip?.assetId ?? null;
  const sceneMedia = sceneAssetId ? resolveVideoMedia(release, sceneAssetId, frameProfile) : null;
  const posterAssetId =
    scene.presentation.kind === "video"
      ? (sequenceClip?.posterAssetId ?? scene.presentation.posterAssetId)
      : undefined;
  const poster = posterAssetId
    ? resolveImageMedia(release, posterAssetId, frameProfile)?.src
    : undefined;
  const imageAssetId = scene.presentation.kind === "image" ? scene.presentation.assetId : null;
  const imageMedia = imageAssetId ? resolveImageMedia(release, imageAssetId, frameProfile) : null;

  return (
    <PlayerFrame frameProfile={frameProfile}>
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/65 to-transparent p-4">
        <div className="min-w-0">
          <p className="truncate font-mono text-[10px] text-white/52">{scene.nodeId}</p>
          {resolution.traversedNodeIds.length > 1 ? (
            <p className="mt-1 flex items-center gap-1 text-[10px] text-white/34">
              <IconRoute className="size-3" />
              {t("routerHops", { count: resolution.traversedNodeIds.length - 1 })}
            </p>
          ) : null}
          {playbackLocale !== locale ? (
            <p className="mt-1 text-[10px] text-white/34">
              {t("localeFallback", { locale: playbackLocale })}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={restart}
          aria-label={t("restart")}
        >
          <IconRefresh className="size-3.5" />
          {t("restart")}
        </Button>
      </div>

      {reaction ? (
        reactionMedia ? (
          <PlaybackVideo
            key={`${restartKey}:${scene.nodeId}:reaction:${reaction.assetId}`}
            media={reactionMedia}
            fit={scene.presentation.kind === "extension" ? "cover" : scene.presentation.fit}
            ariaLabel={t("reactionVideoLabel", { nodeId: scene.nodeId })}
            loop={false}
            loopTailSeconds={null}
            onEnded={onSceneVideoEnded}
            onTimeUpdate={() => undefined}
            onPlaybackError={() =>
              setRuntimeError(t("errors.media", { assetId: reaction.assetId }))
            }
          />
        ) : (
          <PlayerMessage
            title={t("errors.mediaTitle")}
            description={t("errors.media", { assetId: reaction.assetId })}
            onRestart={restart}
          />
        )
      ) : scene.presentation.kind === "video" ? (
        sceneMedia ? (
          <PlaybackVideo
            key={`${restartKey}:${scene.nodeId}:${sceneAssetId}:${sequenceIndex}`}
            media={sceneMedia}
            poster={poster}
            fit={scene.presentation.fit}
            ariaLabel={t("videoLabel", { nodeId: scene.nodeId })}
            loop={Boolean(loopAssetId)}
            loopTailSeconds={loopTailSeconds}
            onEnded={onSceneVideoEnded}
            onTimeUpdate={onTimeUpdate}
            onPlaybackError={() =>
              setRuntimeError(t("errors.media", { assetId: sceneAssetId ?? "" }))
            }
          />
        ) : (
          <PlayerMessage
            title={t("errors.mediaTitle")}
            description={t("errors.media", {
              assetId: sceneAssetId ?? t("errors.unknownAsset"),
            })}
            onRestart={restart}
          />
        )
      ) : scene.presentation.kind === "image" ? (
        imageMedia ? (
          <RuntimeImagePresentation
            key={`${restartKey}:${scene.nodeId}:${imageAssetId}`}
            media={imageMedia}
            fit={scene.presentation.fit}
            frameProfile={frameProfile}
            alt={t("imageAlt")}
            onReady={completeScene}
            onError={() => setRuntimeError(t("errors.media", { assetId: imageAssetId ?? "" }))}
          />
        ) : (
          <PlayerMessage
            title={t("errors.mediaTitle")}
            description={t("errors.media", {
              assetId: imageAssetId ?? t("errors.unknownAsset"),
            })}
            onRestart={restart}
          />
        )
      ) : (
        <PlayerMessage
          title={t("errors.extensionTitle")}
          description={t("errors.extension", { rendererId: scene.presentation.rendererId })}
          onRestart={restart}
        />
      )}

      {shouldShowChoices && scene.exit.kind === "choice" ? (
        <div
          role="group"
          aria-labelledby={choicePromptId}
          className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black via-black/88 to-transparent px-5 pt-20 pb-5 sm:px-7 sm:pb-7"
        >
          <p
            id={choicePromptId}
            aria-live="polite"
            className="text-center text-sm font-semibold text-white sm:text-base"
          >
            {localizedFilmText(scene.exit.prompt, playbackLocale, release.defaultLocale)}
          </p>
          {choices.length > 0 ? (
            <div className="mx-auto mt-4 grid max-w-2xl gap-2 sm:grid-cols-2">
              {choices.map((choice, index) => (
                <button
                  key={choice.choiceId}
                  type="button"
                  onClick={() => selectChoice(choice)}
                  autoFocus={index === 0}
                  className="min-h-12 rounded-xl bg-white/[0.12] px-4 py-3 text-left text-xs font-semibold text-white backdrop-blur-xl transition hover:bg-white/[0.18] focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none"
                  aria-label={
                    choice.accessibilityLabel
                      ? localizedFilmText(
                          choice.accessibilityLabel,
                          playbackLocale,
                          release.defaultLocale
                        )
                      : undefined
                  }
                >
                  {localizedFilmText(choice.label, playbackLocale, release.defaultLocale)}
                </button>
              ))}
            </div>
          ) : (
            <div role="alert" className="mt-3 text-center">
              <p className="text-xs text-white/52">{t("noVisibleChoices")}</p>
              <Button
                type="button"
                variant="secondary"
                className="mt-4"
                autoFocus
                onClick={restart}
              >
                <IconRefresh className="size-3.5" />
                {t("restart")}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {checkpointVisible && checkpointTransition && !runtimeError ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${choicePromptId}-checkpoint`}
          className="absolute inset-0 z-40 flex items-end bg-gradient-to-t from-black via-black/90 to-black/20 px-5 pt-24 pb-5 text-center sm:px-7 sm:pb-7"
        >
          <div className="mx-auto max-w-xl rounded-[20px] bg-white/[0.09] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.42)] backdrop-blur-2xl sm:p-5">
            <p
              id={`${choicePromptId}-checkpoint`}
              aria-live="polite"
              className="text-sm font-semibold text-white"
            >
              {t("checkpoint.prompt")}
            </p>
            <p className="mt-1.5 text-xs leading-5 text-white/48">{t("checkpoint.description")}</p>
            <Button
              type="button"
              variant="default"
              size="lg"
              className="mt-4 min-w-40"
              autoFocus
              aria-label={t("checkpoint.actionLabel")}
              onClick={() => {
                setCheckpointVisible(false);
                transitionTo(checkpointTransition.nextNodeId, checkpointTransition.session);
              }}
            >
              {t("checkpoint.continue")}
              <IconArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {endingId && !runtimeError ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${choicePromptId}-ending`}
          className="absolute inset-0 z-50 grid place-items-center bg-black/78 p-6 text-center backdrop-blur-md"
        >
          <div className="max-w-lg">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-white/42 uppercase">
              {t("endingEyebrow")}
            </p>
            <h3
              id={`${choicePromptId}-ending`}
              className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-white"
            >
              {ending
                ? localizedFilmText(ending.title, playbackLocale, release.defaultLocale)
                : t("unknownEnding", { endingId })}
            </h3>
            {ending?.summary ? (
              <p className="mt-3 text-sm leading-6 text-white/56">
                {localizedFilmText(ending.summary, playbackLocale, release.defaultLocale)}
              </p>
            ) : null}
            <Button
              type="button"
              variant="default"
              size="lg"
              className="mt-6"
              autoFocus
              onClick={restart}
            >
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
          aria-labelledby={`${choicePromptId}-runtime-error`}
          className="absolute inset-0 z-[60] grid place-items-center bg-black/82 p-6 text-center backdrop-blur-md"
        >
          <div className="max-w-md">
            <IconAlertTriangle className="mx-auto size-6 text-destructive" />
            <h3
              id={`${choicePromptId}-runtime-error`}
              className="mt-4 text-sm font-semibold text-white"
            >
              {t("errors.runtimeTitle")}
            </h3>
            <p className="mt-2 text-xs leading-5 text-white/56">{runtimeError}</p>
            <Button type="button" variant="secondary" className="mt-5" autoFocus onClick={restart}>
              <IconRefresh className="size-3.5" />
              {t("restart")}
            </Button>
          </div>
        </div>
      ) : null}
    </PlayerFrame>
  );
}

function PlayerFrame({
  frameProfile,
  children,
}: {
  frameProfile: StoryFrameProfile;
  children: React.ReactNode;
}) {
  const t = useTranslations("storyStudio.build.player");
  return (
    <div
      role="region"
      aria-label={t("regionLabel")}
      className={cn(
        "relative mx-auto w-full overflow-hidden rounded-2xl bg-black shadow-2xl",
        frameProfile === "portrait_9_16" ? "aspect-[9/16] max-w-[440px]" : "aspect-video"
      )}
    >
      {children}
    </div>
  );
}

function PlayerMessage({
  title,
  description,
  onRestart,
}: {
  title: string;
  description: string;
  onRestart: () => void;
}) {
  const t = useTranslations("storyStudio.build.player");
  return (
    <div role="alert" className="absolute inset-0 grid place-items-center p-6 text-center">
      <div className="max-w-md">
        <IconAlertTriangle className="mx-auto size-6 text-white/48" />
        <h3 className="mt-4 text-sm font-semibold text-white">{title}</h3>
        <p className="mt-2 text-xs leading-5 text-white/48">{description}</p>
        <Button type="button" variant="secondary" className="mt-5" onClick={onRestart}>
          <IconRefresh className="size-3.5" />
          {t("restart")}
        </Button>
      </div>
    </div>
  );
}

function PlaybackVideo({
  media,
  poster,
  fit,
  ariaLabel,
  loop,
  loopTailSeconds,
  onEnded,
  onTimeUpdate,
  onPlaybackError,
}: {
  media: ResolvedVideoMedia;
  poster?: string;
  fit: "cover" | "contain";
  ariaLabel: string;
  loop: boolean;
  loopTailSeconds: number | null;
  onEnded: () => void;
  onTimeUpdate: (seconds: number) => void;
  onPlaybackError: () => void;
}) {
  const t = useTranslations("storyStudio.build.player");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [gestureRequired, setGestureRequired] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setGestureRequired(false);
    const playback = video.play();
    if (playback) void playback.catch(() => setGestureRequired(true));
  }, [media.src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || loopTailSeconds === null) return;
    const playTail = () => {
      video.currentTime = Math.max(0, video.duration - loopTailSeconds);
      void video.play().catch(() => setGestureRequired(true));
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) playTail();
    else video.addEventListener("loadedmetadata", playTail, { once: true });
    return () => video.removeEventListener("loadedmetadata", playTail);
  }, [loopTailSeconds]);

  const ended = () => {
    const video = videoRef.current;
    if (video && loopTailSeconds !== null) {
      video.currentTime = Math.max(0, video.duration - loopTailSeconds);
      void video.play().catch(() => setGestureRequired(true));
      return;
    }
    onEnded();
  };

  return (
    <>
      <video
        ref={videoRef}
        className={cn("size-full bg-black", fit === "cover" ? "object-cover" : "object-contain")}
        aria-label={ariaLabel}
        src={media.src}
        poster={poster}
        autoPlay
        playsInline
        controls
        loop={loop}
        muted={media.audio === "none"}
        preload="auto"
        onEnded={ended}
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
        onError={onPlaybackError}
      />
      {gestureRequired ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("playbackPaused")}
          className="absolute inset-0 z-10 grid place-items-center bg-black/46 backdrop-blur-sm"
        >
          <Button
            type="button"
            variant="default"
            size="lg"
            autoFocus
            onClick={() => {
              const playback = videoRef.current?.play();
              if (playback)
                void playback.then(() => setGestureRequired(false)).catch(onPlaybackError);
            }}
          >
            <IconPlayerPlayFilled className="size-4" />
            {t("play")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function RuntimeImagePresentation({
  media,
  fit,
  frameProfile,
  alt,
  onReady,
  onError,
}: {
  media: RuntimeVisualVariant;
  fit: "cover" | "contain";
  frameProfile: StoryFrameProfile;
  alt: string;
  onReady: () => void;
  onError: () => void;
}) {
  return (
    <Image
      src={media.src}
      alt={alt}
      fill
      unoptimized
      sizes={frameProfile === "portrait_9_16" ? "440px" : "(max-width: 1280px) 100vw, 1200px"}
      className={fit === "cover" ? "object-cover" : "object-contain"}
      onLoad={onReady}
      onError={onError}
    />
  );
}

interface ResolvedVideoMedia extends RuntimeVideoVariant {
  audio: RuntimeVideoAsset["audio"];
}

function resolveVideoMedia(
  release: InteractiveFilmRelease,
  assetId: string,
  frameProfile: StoryFrameProfile
): ResolvedVideoMedia | null {
  const asset = release.media.find(
    (candidate): candidate is RuntimeVideoAsset =>
      candidate.assetId === assetId && candidate.kind === "video"
  );
  if (!asset) return null;
  const variant = selectVisualVariant(asset, frameProfile);
  return variant ? { ...variant, audio: asset.audio } : null;
}

function resolveImageMedia(
  release: InteractiveFilmRelease,
  assetId: string,
  frameProfile: StoryFrameProfile
): RuntimeVisualVariant | null {
  const asset = release.media.find(
    (candidate): candidate is RuntimeImageAsset =>
      candidate.assetId === assetId && candidate.kind === "image"
  );
  return asset ? selectVisualVariant(asset, frameProfile) : null;
}

function selectVisualVariant<T extends RuntimeVisualVariant>(
  asset: { variants: { landscape?: T; portrait?: T } },
  frameProfile: StoryFrameProfile
): T | null {
  const preferred =
    frameProfile === "portrait_9_16" ? asset.variants.portrait : asset.variants.landscape;
  return preferred ?? asset.variants.landscape ?? asset.variants.portrait ?? null;
}
