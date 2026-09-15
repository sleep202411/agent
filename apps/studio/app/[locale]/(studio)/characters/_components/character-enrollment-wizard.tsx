"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconAlertTriangle,
  IconChevronRight,
  IconClockHour4,
  IconLoader2,
  IconShieldLock,
  IconUserScan,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useAuth } from "@/app/_components/auth-provider";
import { cn } from "@/lib/utils";
import { ApiRequestError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import {
  characterApiErrorCode,
  completeEnrollment,
  createEnrollmentSession,
  getEnrollmentStatus,
  type CharacterDetail,
  type EnrollmentSession,
} from "@/lib/characters-api";

/** ENROLLMENT_NOT_COMPLETED → poll the status route at this cadence. */
const STATUS_POLL_INTERVAL_MS = 5_000;

/** postMessage type the in-iframe callback frame posts to the parent tab
 *  (same-origin only) — the primary "verification finished" signal. Lives
 *  here (the listener's home) so the callback frame depends on the wizard,
 *  not the reverse (keeps the module graph acyclic). */
export const ENROLLMENT_CALLBACK_MESSAGE = "character-enrollment-callback";

type Phase = "idle" | "active" | "failed" | "expired";

function formatRemaining(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function StepChip({ index, label, active }: { index: number; label: string; active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        active ? "bg-white/[0.1] text-foreground" : "bg-white/[0.04] text-white/40"
      )}
    >
      <span
        className={cn(
          "grid size-4 place-items-center rounded-full text-[9px] font-semibold tabular-nums",
          active ? "bg-primary text-primary-foreground" : "bg-white/[0.08] text-white/50"
        )}
      >
        {index}
      </span>
      {label}
    </span>
  );
}

/**
 * Real-person enrollment wizard — shown on the detail surface while the
 * character is `draft` / `pending_verification`. Drives the BytePlus H5
 * liveness flow IN-PAGE (same-session binding is a security control — no
 * QR / mobile handoff), then confirms via the server-pull `complete` route.
 * Leave-and-notify: `character_media_updated` realtime + the status poll keep
 * the surface truthful; success collapses the wizard (parent stops rendering
 * it once the character is active).
 */
