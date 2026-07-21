"use client";

/**
 * StoryNarrativePlayer — the published story-experience player, in the exact
 * shape of the IP-direct player (`ip-narrative-player.tsx`): Duolingo dark
 * design language, concepts → explicit concept choice → enter (build the run)
 * → setup → turn loop (continue / choice / free) → ending.
 *
 * The presentational pieces are copies rather than imports on purpose: the IP
 * player stays IP-owned and untouched, so its internals can drift with the
 * Java runtime without dragging the story runtime along. Only the genuinely
 * app-level pieces (Button3D, SafePlayerMarkdown, the flow screens, the
 * reduced-motion hook) are shared.
 *
 * The one wire difference: an authored story has no playable cast and the
 * chosen concept already IS the direction, so setup is prologue + pacing, and
 * a turn option declares whether clicking it replays an authored choice or
 * sends a suggested free action.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconArrowLeft,
  IconRefresh,
  IconSend,
  IconVolume,
  IconVolumeOff,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button3D } from "@/components/ui/button-3d";
import { useTranslations } from "@/src/i18n/i18n";
import { localeFromPathname, localizePath } from "@/src/i18n/locale-url";
import {
  enterStoryPlay,
  getStoryConcepts,
  playStoryTurn,
  StoryNarrativeApiError,
  type StoryConceptOption,
  type StoryEnding,
  type StoryEnterResult,
  type StoryTurnOption,
  type StoryTurnResult,
} from "../_lib/story-narrative-api";
import { usePrefersReducedMotion } from "../_hooks/use-prefers-reduced-motion";
import { useNarrativeMusic, type NarrativeMusicControls } from "../_hooks/use-narrative-music";
import {
  ConceptsErrorScreen,
  ConceptSelectionScreen,
  LoadingDots,
  NarrativeLoadingScreen,
} from "./play-flow-screens";

const FONT =
  "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif";
// Story prose reads like a novel (matches the original immersive player), not chat.
const SERIF =
  '"Iowan Old Style", "Noto Serif SC", ui-serif, Georgia, Cambria, "Times New Roman", serif';

// Known pace keys render from our own locale bundle; the server label is only
// a fallback for keys we don't recognize.
const PACE_LABEL_KEYS: Record<string, string> = {
  slow: "setup.dynamic.paceOptions.slow",
  standard: "setup.dynamic.paceOptions.standard",
  compact: "setup.dynamic.paceOptions.compact",
};

/**
 * Every message the runtime ships is hardcoded English, so a code we have copy
 * for is answered from the locale bundle and only unmapped codes fall through to
 * the server's own wording (which still carries detail we cannot invent).
 */
const ERROR_MESSAGE_KEYS: Record<string, string> = {
  REQUEST_TIMEOUT: "concepts.error.requestTimeout",
  NETWORK_ERROR: "concepts.error.network",
  CONCEPTS_RESPONSE_INVALID: "concepts.error.invalidResponse",
  ENTER_RESPONSE_INVALID: "concepts.error.invalidResponse",
  TURN_RESPONSE_INVALID: "concepts.error.invalidResponse",
  CONCEPT_COUNT_INVALID: "concepts.error.invalidResponse",
  INVALID_CONCEPT: "concepts.error.invalidConcept",
  SESSION_EXPIRED: "errors.sessionExpired",
  RELEASE_NOT_FOUND: "errors.releaseNotFound",
  GENERATION_FAILED: "errors.generationFailed",
  INVALID_ACTION: "errors.invalidAction",
  ACTION_NOT_ALLOWED: "errors.actionNotAllowed",
  RUN_ALREADY_STARTED: "errors.runAlreadyStarted",
  RUN_NOT_STARTED: "errors.runNotStarted",
  TURN_IN_FLIGHT: "errors.turnInFlight",
  RATE_LIMITED: "errors.rateLimited",
};

/**
 * The run is over as far as the local session is concerned: it expired, or it
 * reached its ending, so no action can ever apply to it again. Every other
 * failure leaves the server-held run exactly where the player left it — in
 * particular a run that is merely out of step with this action
 * (RUN_ALREADY_STARTED / RUN_NOT_STARTED) is alive and must not be discarded.
 */
const TERMINAL_SESSION_CODES = new Set(["SESSION_EXPIRED", "INVALID_ACTION"]);

/**
 * The GAME is gone, not the session: the release was unpublished or superseded
 * mid-run, and `loadNarrative` re-reads it every turn, so every future turn
 * answers the same 404. Retrying is the one thing that provably cannot work.
 */
const RELEASE_GONE_CODE = "RELEASE_NOT_FOUND";

