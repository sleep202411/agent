"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBook2,
  IconChevronRight,
  IconFeather,
  IconRefresh,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  FilmSequenceStage,
  type ResolvedFilmSequenceClip,
} from "../../interactive-film/media/film-sequence-stage";
import {
  projectNormalizedSafeAreaToViewport,
  selectResponsiveVisualVariant,
  type ViewportRect,
} from "../../interactive-film/media/responsive-media";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import {
  completeJinlingProfileDraft,
  createEmptyJinlingProfileDraft,
  JinlingProfileDraftRepository,
  type JinlingProfileDraft,
} from "../content/profile-draft";
import { JinlingPlayerProfileSchema } from "../content/player-profile";
import {
  createJinlingSessionRepository,
  createNewJinlingSession,
  type JinlingGameSession,
} from "../content/session";
import { jinlingAudio } from "../content/media-release";
import { p00DataAsset, p00ImageAsset, p00SceneNode, p00VideoAsset } from "../content/p00-release";
import { LedgerCharacterCreator, type CreationStep } from "./LedgerCharacterCreator";
import { JinlingStoryPlayer } from "./JinlingStoryPlayer";

gsap.registerPlugin(useGSAP);

type EntryPhase =
  | "loading"
  | "title"
  | "archive"
  | "creation"
  | "confirming"
  | "sealed"
  | "story"
  | "error";
type EntryErrorKind = "local-state" | "media";
type StageNode = "opening" | "confirm";
type ConfirmCue = "waiting" | "name" | "seal" | "settled";

const P00_ESTABLISHING_CLIP_ID = "S01-P00-B01-WATER-ESTABLISHING-CLIP";
const P00_CONFIRM_CLIP_ID = "S01-P00-B03-CONFIRM-CLIP";
const P00_POSTER = p00ImageAsset("S01-P00-B02-IMG-MATTE-TAIXU");
const P00_CONFIRM_VIDEO = p00VideoAsset("S01-P00-B03-VIDEO-CONFIRM");
const P00_CONFIRM_POSTER = p00ImageAsset("S01-P00-B03-IMG-CONFIRM-FIRST");
const P00_SEAL_MASK = p00DataAsset("S01-P00-B03-TEXTURE-SEAL-MASK");
const P00_CREATE_NODE = p00SceneNode("S01-P00-CREATE");
const P00_CONFIRM_NODE = p00SceneNode("S01-P00-CONFIRM");
const P00_AUDIO = {
  ambience: jinlingAudio("s01-p00-ambience-v1.wav"),
  profileReady: jinlingAudio("s01-p00-b02-vo-01-v1.wav"),
} as const;
const P00_NAME_OVERLAY = (() => {
  const overlay = P00_CONFIRM_NODE.overlays.find(
    (candidate) => candidate.kind === "bound-text" && candidate.binding === "player.displayName"
  );
  if (!overlay) throw new Error("P00 confirm node is missing its authored player-name overlay");
  return overlay;
})();
const P00_SEAL_OVERLAY = (() => {
  const overlay = P00_CONFIRM_NODE.overlays.find(
    (candidate) => candidate.kind === "seal" && candidate.assetId === P00_SEAL_MASK.assetId
  );
  if (!overlay) throw new Error("P00 confirm node is missing its authored seal overlay");
  return overlay;
})();

function resolveP00Sequence(nodeId: string): ResolvedFilmSequenceClip[] {
  const node = p00SceneNode(nodeId);
  if (node.presentation.kind !== "video") {
    throw new Error(`P00 scene ${nodeId} must use an authored video sequence`);
  }
  return node.presentation.sequence.map((clip) => ({
    ...clip,
    asset: p00VideoAsset(clip.assetId),
    poster: clip.posterAssetId ? p00ImageAsset(clip.posterAssetId) : undefined,
    loopAsset:
      clip.endBehavior.behavior === "loop" ? p00VideoAsset(clip.endBehavior.assetId) : undefined,
  }));
}

const P00_OPENING_SEQUENCE = resolveP00Sequence(P00_CREATE_NODE.nodeId);
const P00_CONFIRM_SEQUENCE = resolveP00Sequence(P00_CONFIRM_NODE.nodeId);

type ConfirmOverlayLayout = {
  name: ViewportRect;
  seal: ViewportRect;
};