export function CharacterEnrollmentWizard({
  character,
  onDetail,
}: {
  character: CharacterDetail;
  onDetail: (detail: CharacterDetail) => void;
}) {
  const { user } = useAuth();
  if (user?.id == null) return null;
  return (
    <EnrollmentContent
      key={JSON.stringify([user.id, character.id])}
      character={character}
      onDetail={onDetail}
    />
  );
}
function EnrollmentContent({
  character,
  onDetail,
}: {
  character: CharacterDetail;
  onDetail: (detail: CharacterDetail) => void;
}) {
  const t = useTranslations("characters");
  const tc = useTranslations("common");

  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<EnrollmentSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** "I've completed verification" got ENROLLMENT_NOT_COMPLETED — keep the
   *  H5 visible, show the gentle note, and poll status until it resolves. */
  const [waiting, setWaiting] = useState(false);
  /** Countdown clock — ticked by the interval below; remaining is derived. */
  const [nowMs, setNowMs] = useState(() => Date.now());

  const characterId = character.id;
  const confirmingRef = useRef(false);
  const startingRef = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const owner = new AbortController();
    lifetime.current = owner;
    return () => {
      owner.abort();
      lifetime.current = null;
    };
  }, []);

  /**
   * Server-pull completion (idempotent). The SOLE completion authority — the
   * status route only reports; only complete() flips the character active.
   * `silent` skips the button spinner for poll-driven re-checks (no 5s flicker).
   */
  const finalize = useCallback(
    async (silent = false) => {
      const owner = lifetime.current;
      if (!owner || owner.signal.aborted || confirmingRef.current || startingRef.current) return;
      confirmingRef.current = true;
      if (!silent) setConfirming(true);
      try {
        const detail = await completeEnrollment(characterId, owner.signal);
        if (owner.signal.aborted) return;
        setWaiting(false);
        onDetail(detail);
        if (detail.status === "active") toast.success(t("enrollSuccessToast"));
      } catch (error) {
        if (owner.signal.aborted) return;
        const code = characterApiErrorCode(error);
        if (code === "ENROLLMENT_NOT_COMPLETED") {
          // Not finished in the H5 yet — gentle state + automatic status polling.
          setWaiting(true);
        } else if (code === "ENROLLMENT_SESSION_EXPIRED") {
          setWaiting(false);
          setPhase("expired");
        } else if (!silent) {
          toast.error(error instanceof Error ? error.message : tc("error"));
        }
      } finally {
        confirmingRef.current = false;
        if (!silent && !owner.signal.aborted) setConfirming(false);
      }
    },
    [characterId, onDetail, t, tc]
  );

  const start = useCallback(async () => {
    const owner = lifetime.current;
    if (!owner || owner.signal.aborted || startingRef.current || confirmingRef.current) return;
    startingRef.current = true;
    let reconcile = false;
    setStarting(true);
    try {
      const next = await createEnrollmentSession(characterId, owner.signal);
      if (owner.signal.aborted) return;
      setSession(next);
      setNowMs(Date.now());
      setWaiting(false);
      setPhase("active");
    } catch (error) {
      if (owner.signal.aborted) return;
      const code = characterApiErrorCode(error);
      if (code === "ENROLLMENT_ALREADY_COMPLETED") {
        // The provider already confirmed — reconcile through complete().
        reconcile = true;
      } else if (
        code === "RATE_LIMITED" ||
        (error instanceof ApiRequestError && error.status === 429)
      ) {
        toast.error(t("errorRateLimited"));
      } else if (code === "ACR_ENROLLMENT_PAUSED") {
        toast.error(t("errorEnrollmentPaused"));
      } else {
        toast.error(error instanceof Error ? error.message : tc("error"));
      }
    } finally {
      startingRef.current = false;
      if (!owner.signal.aborted) {
        setStarting(false);
        if (reconcile) void finalize();
      }
    }
  }, [characterId, finalize, t, tc]);

  // The in-iframe callback frame (H5 redirect target) posts a same-origin
  // message when verification finishes — the primary happy path (no need for
  // the user to click "I've completed verification"). It still only POKES the
  // authenticated completion pull; it never carries state.
  useEffect(() => {
    if (phase !== "active") return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; characterId?: unknown } | null;
      if (
        data &&
        typeof data === "object" &&
        data.type === ENROLLMENT_CALLBACK_MESSAGE &&
        data.characterId === characterId
      ) {
        void finalize(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [phase, characterId, finalize]);

  // Mount reconcile: an earlier tab/session may have finished (or failed) the
  // H5 flow — the status route says so without minting a new session.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void getEnrollmentStatus(characterId, controller.signal)
      .then((status) => {
        if (cancelled) return;
        if (status.sessionStatus === "completed") void finalize();
        else if (status.sessionStatus === "failed") setPhase("failed");
        // pending: the h5Link is not re-issuable from status — user restarts.
      })
      .catch(() => {
        // Non-critical: the wizard still starts fresh.
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // Mount-only reconcile per character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  // Session expiry countdown (30-minute window). The interval only advances
  // the clock; `remainingSeconds` is derived at render time.
  useEffect(() => {
    if (phase !== "active" || !session) return;
    const expiresAtMs = Date.parse(session.expiresAt);
    if (Number.isNaN(expiresAtMs)) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
      if (expiresAtMs - Date.now() <= 0) {
        setWaiting(false);
        setPhase("expired");
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [phase, session]);

  const remainingSeconds =
    phase === "active" && session && !Number.isNaN(Date.parse(session.expiresAt))
      ? Math.max(0, Math.round((Date.parse(session.expiresAt) - nowMs) / 1000))
      : null;

  // Gentle not-confirmed-yet polling (stops on completed/failed/expired).
  useEffect(() => {
    if (!waiting || phase !== "active") return;
    let cancelled = false;
    const controller = new AbortController();
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const status = await getEnrollmentStatus(characterId, controller.signal);
        if (cancelled) return;
        if (status.sessionStatus === "completed" || status.characterStatus === "active") {
          setWaiting(false);
          void finalize(true);
        } else if (status.sessionStatus === "failed") {
          setWaiting(false);
          setPhase("failed");
        } else if (status.sessionStatus === "expired" || status.sessionStatus === "none") {
          setWaiting(false);
          setPhase("expired");
        } else if (status.sessionStatus === "pending") {
          // Provider may have completed the check without a distinct status
          // transition — only complete() can confirm it. Re-pull silently;
          // its ENROLLMENT_NOT_COMPLETED harmlessly keeps us waiting.
          void finalize(true);
        }
      } catch {
        // Transient — the next tick retries.
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(() => void poll(), STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [characterId, finalize, phase, waiting]);

  const restart = () => {
    setSession(null);
    setWaiting(false);
    setPhase("idle");
    void start();
  };

  const lowTime = remainingSeconds !== null && remainingSeconds <= 300;

  return (
    <FrostedPanel className="mt-8 p-6">
      <div className="flex items-start gap-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-full bg-white/[0.06]">
          <IconUserScan className="size-6 text-white/70" stroke={1.6} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight">{t("enrollHeading")}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t("enrollIntro")}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-1.5">
        <StepChip index={1} label={t("enrollStepVerify")} active />
        <IconChevronRight className="size-3.5 text-white/25" stroke={2} />
        <StepChip index={2} label={t("enrollStepMedia")} active={false} />
      </div>

      <div className="mt-5">
        {phase === "idle" && (
          <Button variant="primary-cta" size="lg" onClick={() => void start()} disabled={starting}>
            {starting ? <IconLoader2 data-icon="inline-start" className="animate-spin" /> : null}
            {t("enrollStart")}
          </Button>
        )}

        {phase === "active" && session && (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums",
                  lowTime ? "bg-destructive/15 text-destructive" : "bg-white/[0.06] text-white/70"
                )}
              >
                <IconClockHour4 className="size-3.5" stroke={1.8} />
                {t("enrollExpiresIn", {
                  time: formatRemaining(remainingSeconds ?? 0),
                })}
              </span>
            </div>

            <div className="mx-auto mt-4 w-full max-w-[420px] overflow-hidden rounded-2xl bg-white/[0.02]">
              <iframe
                src={session.h5Link}
                title={t("enrollHeading")}
                allow="camera; microphone"
                className="block h-[560px] w-full"
              />
            </div>

            {waiting && (
              <div className="mx-auto mt-3 flex max-w-[420px] items-start gap-2 rounded-xl bg-white/[0.04] px-3.5 py-2.5">
                <IconLoader2
                  className="mt-0.5 size-3.5 shrink-0 animate-spin text-white/50"
                  stroke={1.8}
                />
                <p className="text-xs/relaxed text-muted-foreground">{t("enrollNotConfirmed")}</p>
              </div>
            )}

            <div className="mx-auto mt-4 flex max-w-[420px] justify-center">
              <Button
                variant="primary-cta"
                size="lg"
                onClick={() => void finalize()}
                disabled={confirming}
              >
                {confirming ? (
                  <IconLoader2 data-icon="inline-start" className="animate-spin" />
                ) : null}
                {confirming ? t("enrollChecking") : t("enrollCompleted")}
              </Button>
            </div>
          </div>
        )}

        {phase === "failed" && (
          <div className="flex flex-col items-start gap-3 rounded-xl bg-destructive/10 px-4 py-4">
            <div className="flex items-start gap-2.5">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" stroke={1.8} />
              <div>
                <p className="text-sm font-medium text-destructive">{t("enrollFailed")}</p>
                <p className="mt-0.5 text-xs/relaxed text-muted-foreground">
                  {t("enrollFailedBody")}
                </p>
              </div>
            </div>
            <Button variant="secondary" onClick={restart} disabled={starting}>
              {starting ? <IconLoader2 data-icon="inline-start" className="animate-spin" /> : null}
              {t("enrollRestart")}
            </Button>
          </div>
        )}

        {phase === "expired" && (
          <div className="flex flex-col items-start gap-3 rounded-xl bg-white/[0.04] px-4 py-4">
            <div className="flex items-start gap-2.5">
              <IconClockHour4 className="mt-0.5 size-4 shrink-0 text-white/50" stroke={1.8} />
              <div>
                <p className="text-sm font-medium">{t("enrollExpiredTitle")}</p>
                <p className="mt-0.5 text-xs/relaxed text-muted-foreground">
                  {t("enrollExpiredBody")}
                </p>
              </div>
            </div>
            <Button variant="secondary" onClick={restart} disabled={starting}>
              {starting ? <IconLoader2 data-icon="inline-start" className="animate-spin" /> : null}
              {t("enrollRestart")}
            </Button>
          </div>
        )}
      </div>

      {/* Same-session binding is a deliberate security control — say so. */}
      <p className="mt-5 flex items-center gap-1.5 text-xs text-white/45">
        <IconShieldLock className="size-3.5 shrink-0" stroke={1.8} />
        {t("enrollSameSession")}
      </p>
    </FrostedPanel>
  );
}
