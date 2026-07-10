"use client";

/**
 * IpNarrativePlayer — the IP-direct interactive player, in Duolingo design
 * language (dark): rounded chunky type, hard-edge 3D buttons, speech-bubble
 * dialogue, thick rounded progress. Flow: concepts → explicit concept choice →
 * enter (generate bible) → setup → turn loop (continue / choice / free) → ending.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconArrowLeft, IconRefresh, IconSend, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button3D } from "@/components/ui/button-3d";
import { useTranslations } from "@/src/i18n/i18n";
import { localeFromPathname, localizePath } from "@/src/i18n/locale-url";
import {
  enterPlay,
  getPlayConcepts,
  NarrativeApiError,
  playTurn,
  type EnterResult,
  type PlayConceptOption,
  type PlayerPersonality,
  type TurnResult,
} from "../_lib/play-api";
import { usePrefersReducedMotion } from "../_hooks/use-prefers-reduced-motion";
import {
  ConceptsErrorScreen,
  ConceptSelectionScreen,
  LoadingDots,
  NarrativeLoadingScreen,
} from "./play-flow-screens";
import { SafePlayerMarkdown } from "./safe-player-markdown";

const FONT =
  "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif";
// Story prose reads like a novel (matches the original immersive player), not chat.
const SERIF =
  '"Iowan Old Style", "Noto Serif SC", ui-serif, Georgia, Cambria, "Times New Roman", serif';

// Known pace keys render from our own locale bundle; the server label is only
// a fallback for keys we don't recognize (the backend labels aren't localized).
const PACE_LABEL_KEYS: Record<string, string> = {
  slow: "setup.dynamic.paceOptions.slow",
  standard: "setup.dynamic.paceOptions.standard",
  compact: "setup.dynamic.paceOptions.compact",
};

const MAX_REVEAL_STEPS = 220;
const REVEAL_INTERVAL_MS = 34;
const TURN_PENDING_PHRASE_ROTATE_MS = 2400;
const TURN_PENDING_PHRASE_KEYS = ["fate", "world", "story", "choice", "nextScene"] as const;

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
type Option = { id: string; label: string };
type SetupStep = {
  eyebrow?: string;
  heading: string;
  body: React.ReactNode;
  cta: string;
  centered?: boolean;
};
type PendingReveal = {
  lineId: string;
  options: Option[];
  finished: boolean;
  playerPersonality: PlayerPersonality | null;
};
type EnterFailureMode = "retry" | "fresh" | "choose-another";

export function IpNarrativePlayer({ ipId }: { ipId: string }) {
  // Locale comes from the URL prefix, not i18next state: `i18n.changeLanguage`
  // is async, so on a hard load of /zh-CN/play/... the first requests would
  // otherwise race it and go out with the stale default locale.
  const pathname = usePathname() ?? "/";
  const locale = localeFromPathname(pathname);
  const t = useTranslations("narrativeDemo");

  const [phase, setPhase] = useState<Phase>("concept-loading");
  const [concepts, setConcepts] = useState<PlayConceptOption[]>([]);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [enteredConceptId, setEnteredConceptId] = useState<string | null>(null);
  const [conceptError, setConceptError] = useState<string | null>(null);
  const [conceptRetryAllowed, setConceptRetryAllowed] = useState(true);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [enterFailureMode, setEnterFailureMode] = useState<EnterFailureMode | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [enterData, setEnterData] = useState<EnterResult | null>(null);
  const [roleId, setRoleId] = useState<string | undefined>();
  const [direction, setDirection] = useState("suspense");
  const [pace, setPace] = useState("standard");
  const [step, setStep] = useState(0);

  const [lines, setLines] = useState<Line[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [finished, setFinished] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [playerPersonality, setPlayerPersonality] = useState<PlayerPersonality | null>(null);
  const [pendingReveal, setPendingReveal] = useState<PendingReveal | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");

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
  // Java keeps session state server-side; the browser only holds the opaque session id.
  const tokenRef = useRef<string | null>(null);

  const describeError = useCallback(
    (error: unknown, fallbackKey: string) => {
      if (error instanceof NarrativeApiError) {
        if (error.upstream && error.message.trim()) return error.message;
        switch (error.code) {
          case "EMPTY_IP_STORY":
            return t("concepts.error.emptyStory");
          case "REQUEST_TIMEOUT":
            return t("concepts.error.requestTimeout");
          case "NETWORK_ERROR":
            return t("concepts.error.network");
          case "CONCEPTS_RESPONSE_INVALID":
          case "ENTER_RESPONSE_INVALID":
          case "TURN_RESPONSE_INVALID":
          case "CONCEPT_COUNT_INVALID":
            return t("concepts.error.invalidResponse");
          case "INVALID_CONCEPT":
            return t("concepts.error.invalidConcept");
          default:
            break;
        }
      }
      return error instanceof Error && error.message.trim() ? error.message : t(fallbackKey);
    },
    [t]
  );

  // The mount effect that generates the concept batch keys off `requestConcepts`,
  // which must NOT depend on `t` — react-i18next swaps `t`'s identity on every
  // `languageChanged`, and a re-run of that effect calls `resetRunState()` and
  // wipes the whole playthrough. Route `describeError` through a ref so the
  // effect only re-fires on the identity we actually want: ipId / locale.
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
    setRoleId(undefined);
    setDirection("suspense");
    setPace("standard");
    setStep(0);
    setLines([]);
    setOptions([]);
    setFinished(false);
    setTurnCount(0);
    setPlayerPersonality(null);
    setPendingReveal(null);
    setBusy(false);
    setDraft("");
  }, []);

  const requestConcepts = useCallback(async () => {
    const requestId = ++conceptRequestIdRef.current;
    resetRunState();
    setPhase("concept-loading");

    try {
      const result = await getPlayConcepts(ipId, locale);
      if (requestId !== conceptRequestIdRef.current) return;
      setConcepts(result.items);
      setPhase("concept-select");
    } catch (error: unknown) {
      if (requestId !== conceptRequestIdRef.current) return;
      setConceptError(describeErrorRef.current(error, "concepts.error.conceptsFallback"));
      setConceptRetryAllowed(
        !(
          error instanceof NarrativeApiError &&
          (error.status === 404 ||
            error.status === 422 ||
            error.code === "EMPTY_IP_STORY" ||
            error.code === "CONCEPT_COUNT_INVALID")
        )
      );
      setPhase("concept-error");
    }
  }, [ipId, locale, resetRunState]);

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
  }, [lines, options, busy, pendingReveal, playerPersonality]);

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
    setPlayerPersonality(pending.playerPersonality);
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
      const data = await enterPlay(ipId, locale, selectedConcept);
      if (requestId !== enterRequestIdRef.current) return;
      setEnterData(data);
      setEnteredConceptId(selectedConcept.id);
      setEnterFailureMode(null);
      tokenRef.current = data.sessionId;
      startedRef.current = false;
      setRoleId(data.defaults.roleId ?? data.setupOptions.roles[0]?.id);
      setDirection(
        data.defaults.directionKey ?? data.setupOptions.directions[0]?.key ?? "suspense"
      );
      setPace(data.defaults.pace ?? data.setupOptions.paces[0]?.key ?? "standard");
      setStep(0);
      setPhase("setup");
    } catch (error: unknown) {
      if (requestId !== enterRequestIdRef.current) return;
      const message = describeError(error, "concepts.error.enterFallback");
      if (error instanceof NarrativeApiError && error.status === 404) {
        setConceptError(message);
        setConceptRetryAllowed(false);
        setPhase("concept-error");
        return;
      }
      if (
        error instanceof NarrativeApiError &&
        (error.status === 422 || error.code === "INVALID_CONCEPT")
      ) {
        setSelectedConceptId(null);
        setEnterFailureMode("choose-another");
      } else {
        setEnterFailureMode(
          error instanceof NarrativeApiError && error.retryable ? "retry" : "fresh"
        );
      }
      setEnterError(message);
      setPhase("concept-select");
    } finally {
      if (requestId === enterRequestIdRef.current) enterPendingRef.current = false;
    }
  }

  async function turn(
    req: Omit<Parameters<typeof playTurn>[1], "sessionId">,
    playerEcho?: string
  ): Promise<boolean> {
    const sessionId = tokenRef.current;
    if (turnPendingRef.current || pendingRevealRef.current || !sessionId) return false;

    turnPendingRef.current = true;
    const requestId = ++turnRequestIdRef.current;
    const previousOptions = options;
    let playerLineId: string | null = null;
    setBusy(true);
    setTurnError(null);
    setOptions([]);
    pendingRevealRef.current = null;
    setPendingReveal(null);
    setPlayerPersonality(null);
    if (playerEcho) {
      playerLineId = nextLineId("player");
      const lineId = playerLineId;
      setLines((current) => [...current, { id: lineId, role: "player", text: playerEcho }]);
    }
    try {
      const r: TurnResult = await playTurn(locale, { ...req, sessionId });
      if (requestId !== turnRequestIdRef.current) return false;
      const lineId = nextLineId("narrator");
      const pending: PendingReveal = {
        lineId,
        options: r.options,
        finished: r.finished,
        playerPersonality: r.playerPersonality ?? null,
      };
      setLines((l) => [...l, { id: lineId, role: "narrator", text: r.narrative, reveal: true }]);
      pendingRevealRef.current = pending;
      setPendingReveal(pending);
      setTurnCount((current) => r.turnCount ?? current + 1);
      return true;
    } catch (error: unknown) {
      if (requestId !== turnRequestIdRef.current) return false;
      if (playerLineId) {
        const failedLineId = playerLineId;
        setLines((current) => current.filter((line) => line.id !== failedLineId));
      }
      const message = describeError(error, "play.turnErrorFallback");
      const terminalSessionError =
        error instanceof NarrativeApiError &&
        (error.status === 409 ||
          error.status === 410 ||
          error.code === "INVALID_ACTION" ||
          error.code === "SESSION_EXPIRED");
      const safeToRetryCurrentTurn =
        error instanceof NarrativeApiError && error.retryable && !terminalSessionError;

      if (safeToRetryCurrentTurn) {
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
        // A non-idempotent turn may have reached Java even if its response did
        // not reach the browser. Without a reconnect/idempotency contract, the
        // only safe recovery is to discard this local session and build a new
        // one from the already-selected concept.
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
        setPlayerPersonality(null);
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
    void turn({
      action: "start",
      setup: { roleId, directionKey: direction, pace },
    });
  }

  const submitFree = () => {
    const text = draft.trim();
    if (!text || !enterData || turnPendingRef.current || pendingRevealRef.current) return;
    setDraft("");
    void turn({ action: "free", text }, text);
  };

  const close = (
    <Link
      href={localizePath(`/ips/${ipId}`, locale)}
      aria-label={t("concepts.actions.exit")}
      className="grid size-11 shrink-0 place-items-center rounded-full text-[#5f7580] transition-colors hover:bg-white/5 hover:text-[#8ea6b2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <IconX size={26} />
    </Link>
  );

  if (phase === "concept-loading") {
    return (
      <Root>
        <NarrativeLoadingScreen kind="concepts" exitControl={close} />
      </Root>
    );
  }

  if (phase === "concept-error") {
    return (
      <Root>
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
      <Root>
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
      <Root>
        <NarrativeLoadingScreen kind="enter" exitControl={close} concept={selectedConcept} />
      </Root>
    );
  }

  // ── setup (step-by-step wizard) ──
  if (phase === "setup" && enterData) {
    const so = enterData.setupOptions;
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
    if (so.roles.length > 0) {
      steps.push({
        heading: t("setup.dynamic.roleTitle"),
        body: (
          <fieldset>
            <legend className="sr-only">{t("setup.dynamic.roleTitle")}</legend>
            <div className="mx-auto grid w-full max-w-5xl grid-cols-1 items-start gap-4 md:grid-cols-2">
              {so.roles.map((r) => (
                <RoleCard
                  key={r.id}
                  on={roleId === r.id}
                  onClick={() => setRoleId(r.id)}
                  value={r.id}
                  name={r.name}
                  role={r.role}
                  tagline={r.tagline}
                  profileMarkdown={r.profileMarkdown}
                />
              ))}
            </div>
          </fieldset>
        ),
        cta: t("setup.next"),
        centered: true,
      });
    }
    steps.push({
      heading: t("setup.dynamic.directionTitle"),
      body: (
        <div className="flex flex-wrap justify-center gap-3">
          {so.directions.map((d) => (
            <Pill key={d.key} on={direction === d.key} onClick={() => setDirection(d.key)}>
              {d.label}
            </Pill>
          ))}
        </div>
      ),
      cta: t("setup.next"),
      centered: true,
    });
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

    const idx = Math.min(step, steps.length - 1);
    const cur = steps[idx];
    const isLast = idx >= steps.length - 1;
    const setupContentWidth = cur.centered ? "max-w-[920px]" : "max-w-5xl";

    return (
      <Root>
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
    <Root>
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
          {finished && playerPersonality ? (
            <PlayerPersonalityCard
              label={t("play.playerPersonality")}
              personality={playerPersonality}
            />
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
                onClick={() => void turn({ action: "choice", choiceId: o.id }, o.label)}
              >
                {o.label}
              </Choice>
            ))}
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

function PlayerPersonalityCard({
  label,
  personality,
}: {
  label: string;
  personality: PlayerPersonality;
}) {
  return (
    <section className="mb-7 rounded-3xl bg-[#17262d] px-5 py-5 shadow-[0_4px_0_#101b20]">
      <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-white/60">{label}</p>
      {personality.title ? (
        <h2 className="mt-2 text-[20px] font-extrabold leading-tight text-[#f1f7fb]">
          {personality.title}
        </h2>
      ) : null}
      {personality.summary ? (
        <p className="mt-3 whitespace-pre-line text-[15px] font-medium leading-relaxed text-[#c7d3d9]">
          {personality.summary}
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

function Root({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#0c1418] p-4 text-[#f1f7fb] sm:p-6"
      style={{ fontFamily: FONT }}
    >
      {children}
    </div>
  );
}

function RoleCard({
  on,
  onClick,
  value,
  name,
  role,
  tagline,
  profileMarkdown,
}: {
  on: boolean;
  onClick: () => void;
  value: string;
  name: string;
  role: string;
  tagline?: string;
  profileMarkdown: string;
}) {
  const inputId = useId();
  const headingId = `${inputId}-heading`;
  const descriptionId = `${inputId}-description`;

  return (
    <div className="relative min-w-0">
      <input
        id={inputId}
        type="radio"
        name="narrative-role"
        value={value}
        checked={on}
        onChange={onClick}
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      />
      <article
        aria-labelledby={headingId}
        className={cn(
          "min-h-44 w-full rounded-2xl border p-4 text-left transition duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-white/70 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#0c1418]",
          on
            ? "border-[#ea2804] bg-[#241915] shadow-[0_4px_0_#651d0b]"
            : "border-white/[0.08] bg-[#1f1f1f] shadow-[0_4px_0_#080808] peer-hover:border-white/[0.14] peer-hover:bg-[#262626]"
        )}
      >
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className={cn(
              "grid h-10.5 w-10.5 shrink-0 place-items-center rounded-full border text-[15px] font-extrabold",
              on
                ? "border-[#ea2804]/50 bg-[#ea2804] text-white"
                : "border-white/[0.08] bg-[#2a2a2a] text-white/78"
            )}
          >
            {name.trim().charAt(0) || "?"}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="text-[15px] font-extrabold">
              {name}
            </h2>
            <p className="truncate text-xs text-[#8ea6b2]">{role}</p>
          </div>
        </div>
        <div id={descriptionId}>
          {tagline ? (
            <p className="mt-3 text-[12px] font-semibold leading-5 text-[#c7d3d9]/78">{tagline}</p>
          ) : null}
          <SafePlayerMarkdown className="mt-3 border-t border-white/[0.07] pt-3 text-left">
            {profileMarkdown}
          </SafePlayerMarkdown>
        </div>
      </article>
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