function firstIncompleteStep(draft: JinlingProfileDraft): CreationStep {
  if (!draft.displayName.trim()) return "name";
  if (!draft.origin) return "origin";
  if (!draft.trait) return "trait";
  return "confirm";
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

function useConfirmOverlayLayout(): ConfirmOverlayLayout | null {
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let animationFrame = 0;
    const update = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        setViewport({ width: window.innerWidth, height: window.innerHeight });
      });
    };

    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return useMemo(() => {
    if (!viewport) return null;
    const source = selectResponsiveVisualVariant(P00_CONFIRM_VIDEO, "landscape");
    const nameArea = P00_NAME_OVERLAY.landscapeSafeArea;
    const sealArea = P00_SEAL_OVERLAY.landscapeSafeArea;

    return {
      name: projectNormalizedSafeAreaToViewport(nameArea, source, viewport, "contain"),
      seal: projectNormalizedSafeAreaToViewport(sealArea, source, viewport, "contain"),
    };
  }, [viewport]);
}

export function JinlingGameEntry() {
  const locale = useLocale() as Locale;
  const t = useTranslations("jinlingRumeng");
  const rootRef = useRef<HTMLDivElement>(null);
  const p00AudioRef = useRef(new Map<string, HTMLAudioElement>());
  const sessionRepository = useMemo(() => createJinlingSessionRepository(), []);
  const draftRepository = useMemo(() => new JinlingProfileDraftRepository(), []);
  const reduceMotion = useReducedMotion();
  const confirmOverlayLayout = useConfirmOverlayLayout();

  const [phase, setPhase] = useState<EntryPhase>("loading");
  const [activeSession, setActiveSession] = useState<JinlingGameSession | null>(null);
  const [sessions, setSessions] = useState<JinlingGameSession[]>([]);
  const [draft, setDraft] = useState<JinlingProfileDraft>(() =>
    createEmptyJinlingProfileDraft(new Date().toISOString())
  );
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [creationStep, setCreationStep] = useState<CreationStep>("name");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<EntryErrorKind>("local-state");
  const [mediaPlaybackRevision, setMediaPlaybackRevision] = useState(0);
  const [stageNode, setStageNode] = useState<StageNode>("opening");
  const [activeStageClipId, setActiveStageClipId] = useState(P00_ESTABLISHING_CLIP_ID);
  const [confirmCue, setConfirmCue] = useState<ConfirmCue>("waiting");
  const [soundEnabled, setSoundEnabled] = useState(false);

  const stageSequence = stageNode === "confirm" ? P00_CONFIRM_SEQUENCE : P00_OPENING_SEQUENCE;
  const stagePoster = stageNode === "confirm" ? P00_CONFIRM_POSTER : P00_POSTER;
  const showConfirmName = confirmCue !== "waiting";
  const showConfirmSeal = confirmCue === "seal" || confirmCue === "settled";

  const stopP00Audio = useCallback(() => {
    p00AudioRef.current.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    p00AudioRef.current.clear();
  }, []);

  const playP00Audio = useCallback((cueId: string, src: string, volume: number) => {
    const current = p00AudioRef.current.get(cueId);
    if (current && !current.paused) return;
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.volume = volume;
    p00AudioRef.current.set(cueId, audio);
    void audio.play().catch(() => {
      p00AudioRef.current.delete(cueId);
    });
  }, []);

  useEffect(() => {
    stopP00Audio();
  }, [mediaPlaybackRevision, stageNode, stopP00Audio]);

  useEffect(() => stopP00Audio, [stopP00Audio]);

  const loadLocalState = useCallback(async () => {
    setPhase("loading");
    setErrorDetail(null);
    setErrorKind("local-state");
    setStageNode("opening");
    setConfirmCue("waiting");
    try {
      const [session, savedSessions, savedDraft] = await Promise.all([
        sessionRepository.loadActive(),
        sessionRepository.list(),
        Promise.resolve(draftRepository.load()),
      ]);
      setActiveSession(session);
      setSessions(savedSessions);
      if (savedDraft) {
        setDraft(savedDraft);
        setHasSavedDraft(true);
      } else {
        setDraft(createEmptyJinlingProfileDraft(new Date().toISOString()));
        setHasSavedDraft(false);
      }
      setPhase("title");
    } catch (error) {
      setErrorKind("local-state");
      setErrorDetail(error instanceof Error ? error.message : String(error));
      setPhase("error");
    }
  }, [draftRepository, sessionRepository]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLocalState(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLocalState]);

  useGSAP(
    () => {
      const revealTargets = gsap.utils.toArray<HTMLElement>(".js-entry-reveal, .js-ledger-reveal");
      if (revealTargets.length === 0) return;

      if (reduceMotion) {
        gsap.set(revealTargets, { autoAlpha: 1, x: 0, y: 0 });
        return;
      }

      const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
      timeline.fromTo(
        revealTargets,
        { autoAlpha: 0, y: 18 },
        { autoAlpha: 1, y: 0, duration: 0.75, stagger: 0.075 }
      );
    },
    {
      scope: rootRef,
      dependencies: [phase, creationStep, reduceMotion],
      revertOnUpdate: true,
    }
  );

  const openCreation = (resume: boolean) => {
    const nextDraft = resume ? draft : createEmptyJinlingProfileDraft(new Date().toISOString());
    if (!resume) {
      draftRepository.clear();
      setHasSavedDraft(false);
      setDraft(nextDraft);
    }
    setCreationStep(firstIncompleteStep(nextDraft));
    setPhase("creation");
    setSoundEnabled(true);
    stopP00Audio();
    playP00Audio("P00-AMBIENCE-PROFILE", P00_AUDIO.ambience, 0.42);
    playP00Audio("P00-B02-VO01", P00_AUDIO.profileReady, 0.78);
  };

  const returnToTitle = () => {
    stopP00Audio();
    setStageNode("opening");
    setConfirmCue("waiting");
    setPhase("title");
  };

  const handleConfirmVideoFrame = useCallback((video: HTMLVideoElement) => {
    const nextCue: ConfirmCue =
      video.currentTime >= 4.6
        ? "settled"
        : video.currentTime >= 3
          ? "seal"
          : video.currentTime >= 1.4
            ? "name"
            : "waiting";
    setConfirmCue((current) => (current === nextCue ? current : nextCue));
  }, []);

  const toggleP00Sound = () => {
    if (soundEnabled) {
      setSoundEnabled(false);
      stopP00Audio();
      return;
    }
    setSoundEnabled(true);
    setMediaPlaybackRevision((current) => current + 1);
  };

  const retryMedia = () => {
    setErrorDetail(null);
    setMediaPlaybackRevision((current) => current + 1);
    if (stageNode === "confirm") {
      setConfirmCue(reduceMotion ? "settled" : "waiting");
      setPhase(reduceMotion ? "sealed" : "confirming");
      return;
    }
    setPhase("title");
  };

  const updateDraft = (nextDraft: JinlingProfileDraft) => {
    try {
      draftRepository.save(nextDraft);
      setDraft(nextDraft);
      setHasSavedDraft(true);
    } catch (error) {
      setErrorKind("local-state");
      setErrorDetail(error instanceof Error ? error.message : String(error));
      setPhase("error");
    }
  };

  const completeCreation = async () => {
    try {
      const profileInput = completeJinlingProfileDraft(draft);
      if (!profileInput) {
        throw new Error("The player profile draft is incomplete");
      }
      const profile = JinlingPlayerProfileSchema.parse(profileInput);
      const now = new Date().toISOString();
      const session = createNewJinlingSession({
        sessionId: crypto.randomUUID(),
        profile,
        now,
      });
      await sessionRepository.save(session);
      draftRepository.clear();
      setHasSavedDraft(false);
      setActiveSession(session);
      setSessions((current) => [
        session,
        ...current.filter((item) => item.sessionId !== session.sessionId),
      ]);
      setStageNode("confirm");
      setConfirmCue(reduceMotion ? "settled" : "waiting");
      setPhase(reduceMotion ? "sealed" : "confirming");
      setSoundEnabled(true);
      stopP00Audio();
    } catch (error) {
      setErrorKind("local-state");
      setErrorDetail(error instanceof Error ? error.message : String(error));
      setPhase("error");
    }
  };

  const discardLocalState = async () => {
    try {
      await sessionRepository.clear();
      draftRepository.clear();
      setActiveSession(null);
      setSessions([]);
      setDraft(createEmptyJinlingProfileDraft(new Date().toISOString()));
      setHasSavedDraft(false);
      setErrorDetail(null);
      setErrorKind("local-state");
      setStageNode("opening");
      setConfirmCue("waiting");
      setPhase("title");
    } catch (error) {
      setErrorKind("local-state");
      setErrorDetail(error instanceof Error ? error.message : String(error));
    }
  };

  const openSavedSession = async (session: JinlingGameSession) => {
    try {
      await sessionRepository.setActive(session.sessionId);
      setActiveSession(session);
      setStageNode("opening");
      setConfirmCue("waiting");
      setPhase("sealed");
    } catch (error) {
      setErrorKind("local-state");
      setErrorDetail(error instanceof Error ? error.message : String(error));
      setPhase("error");
    }
  };

  return (
    <main
      ref={rootRef}
      className="fixed inset-0 isolate min-h-dvh overflow-hidden bg-[#020609] text-[#f4ecdc]"
      style={{ fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif' }}
    >
      <FilmSequenceStage
        key={mediaPlaybackRevision}
        clips={stageSequence}
        poster={stagePoster}
        playbackId={`p00-${stageNode}-${mediaPlaybackRevision}`}
        reduceMotion={reduceMotion}
        muted={!soundEnabled}
        fit="contain"
        resumeLabel={t("resumePlayback")}
        className="absolute inset-0"
        onClipChange={(clipId) => setActiveStageClipId(clipId)}
        onVideoFrame={
          stageNode === "confirm"
            ? (clipId, video) => {
                if (clipId === P00_CONFIRM_CLIP_ID) handleConfirmVideoFrame(video);
              }
            : undefined
        }
        onSequenceComplete={() => {
          if (stageNode !== "confirm" || phase !== "confirming") return;
          setConfirmCue("settled");
          setPhase("sealed");
        }}
        onError={(error) => {
          if (error.code !== "MEDIA_LOAD_FAILED") return;
          setErrorKind("media");
          setErrorDetail(error.message);
          setPhase("error");
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(1,4,7,0.25)_0%,rgba(1,4,7,0.03)_34%,rgba(1,4,7,0.76)_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 shadow-[inset_0_0_180px_rgba(0,0,0,0.75)]"
      />

      {(phase === "confirming" || (phase === "sealed" && stageNode === "confirm")) &&
      activeStageClipId === P00_CONFIRM_CLIP_ID &&
      activeSession &&
      confirmOverlayLayout ? (
        <section className="pointer-events-none absolute inset-0 z-10" aria-label={t("stamping")}>
          <div
            aria-hidden
            className={cn(
              "absolute grid place-items-center transition-[opacity,filter,transform] duration-700",
              showConfirmName
                ? "translate-y-0 opacity-100 blur-0"
                : "translate-y-1 opacity-0 blur-[2px]"
            )}
            style={confirmOverlayLayout.name}
          >
            <span
              className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-center tracking-[0.14em] text-[#4a2924]/85 mix-blend-multiply"
              style={{
                fontFamily: '"Noto Serif SC", "Songti SC", ui-serif, Georgia, serif',
                fontSize: Math.max(16, Math.min(36, confirmOverlayLayout.name.height * 0.4)),
              }}
            >
              {activeSession.profile.displayName}
            </span>
          </div>
          <div
            aria-hidden
            className={cn(
              "absolute transition-[opacity,filter,transform] duration-500",
              showConfirmSeal
                ? "scale-100 rotate-[-2deg] opacity-80 blur-0"
                : "scale-[1.14] rotate-[3deg] opacity-0 blur-[3px]"
            )}
            style={confirmOverlayLayout.seal}
          >
            <span
              className="block size-full bg-[#9f292d] mix-blend-multiply"
              style={{
                maskImage: `url("${P00_SEAL_MASK.src}")`,
                maskPosition: "center",
                maskRepeat: "no-repeat",
                maskSize: "contain",
                WebkitMaskImage: `url("${P00_SEAL_MASK.src}")`,
                WebkitMaskPosition: "center",
                WebkitMaskRepeat: "no-repeat",
                WebkitMaskSize: "contain",
              }}
            />
          </div>
          {phase === "confirming" ? (
            <p
              className="absolute inset-x-5 bottom-8 text-center text-[10px] tracking-[0.32em] text-[#e4d7be]/58 sm:bottom-11"
              role="status"
            >
              {t("stamping")}
            </p>
          ) : null}
        </section>
      ) : null}

      <header className="absolute inset-x-0 top-0 z-40 flex items-center justify-between px-4 py-4 sm:px-7 sm:py-6">
        <Link
          href={localizePath("/games", locale)}
          className="inline-flex min-h-11 items-center gap-2 border border-white/10 bg-black/25 px-4 text-sm text-white/75 backdrop-blur-md transition hover:border-white/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
        >
          <IconArrowLeft size={17} />
          {t("back")}
        </Link>
        <div className="flex items-center gap-3 text-right">
          <button
            type="button"
            onClick={toggleP00Sound}
            aria-label={t(soundEnabled ? "story.sound.disable" : "story.sound.enable")}
            className="grid size-11 place-items-center border border-white/10 bg-black/25 text-white/70 backdrop-blur-md transition hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
          >
            {soundEnabled ? <IconVolume size={18} /> : <IconVolumeOff size={18} />}
          </button>
          <div className="hidden items-center gap-3 sm:flex">
            <IconBook2 size={18} className="text-[#b64749]" stroke={1.45} />
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-white/38">
                {t("entry.season")}
              </p>
              <p className="mt-1 text-xs tracking-[0.12em] text-white/70">{t("entry.chapter")}</p>
            </div>
          </div>
        </div>
      </header>

      {phase === "loading" ? (
        <div className="relative z-20 grid min-h-dvh place-items-center px-6" role="status">
          <div className="text-center">
            <span className="mx-auto block size-1.5 animate-pulse rounded-full bg-[#a52a2e]" />
            <p className="mt-5 text-xs tracking-[0.25em] text-white/52">{t("loading")}</p>
          </div>
        </div>
      ) : null}

      {phase === "title" ? (
        <section className="relative z-20 flex min-h-dvh items-end px-5 pb-9 pt-24 sm:px-9 sm:pb-12 lg:px-16 lg:pb-16">
          <div className="w-full max-w-2xl">
            <p className="js-entry-reveal text-[11px] uppercase tracking-[0.36em] text-[#d2c19f]/62">
              {t("entry.season")}
            </p>
            <h1
              className="js-entry-reveal mt-4 text-5xl leading-none tracking-[0.09em] text-[#f2e7cf] sm:text-6xl lg:text-7xl"
              style={{ fontFamily: '"Noto Serif SC", "Songti SC", ui-serif, Georgia, serif' }}
            >
              {t("entry.title")}
            </h1>
            <p
              className="js-entry-reveal mt-6 text-lg leading-8 tracking-[0.06em] text-[#f2e7cf]/78 sm:text-xl"
              style={{ fontFamily: '"Noto Serif SC", "Songti SC", ui-serif, Georgia, serif' }}
            >
              {t("entry.question")}
            </p>
            <p className="js-entry-reveal mt-4 max-w-xl text-sm leading-7 text-white/52">
              {t("entry.description")}
            </p>

            <div className="js-entry-reveal mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              {activeSession ? (
                <button
                  type="button"
                  onClick={() => setPhase("sealed")}
                  className="group inline-flex min-h-14 items-center justify-between gap-7 bg-[#e9ddc5] px-5 text-left text-[#211a12] transition hover:bg-[#f3e8d2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  <span>
                    <span className="block text-[10px] uppercase tracking-[0.22em] text-[#6f5f4b]">
                      {t("entry.continueEyebrow")}
                    </span>
                    <span className="mt-1 block text-sm font-semibold tracking-[0.06em]">
                      {t("entry.continue", { name: activeSession.profile.displayName })}
                    </span>
                  </span>
                  <IconChevronRight className="transition group-hover:translate-x-1" size={19} />
                </button>
              ) : hasSavedDraft ? (
                <button
                  type="button"
                  onClick={() => openCreation(true)}
                  className="group inline-flex min-h-14 items-center justify-between gap-7 bg-[#e9ddc5] px-5 text-left text-[#211a12] transition hover:bg-[#f3e8d2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  <span>
                    <span className="block text-[10px] uppercase tracking-[0.22em] text-[#6f5f4b]">
                      {t("entry.draftEyebrow")}
                    </span>
                    <span className="mt-1 block text-sm font-semibold tracking-[0.06em]">
                      {t("entry.resumeDraft")}
                    </span>
                  </span>
                  <IconChevronRight className="transition group-hover:translate-x-1" size={19} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openCreation(false)}
                  className="group inline-flex min-h-14 items-center justify-between gap-7 bg-[#e9ddc5] px-5 text-left text-[#211a12] transition hover:bg-[#f3e8d2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  <span className="text-sm font-semibold tracking-[0.08em]">
                    {t("entry.begin")}
                  </span>
                  <IconFeather className="transition group-hover:rotate-6" size={18} />
                </button>
              )}

              {activeSession || hasSavedDraft ? (
                <div className="flex flex-wrap items-center">
                  <button
                    type="button"
                    onClick={() => openCreation(false)}
                    className="min-h-12 px-4 text-sm tracking-[0.08em] text-white/64 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
                  >
                    {t("entry.newPage")}
                  </button>
                  {sessions.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setPhase("archive")}
                      className="inline-flex min-h-12 items-center gap-2 px-4 text-sm tracking-[0.08em] text-white/64 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
                    >
                      <IconBook2 size={16} />
                      {t("entry.browsePages", { count: sessions.length })}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <p className="js-entry-reveal mt-5 text-[11px] leading-5 text-white/34">
              {t("entry.localSave")}
            </p>
          </div>
        </section>
      ) : null}

      {phase === "archive" ? (
        <section className="relative z-20 flex min-h-dvh items-end px-3 pb-3 pt-20 sm:px-6 sm:pb-6 lg:items-center lg:px-12 lg:py-24">
          <div className="mx-auto w-full max-w-4xl overflow-hidden border border-[#e6d7b5]/20 bg-[radial-gradient(circle_at_15%_0%,rgba(255,255,255,0.32),transparent_42%),linear-gradient(135deg,#d7c9aa_0%,#c5b38f_48%,#d1c19f_100%)] px-5 pb-6 pt-7 text-[#241c13] shadow-[0_36px_120px_rgba(0,0,0,0.72)] sm:px-9 sm:pb-9 sm:pt-10">
            <div className="js-entry-reveal flex items-start justify-between gap-6 border-b border-[#36291a]/15 pb-6">
              <div>
                <p className="text-[11px] uppercase tracking-[0.32em] text-[#8a2528]">
                  {t("archive.eyebrow")}
                </p>
                <h1
                  className="mt-3 text-3xl text-[#211a12] sm:text-4xl"
                  style={{
                    fontFamily: '"Noto Serif SC", "Songti SC", ui-serif, Georgia, serif',
                  }}
                >
                  {t("archive.title")}
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-[#51483d]">
                  {t("archive.body")}
                </p>
              </div>
              <button
                type="button"
                onClick={returnToTitle}
                className="inline-flex min-h-11 shrink-0 items-center gap-2 px-2 text-sm text-[#493c2e] transition hover:text-[#8a2528] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a2528]"
              >
                <IconArrowLeft size={17} />
                {t("archive.close")}
              </button>
            </div>

            <div className="js-entry-reveal mt-6 grid max-h-[55dvh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
              {sessions.map((session) => {
                const isActive = session.sessionId === activeSession?.sessionId;
                const updatedDate = new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                }).format(new Date(session.updatedAt));
                return (
                  <button
                    key={session.sessionId}
                    type="button"
                    onClick={() => void openSavedSession(session)}
                    className={cn(
                      "group min-h-40 border p-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a2528]",
                      isActive
                        ? "border-[#8a2528]/55 bg-[#8a2528]/[0.07]"
                        : "border-[#36291a]/15 bg-black/[0.025] hover:border-[#36291a]/35"
                    )}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span
                        className="text-2xl tracking-[0.12em] text-[#211a12]"
                        style={{
                          fontFamily: '"Noto Serif SC", "Songti SC", ui-serif, Georgia, serif',
                        }}
                      >
                        {session.profile.displayName}
                      </span>
                      {isActive ? (
                        <span className="text-[10px] uppercase tracking-[0.2em] text-[#8a2528]">
                          {t("archive.active")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-4 block text-sm text-[#4f4334]">
                      {t(`creation.origin.options.${session.profile.origin}.title`)}
                      <span className="mx-2 text-[#7c6a52]/45">·</span>
                      {t(`creation.trait.options.${session.profile.trait}.title`)}
                    </span>
                    <span className="mt-5 flex items-center justify-between text-[11px] text-[#685a46]">
                      {t("archive.updated", { date: updatedDate })}
                      <IconChevronRight
                        className="transition group-hover:translate-x-1"
                        size={16}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {phase === "creation" ? (
        <LedgerCharacterCreator
          draft={draft}
          step={creationStep}
          onDraftChange={updateDraft}
          onStepChange={setCreationStep}
          onCancel={returnToTitle}
          onComplete={() => void completeCreation()}
        />
      ) : null}

      {phase === "sealed" && activeSession ? (
        <section className="relative z-20 flex min-h-dvh items-end px-5 pb-9 pt-24 sm:px-9 sm:pb-12 lg:px-16 lg:pb-16">
          <div className="w-full max-w-xl border-l border-[#a83b3e]/55 pl-5 sm:pl-7">
            <p className="js-entry-reveal text-[11px] uppercase tracking-[0.34em] text-[#d5c39e]/58">
              {t("sealed.eyebrow")}
            </p>
            <h1
              className="js-entry-reveal mt-4 text-4xl leading-tight tracking-[0.08em] text-[#f0e4cc] sm:text-5xl"
              style={{ fontFamily: '"Noto Serif SC", "Songti SC", ui-serif, Georgia, serif' }}
            >
              {t("sealed.title", { name: activeSession.profile.displayName })}
            </h1>
            <p className="js-entry-reveal mt-5 max-w-lg text-sm leading-7 text-white/55">
              {t("sealed.body")}
            </p>
            <dl className="js-entry-reveal mt-7 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-white/10 py-5 text-sm">
              <div>
                <dt className="text-[10px] uppercase tracking-[0.2em] text-white/34">
                  {t("sealed.originLabel")}
                </dt>
                <dd className="mt-2 text-[#e5d9c2]/82">
                  {t(`creation.origin.options.${activeSession.profile.origin}.title`)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.2em] text-white/34">
                  {t("sealed.traitLabel")}
                </dt>
                <dd className="mt-2 text-[#e5d9c2]/82">
                  {t(`creation.trait.options.${activeSession.profile.trait}.title`)}
                </dd>
              </div>
            </dl>
            <div className="js-entry-reveal mt-7 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setPhase("story")}
                className="inline-flex min-h-12 items-center gap-3 bg-[#e9ddc5] px-5 text-sm font-semibold tracking-[0.08em] text-[#211a12] transition hover:bg-[#f3e8d2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
              >
                {t("sealed.enterStory")}
                <IconChevronRight size={18} />
              </button>
              <button
                type="button"
                onClick={returnToTitle}
                className="inline-flex min-h-12 items-center gap-3 border border-white/15 px-5 text-sm tracking-[0.08em] text-white/68 transition hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
              >
                <IconBook2 size={18} />
                {t("sealed.returnToLedger")}
              </button>
              <p className="text-[11px] leading-5 text-white/36">{t("sealed.saved")}</p>
            </div>
          </div>
        </section>
      ) : null}

      {phase === "story" && activeSession ? (
        <JinlingStoryPlayer
          sessionId={activeSession.sessionId}
          playerName={activeSession.profile.displayName}
          onExit={returnToTitle}
        />
      ) : null}

      {phase === "error" ? (
        <section className="relative z-30 grid min-h-dvh place-items-center px-5">
          <div
            className="w-full max-w-lg border border-[#a52a2e]/35 bg-[#100d0b]/88 p-6 backdrop-blur-xl sm:p-8"
            role="alert"
          >
            <IconAlertTriangle className="text-[#c64d50]" size={28} stroke={1.5} />
            <h1 className="mt-5 text-xl font-semibold text-white">
              {t(errorKind === "media" ? "error.mediaTitle" : "error.localStateTitle")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-white/55">
              {t(errorKind === "media" ? "error.mediaBody" : "error.localStateBody")}
            </p>
            {errorDetail ? (
              <p className="mt-4 break-words border-l border-white/15 pl-4 font-mono text-xs leading-5 text-white/38">
                {errorDetail}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  if (errorKind === "media") {
                    retryMedia();
                    return;
                  }
                  void loadLocalState();
                }}
                className="inline-flex min-h-11 items-center gap-2 bg-[#e9ddc5] px-4 text-sm font-semibold text-[#211a12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
              >
                <IconRefresh size={17} />
                {t("error.retry")}
              </button>
              {errorKind === "local-state" ? (
                <button
                  type="button"
                  onClick={() => void discardLocalState()}
                  className={cn(
                    "min-h-11 border border-[#a52a2e]/45 px-4 text-sm text-[#e8c7c8] transition",
                    "hover:border-[#c64d50] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
                  )}
                >
                  {t("error.discardLocalState")}
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