const MAX_REVEAL_STEPS = 220;
const REVEAL_INTERVAL_MS = 34;
const TURN_PENDING_PHRASE_ROTATE_MS = 2400;
const TURN_PENDING_PHRASE_KEYS = ["fate", "world", "story", "choice", "nextScene"] as const;
/** The turn contract caps a free action at 500 characters. */
const MAX_FREE_TEXT_LENGTH = 500;

function progressFromTurnCount(turnCount: number): number {
  return Math.min(92, 12 + Math.max(0, turnCount) * 2);
}

type Phase =
  | "concept-loading"
  | "concept-select"
  | "concept-error"
  | "enter-loading"
  | "setup"
  | "playing";
type Line = { id: string; role: "player" | "narrator"; text: string; reveal?: boolean };
type SetupStep = {
  eyebrow?: string;
  heading: string;
  body: React.ReactNode;
  cta: string;
  centered?: boolean;
};
type PendingReveal = {
  lineId: string;
  options: StoryTurnOption[];
  finished: boolean;
  ending: StoryEnding | null;
};
type EnterFailureMode = "retry" | "fresh" | "choose-another";

export function StoryNarrativePlayer({
  gameId,
  contentVersion,
  title,
}: {
  gameId: string;
  contentVersion: string;
  title?: string;
}) {
  // Locale comes from the URL prefix, not i18next state: `i18n.changeLanguage`
  // is async, so on a hard load of /zh-CN/play/... the first requests would
  // otherwise race it and go out with the stale default locale.
  const pathname = usePathname() ?? "/";
  const locale = localeFromPathname(pathname);
  const t = useTranslations("narrativeDemo");

  const [phase, setPhase] = useState<Phase>("concept-loading");
  const [concepts, setConcepts] = useState<StoryConceptOption[]>([]);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [enteredConceptId, setEnteredConceptId] = useState<string | null>(null);
  const [conceptError, setConceptError] = useState<string | null>(null);
  const [conceptRetryAllowed, setConceptRetryAllowed] = useState(true);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [enterFailureMode, setEnterFailureMode] = useState<EnterFailureMode | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [enterData, setEnterData] = useState<StoryEnterResult | null>(null);
  const [pace, setPace] = useState("standard");
  const [step, setStep] = useState(0);

  const [lines, setLines] = useState<Line[]>([]);
  const [options, setOptions] = useState<StoryTurnOption[]>([]);
  const [finished, setFinished] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [ending, setEnding] = useState<StoryEnding | null>(null);
  const [pendingReveal, setPendingReveal] = useState<PendingReveal | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");

  // The run's music comes with `enter` and belongs to that run alone: every
  // discard path already clears `enterData`, which tears the decks down with it.
  // A story with no music leaves this inert — no control, no element, no fetch.
  const music = useNarrativeMusic(enterData?.music ?? null);

  const feedRef = useRef<HTMLDivElement>(null);
  const lineSeqRef = useRef(0);
  const pendingRevealRef = useRef<PendingReveal | null>(null);
  const startedRef = useRef(false);
  const conceptRequestIdRef = useRef(0);
  const enterRequestIdRef = useRef(0);
  const turnRequestIdRef = useRef(0);
  const enterPendingRef = useRef(false);
  const turnPendingRef = useRef(false);
  const setupHeadingRef = useRef<HTMLHeadingElement>(null);
  const setupAlertRef = useRef<HTMLDivElement>(null);
  // The runtime keeps session state server-side; the browser only holds the
  // opaque session id.
  const tokenRef = useRef<string | null>(null);

  const describeError = useCallback(
    (error: unknown, fallbackKey: string) => {
      if (error instanceof StoryNarrativeApiError) {
        const key = error.code ? ERROR_MESSAGE_KEYS[error.code] : undefined;
        if (key) return t(key);
        if (error.upstream && error.message.trim()) return error.message;
      }
      return error instanceof Error && error.message.trim() ? error.message : t(fallbackKey);
    },
    [t]
  );

  // The mount effect that generates the concept batch keys off `requestConcepts`,
  // which must NOT depend on `t` — react-i18next swaps `t`'s identity on every
  // `languageChanged`, and a re-run of that effect calls `resetRunState()` and
  // wipes the whole playthrough. Route `describeError` through a ref so the
  // effect only re-fires on the identity we actually want: gameId / locale.
  const describeErrorRef = useRef(describeError);
  useEffect(() => {
    describeErrorRef.current = describeError;
  }, [describeError]);

  const resetRunState = useCallback(() => {
    enterRequestIdRef.current += 1;
    turnRequestIdRef.current += 1;
    enterPendingRef.current = false;
    turnPendingRef.current = false;
    pendingRevealRef.current = null;
    startedRef.current = false;
    tokenRef.current = null;
    lineSeqRef.current = 0;

    setConcepts([]);
    setSelectedConceptId(null);
    setEnteredConceptId(null);
    setConceptError(null);
    setConceptRetryAllowed(true);
    setEnterError(null);
    setEnterFailureMode(null);
    setSetupError(null);
    setTurnError(null);
    setEnterData(null);
    setPace("standard");
    setStep(0);
    setLines([]);
    setOptions([]);
    setFinished(false);
    setTurnCount(0);
    setEnding(null);
    setPendingReveal(null);
    setBusy(false);
    setDraft("");
  }, []);

  const requestConcepts = useCallback(async () => {
    const requestId = ++conceptRequestIdRef.current;
    resetRunState();
    setPhase("concept-loading");

    try {
      const result = await getStoryConcepts(gameId, contentVersion, locale);
      if (requestId !== conceptRequestIdRef.current) return;
      setConcepts(result.items);
      setPhase("concept-select");
    } catch (error: unknown) {
      if (requestId !== conceptRequestIdRef.current) return;
      setConceptError(describeErrorRef.current(error, "concepts.error.conceptsFallback"));
      setConceptRetryAllowed(
        !(
          error instanceof StoryNarrativeApiError &&
          (error.status === 404 ||
            error.status === 422 ||
            error.code === "RELEASE_NOT_FOUND" ||
            error.code === "CONCEPT_COUNT_INVALID")
        )
      );
      setPhase("concept-error");
    }
  }, [contentVersion, gameId, locale, resetRunState]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void requestConcepts();
    });
    return () => {
      cancelled = true;
      conceptRequestIdRef.current += 1;
      enterRequestIdRef.current += 1;
      turnRequestIdRef.current += 1;
      enterPendingRef.current = false;
      turnPendingRef.current = false;
    };
  }, [requestConcepts]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => scrollFeedToBottom("smooth"));
    return () => window.cancelAnimationFrame(id);
  }, [lines, options, busy, pendingReveal, ending]);

  useEffect(() => {
    pendingRevealRef.current = pendingReveal;
  }, [pendingReveal]);

  useEffect(() => {
    if (phase !== "setup") return;
    const id = window.requestAnimationFrame(() => {
      if (setupError) {
        setupAlertRef.current?.focus({ preventScroll: true });
      } else {
        setupHeadingRef.current?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [phase, setupError, step]);

  function nextLineId(role: Line["role"]) {
    lineSeqRef.current += 1;
    return `${role}-${lineSeqRef.current}`;
  }

  function scrollFeedToBottom(behavior: ScrollBehavior = "smooth") {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior });
  }

  function completeReveal(lineId: string) {
    const pending = pendingRevealRef.current;
    if (!pending || pending.lineId !== lineId) return;
    setOptions(pending.options);
    setFinished(pending.finished);
    setEnding(pending.ending);
    pendingRevealRef.current = null;
    setPendingReveal(null);
    window.requestAnimationFrame(() => scrollFeedToBottom("smooth"));
  }

  function selectConcept(id: string) {
    setSelectedConceptId(id);
    setEnterError(null);
    setEnterFailureMode(null);
  }

  async function confirmConcept() {
    const selectedConcept = concepts.find((concept) => concept.id === selectedConceptId);
    if (!selectedConcept || enterPendingRef.current) return;

    if (
      enteredConceptId === selectedConcept.id &&
      enterData &&
      tokenRef.current === enterData.sessionId
    ) {
      setEnterError(null);
      setEnterFailureMode(null);
      setPhase("setup");
      return;
    }

    enterPendingRef.current = true;
    const requestId = ++enterRequestIdRef.current;
    setEnterError(null);
    setEnterFailureMode(null);
    setSetupError(null);
    setPhase("enter-loading");

    try {
      const data = await enterStoryPlay(gameId, contentVersion, locale, selectedConcept);
      if (requestId !== enterRequestIdRef.current) return;
      setEnterData(data);
      setEnteredConceptId(selectedConcept.id);
      setEnterFailureMode(null);
      tokenRef.current = data.sessionId;
      startedRef.current = false;
      setPace(data.defaults.pace ?? data.setupOptions.paces[0]?.key ?? "standard");
      setStep(0);
      setPhase("setup");
    } catch (error: unknown) {
      if (requestId !== enterRequestIdRef.current) return;
      const message = describeError(error, "concepts.error.enterFallback");
      if (error instanceof StoryNarrativeApiError && error.status === 404) {
        setConceptError(message);
        setConceptRetryAllowed(false);
        setPhase("concept-error");
        return;
      }
      if (
        error instanceof StoryNarrativeApiError &&
        (error.status === 422 || error.code === "INVALID_CONCEPT")
      ) {
        setSelectedConceptId(null);
        setEnterFailureMode("choose-another");
      } else {
        setEnterFailureMode(
          error instanceof StoryNarrativeApiError && error.retryable ? "retry" : "fresh"
        );
      }
      setEnterError(message);
      setPhase("concept-select");
    } finally {
      if (requestId === enterRequestIdRef.current) enterPendingRef.current = false;
    }
  }

  async function turn(
    req: Omit<Parameters<typeof playStoryTurn>[0], "sessionId">,
    playerEcho?: string
  ): Promise<boolean> {
    const sessionId = tokenRef.current;
    // The turn budget is per-run and comes from `enter`, so a turn cannot be
    // sent before the run that declared it exists.
    const turnBudgetMs = enterData?.turnBudgetMs;
    if (turnPendingRef.current || pendingRevealRef.current || !sessionId || !turnBudgetMs) {
      return false;
    }

    turnPendingRef.current = true;
    const requestId = ++turnRequestIdRef.current;
    const previousOptions = options;
    let playerLineId: string | null = null;
    setBusy(true);
    setTurnError(null);
    setOptions([]);
    pendingRevealRef.current = null;
    setPendingReveal(null);
    setEnding(null);
    if (playerEcho) {
      playerLineId = nextLineId("player");
      const lineId = playerLineId;
      setLines((current) => [...current, { id: lineId, role: "player", text: playerEcho }]);
    }
    try {
      const r: StoryTurnResult = await playStoryTurn({ ...req, sessionId }, turnBudgetMs);
      if (requestId !== turnRequestIdRef.current) return false;
      const lineId = nextLineId("narrator");
      const pending: PendingReveal = {
        lineId,
        options: r.options,
        finished: r.finished,
        ending: r.ending ?? null,
      };
      setLines((l) => [...l, { id: lineId, role: "narrator", text: r.narrative, reveal: true }]);
      pendingRevealRef.current = pending;
      setPendingReveal(pending);
      setTurnCount((current) => current + 1);
      // The scene changes as the turn lands, not when its prose finishes
      // revealing: the fade is the transition INTO the beat being read. This
      // sits inside the try whose catch owns the run-discard path, so the hook
      // swallows its own failures — audio may never cost a landed turn.
      music.applyCue(r.music);
      return true;
    } catch (error: unknown) {
      if (requestId !== turnRequestIdRef.current) return false;
      if (playerLineId) {
        const failedLineId = playerLineId;
        setLines((current) => current.filter((line) => line.id !== failedLineId));
      }
      const message = describeError(error, "play.turnErrorFallback");
      const code = error instanceof StoryNarrativeApiError ? error.code : undefined;

      // The story is gone, not the run: it was unpublished or superseded, and
      // the runtime re-reads the release on every turn, so every future turn
      // answers the same 404. Retrying is the one recovery that cannot work, so
      // the run stops here and no retry is offered.
      if (code === RELEASE_GONE_CODE) {
        tokenRef.current = null;
        startedRef.current = false;
        pendingRevealRef.current = null;
        setEnterData(null);
        setEnteredConceptId(null);
        setConceptError(message);
        setConceptRetryAllowed(false);
        setPhase("concept-error");
        return false;
      }

      // The run is alive, just out of step with what we sent — the answer to an
      // earlier turn was lost, the run itself was not. Re-sync the local phase
      // to what the server says the run is and keep the session.
      if (code === "RUN_ALREADY_STARTED") {
        startedRef.current = true;
        setOptions(previousOptions);
        setSetupError(null);
        setTurnError(message);
        setPhase("playing");
        return false;
      }
      if (code === "RUN_NOT_STARTED") {
        startedRef.current = false;
        setOptions(previousOptions);
        setTurnError(null);
        setSetupError(message);
        setPhase("setup");
        return false;
      }

      const terminalSessionError = code !== undefined && TERMINAL_SESSION_CODES.has(code);
      // A 4xx is the runtime REFUSING the request: the rate-limit guard, the
      // body validator and the engine all reject before the session is ever
      // saved, so the turn provably never applied and the run is still playable.
      // A timeout, a network drop or a 5xx stay ambiguous — those may have
      // landed — so they keep falling through to the discard path below.
      const turnNeverApplied =
        error instanceof StoryNarrativeApiError &&
        !terminalSessionError &&
        (error.retryable ||
          (error.status !== undefined && error.status >= 400 && error.status < 500));

      if (turnNeverApplied) {
        if (req.action === "free" && playerEcho) {
          setDraft((current) => current || playerEcho);
        }
        setOptions(previousOptions);
        if (req.action === "start") {
          startedRef.current = false;
          setSetupError(message);
          setPhase("setup");
        } else {
          setTurnError(message);
        }
      } else {
        // Either the run is terminally unusable, or a non-idempotent turn may
        // have reached the runtime while its response did not reach the browser.
        // Without a reconnect/idempotency contract, the only safe recovery is to
        // discard this local session and build a new one from the same concept.
        tokenRef.current = null;
        startedRef.current = false;
        pendingRevealRef.current = null;
        setEnterData(null);
        setEnteredConceptId(null);
        setEnterError(message);
        setEnterFailureMode("fresh");
        setSetupError(null);
        setTurnError(null);
        setLines([]);
        setOptions([]);
        setFinished(false);
        setTurnCount(0);
        setEnding(null);
        setPendingReveal(null);
        setPhase("concept-select");
      }
      return false;
    } finally {
      if (requestId === turnRequestIdRef.current) {
        turnPendingRef.current = false;
        setBusy(false);
      }
    }
  }

  function start() {
    if (startedRef.current || !enterData || !tokenRef.current || turnPendingRef.current) return;
    startedRef.current = true;
    setSetupError(null);
    setPhase("playing");
    // The one click every run passes through, and the last one before a cue can
    // arrive: browsers only allow audio a gesture has blessed, so the decks are
    // primed here rather than at the first cue, which has no gesture behind it.
    music.unlock();
    void turn({ action: "start", setup: { pace } });
  }

  // An authored choice replays a manifest exit by id; a suggestion is just a
  // pre-written free action. They look identical, so the player never has to
  // know which one they clicked.
  function chooseOption(option: StoryTurnOption) {
    if (option.kind === "choice") {
      void turn({ action: "choice", choiceId: option.id }, option.label);
      return;
    }
    void turn({ action: "free", text: option.label }, option.label);
  }

  const submitFree = () => {
    const text = draft.trim();
    if (!text || !enterData) return;
    if (turnPendingRef.current || pendingRevealRef.current) return;
    setDraft("");
    void turn({ action: "free", text }, text);
  };

  const close = (
    <Link
      href={localizePath("/games", locale)}
      aria-label={t("concepts.actions.exit")}
      className="grid size-11 shrink-0 place-items-center rounded-full text-[#5f7580] transition-colors hover:bg-white/5 hover:text-[#8ea6b2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <IconX size={26} />
    </Link>
  );

  if (phase === "concept-loading") {
    return (
      <Root label={title}>
        <NarrativeLoadingScreen kind="concepts" exitControl={close} />
      </Root>
    );
  }

  if (phase === "concept-error") {
    return (
      <Root label={title}>
        <ConceptsErrorScreen
          message={conceptError ?? t("concepts.error.conceptsFallback")}
          exitControl={close}
          onRetry={conceptRetryAllowed ? () => void requestConcepts() : undefined}
        />
      </Root>
    );
  }

  if (phase === "concept-select") {
    return (
      <Root label={title}>
        <ConceptSelectionScreen
          concepts={concepts}
          selectedId={selectedConceptId}
          enteredConceptId={enteredConceptId}
          enterError={enterError}
          enterFailureMode={enterFailureMode}
          exitControl={close}
          onSelect={selectConcept}
          onConfirm={() => void confirmConcept()}
          onRegenerate={() => void requestConcepts()}
        />
      </Root>
    );
  }

  if (phase === "enter-loading") {
    const selectedConcept = concepts.find((concept) => concept.id === selectedConceptId) ?? null;
    return (
      <Root label={title}>
        <NarrativeLoadingScreen kind="enter" exitControl={close} concept={selectedConcept} />
      </Root>
    );
  }

  // ── setup (step-by-step wizard) ──
  if (phase === "setup" && enterData) {
    const so = enterData.setupOptions;
    // Built from whatever the enter response actually carries: the prologue is
    // optional, and an authored story ships no cast or direction groups.
    const steps: SetupStep[] = [];
    if (enterData.prologue) {
      steps.push({
        eyebrow: t("setup.dynamic.prologueEyebrow"),
        heading: t("setup.dynamic.prologueTitle"),
        body: (
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-[#c7d3d9]">
            {enterData.prologue}
          </p>
        ),
        cta: t("setup.next"),
      });
    }
    if (so.paces.length > 0) {
      steps.push({
        heading: t("setup.dynamic.paceTitle"),
        body: (
          <div className="flex flex-wrap justify-center gap-3">
            {so.paces.map((p) => {
              const labelKey = PACE_LABEL_KEYS[p.key];
              return (
                <Pill key={p.key} on={pace === p.key} onClick={() => setPace(p.key)}>
                  {labelKey ? t(labelKey) : p.label}
                </Pill>
              );
            })}
          </div>
        ),
        cta: t("setup.dynamic.enterStory"),
        centered: true,
      });
    }

    const idx = Math.min(step, steps.length - 1);
    const cur = steps[idx];
    const isLast = idx >= steps.length - 1;
    const setupContentWidth = cur.centered ? "max-w-[920px]" : "max-w-5xl";

    return (
      <Root label={title}>
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
          <button
            type="button"
            aria-label={t("setup.back")}
            onClick={() => {
              setSetupError(null);
              if (idx > 0) {
                setStep(idx - 1);
              } else {
                setPhase("concept-select");
              }
            }}
            className="grid size-11 shrink-0 place-items-center rounded-full text-[#5f7580] transition-colors hover:bg-white/5 hover:text-[#8ea6b2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <IconArrowLeft size={24} />
          </button>
          <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-[#14232a]">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#ea2804] transition-[width] duration-300 ease-out"
              style={{ width: `${((idx + 1) / steps.length) * 100}%` }}
            >
              <span className="absolute inset-x-1.5 top-0.75 h-1 rounded-full bg-white/35" />
            </div>
          </div>
        </div>

        {/* Content fills the middle and vertically-centers (m-auto); the CTA is
            pinned to the bottom bar. Only the play phase flows top-to-bottom. */}
        <div className="flex flex-1 flex-col overflow-y-auto px-5 py-8 sm:px-6">
          <div className={cn("m-auto w-full", setupContentWidth, cur.centered && "text-center")}>
            {cur.eyebrow ? (
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-white/60">
                {cur.eyebrow}
              </p>
            ) : null}
            <h1
              ref={setupHeadingRef}
              tabIndex={-1}
              className="mt-1 text-[26px] font-extrabold leading-tight outline-none"
            >
              {cur.heading}
            </h1>
            <div className="mt-6">{cur.body}</div>
          </div>
        </div>

        <div className="border-t border-white/5 px-5 py-4 sm:px-6">
          <div className={cn("mx-auto w-full", setupContentWidth)}>
            {setupError ? (
              <div
                ref={setupAlertRef}
                role="alert"
                tabIndex={-1}
                className="mb-3 rounded-2xl bg-[#321918] px-4 py-3 text-[14px] font-semibold leading-6 text-[#ffb4aa] outline-none [overflow-wrap:anywhere]"
              >
                {setupError}
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button3D
                block
                size="md"
                onClick={() => (isLast ? start() : setStep(idx + 1))}
                className="sm:w-auto sm:min-w-50"
                icon={isLast ? <span className="text-lg">▶</span> : undefined}
              >
                {cur.cta}
              </Button3D>
            </div>
          </div>
        </div>
      </Root>
    );
  }

  // ── playing ──
  const progress = finished ? 100 : progressFromTurnCount(turnCount);
  const interactionLocked = busy || Boolean(pendingReveal);
  return (
    <Root label={title}>
      <div className="mx-auto flex w-full max-w-6xl shrink-0 items-center gap-3">
        {close}
        <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-[#14232a]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[#ea2804] transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          >
            <span className="absolute inset-x-1.5 top-0.75 h-1 rounded-full bg-white/35" />
          </div>
        </div>
        <MusicControl music={music} />
      </div>

      {/* Immersive reading — flowing serif prose, not chat bubbles. Player
          actions are dimmer inset lines within the narrative. */}
      <div ref={feedRef} className="min-h-0 w-full flex-1 overflow-y-auto px-5 py-8 sm:px-6">
        <div className="mx-auto max-w-2xl">
          {lines.map((ln) =>
            ln.role === "narrator" ? (
              <AnimatedProseLine
                key={ln.id}
                text={ln.text}
                reveal={ln.reveal}
                onRevealProgress={() => scrollFeedToBottom("auto")}
                onRevealComplete={() => completeReveal(ln.id)}
              />
            ) : (
              <p
                key={ln.id}
                className="mb-7 whitespace-pre-line border-l-2 border-[#ea2804]/50 pl-4 text-[17px] font-medium italic leading-[1.9] text-white/52 duration-300 animate-in fade-in-0 slide-in-from-bottom-1 sm:text-[18px] motion-reduce:animate-none"
                style={{ fontFamily: SERIF }}
              >
                {ln.text}
              </p>
            )
          )}
          {busy ? <TurnLoadingCue /> : null}
          {finished && ending ? (
            <StoryEndingCard label={t("play.endingReached")} ending={ending} />
          ) : null}
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl shrink-0 px-4 pb-5 pt-3 [padding-bottom:max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
        {finished ? (
          <Button3D block onClick={() => window.location.reload()} icon={<IconRefresh />}>
            {t("play.restart")}
          </Button3D>
        ) : (
          <div className="flex flex-col gap-2.5">
            {turnError ? (
              <div
                role="alert"
                className="mb-1 rounded-2xl bg-[#321918] px-4 py-3 text-[13px] font-semibold leading-5 text-[#ffb4aa] [overflow-wrap:anywhere]"
              >
                {turnError}
              </div>
            ) : null}
            {options.map((o, index) => (
              <Choice
                key={o.id}
                index={index}
                disabled={interactionLocked}
                onClick={() => chooseOption(o)}
              >
                {o.label}
              </Choice>
            ))}
            {/* Authored choices stay on screen and WAIT — the composer and
                `continue` keep working beside them, at every pace and at a
                decision point too. The player is never forced to pick. */}
            <div className="mt-1 flex items-center gap-2.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  submitFree();
                }}
                disabled={interactionLocked}
                maxLength={MAX_FREE_TEXT_LENGTH}
                placeholder={t("play.inputPlaceholder")}
                style={{ fontFamily: FONT }}
                className="h-12 min-w-0 flex-1 rounded-2xl border border-white/[0.1] bg-[#111111] px-4 text-[15px] font-semibold text-white/90 outline-none transition placeholder:font-medium placeholder:text-white/32 focus:border-[#ea2804]/70 focus:bg-[#151515] disabled:opacity-45"
              />
              <button
                onClick={submitFree}
                disabled={interactionLocked || !draft.trim()}
                aria-label={t("play.takeTurn")}
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/[0.08] bg-[#1b1b1b] text-white/40 shadow-[0_4px_0_#070707] transition hover:border-white/[0.14] hover:text-[#ea2804] active:translate-y-1 active:shadow-[0_0_0_#070707] disabled:opacity-35"
              >
                <IconSend size={18} />
              </button>
              <Button3D
                size="md"
                className="w-23 shrink-0"
                disabled={interactionLocked}
                onClick={() => void turn({ action: "continue" })}
              >
                {t("play.continue")}
              </Button3D>
            </div>
          </div>
        )}
      </div>
    </Root>
  );
}

/**
 * Nothing at all for a story with no music. When the browser refused playback
 * the control says so rather than claiming sound is on — and the click that
 * corrects it is itself the gesture the browser was waiting for.
 */
function MusicControl({ music }: { music: NarrativeMusicControls }) {
  const t = useTranslations("narrativeDemo");
  if (!music.enabled) return null;

  const label = music.soundOn
    ? t("play.music.mute")
    : music.blocked
      ? t("play.music.blocked")
      : t("play.music.unmute");

  return (
    <button
      type="button"
      onClick={music.toggleSound}
      aria-pressed={music.soundOn}
      aria-label={label}
      title={label}
      className="grid size-11 shrink-0 place-items-center rounded-full text-[#5f7580] transition-colors hover:bg-white/5 hover:text-[#8ea6b2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      {music.soundOn ? <IconVolume size={22} /> : <IconVolumeOff size={22} />}
    </button>
  );
}

function StoryEndingCard({ label, ending }: { label: string; ending: StoryEnding }) {
  return (
    <section className="mb-7 rounded-3xl bg-[#17262d] px-5 py-5 shadow-[0_4px_0_#101b20]">
      <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-white/60">{label}</p>
      {ending.title ? (
        <h2 className="mt-2 text-[20px] font-extrabold leading-tight text-[#f1f7fb]">
          {ending.title}
        </h2>
      ) : null}
      {ending.summary ? (
        <p className="mt-3 whitespace-pre-line text-[15px] font-medium leading-relaxed text-[#c7d3d9]">
          {ending.summary}
        </p>
      ) : null}
    </section>
  );
}

function AnimatedProseLine({
  text,
  reveal,
  onRevealProgress,
  onRevealComplete,
}: {
  text: string;
  reveal?: boolean;
  onRevealProgress?: () => void;
  onRevealComplete?: () => void;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const units = useMemo(() => splitGraphemes(text), [text]);
  const [visibleCount, setVisibleCount] = useState(() => (reveal ? 0 : units.length));
  const progressRef = useRef(onRevealProgress);
  const completeRef = useRef(onRevealComplete);

  useEffect(() => {
    progressRef.current = onRevealProgress;
    completeRef.current = onRevealComplete;
  }, [onRevealComplete, onRevealProgress]);

  useEffect(() => {
    if (!reveal || reduceMotion || units.length === 0) {
      const id = window.setTimeout(() => {
        setVisibleCount(units.length);
        completeRef.current?.();
      }, 0);
      return () => window.clearTimeout(id);
    }

    let visible = 0;
    let ticks = 0;
    const stepSize = Math.max(1, Math.ceil(units.length / MAX_REVEAL_STEPS));

    const id = window.setInterval(() => {
      ticks += 1;
      visible = Math.min(units.length, visible + stepSize);
      setVisibleCount(visible);

      if (ticks % 4 === 0 || visible >= units.length) {
        progressRef.current?.();
      }

      if (visible >= units.length) {
        window.clearInterval(id);
        completeRef.current?.();
      }
    }, REVEAL_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [reduceMotion, reveal, units]);

  const visibleText = units.slice(0, visibleCount).join("");
  const revealing = Boolean(reveal) && visibleCount < units.length && !reduceMotion;

  return (
    <p
      className="mb-7 whitespace-pre-line text-[18px] font-medium leading-[1.9] text-white/88 sm:text-[19px]"
      style={{ fontFamily: SERIF }}
    >
      {visibleText}
      {revealing ? (
        <span className="ml-1 inline-block h-[1.15em] w-0.5 translate-y-0.5 animate-pulse bg-[#ea2804]/75 align-text-bottom" />
      ) : null}
    </p>
  );
}

function TurnLoadingCue() {
  const t = useTranslations("narrativeDemo");
  const reduceMotion = usePrefersReducedMotion();
  const [phraseIndex, setPhraseIndex] = useState(() => pickPendingPhraseIndex());

  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(() => {
      setPhraseIndex((current) => pickPendingPhraseIndex(current));
    }, TURN_PENDING_PHRASE_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  const phraseKey = TURN_PENDING_PHRASE_KEYS[phraseIndex] ?? TURN_PENDING_PHRASE_KEYS[0];

  return (
    <div
      className="mb-8 flex items-center gap-3 border-l-2 border-[#ea2804]/40 pl-4 text-white/60 duration-500 animate-in fade-in-0 motion-reduce:animate-none"
      aria-label={t("play.pendingAriaLabel")}
      role="status"
    >
      <span
        key={phraseKey}
        aria-hidden="true"
        className="text-[17px] font-medium italic leading-[1.9] duration-700 animate-in fade-in-0 motion-reduce:animate-none"
        style={{ fontFamily: SERIF }}
      >
        {t(`play.pendingPhrases.${phraseKey}`)}
      </span>
      <LoadingDots />
    </div>
  );
}

function pickPendingPhraseIndex(current = -1) {
  const count = TURN_PENDING_PHRASE_KEYS.length;
  if (count <= 1) return 0;

  let next = Math.floor(Math.random() * count);
  if (next === current) {
    next = (next + 1 + Math.floor(Math.random() * (count - 1))) % count;
  }
  return next;
}

function splitGraphemes(text: string): string[] {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "grapheme" }
      ) => { segment(input: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;

  if (Segmenter) {
    return Array.from(
      new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      (part) => part.segment
    );
  }

  return Array.from(text);
}

// ── Duo primitives ──

function Root({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div
      aria-label={label || undefined}
      className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#0c1418] p-4 text-[#f1f7fb] sm:p-6"
      style={{ fontFamily: FONT }}
    >
      {children}
    </div>
  );
}

function Pill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-2xl border-2 px-4 py-2.5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1418]",
        on
          ? "border-[#ea2804] bg-[#2a1a15] text-white shadow-[0_4px_0_#5a2410]"
          : "border-transparent bg-[#24363f] text-[#f1f7fb] shadow-[0_4px_0_#131f25]"
      )}
    >
      {children}
    </button>
  );
}

function Choice({
  onClick,
  disabled,
  index,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-2xl border border-white/[0.08] bg-[#1f1f1f] px-4 py-3.5 text-left text-[15px] font-bold text-white/88 shadow-[0_4px_0_#080808] transition duration-500 animate-in fade-in-0 slide-in-from-bottom-2 hover:border-white/[0.14] hover:bg-[#262626] active:translate-y-1 active:shadow-[0_0_0_#080808] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50 motion-reduce:animate-none"
      style={{ animationDelay: `${index * 130}ms` }}
    >
      {children}
    </button>
  );
}
