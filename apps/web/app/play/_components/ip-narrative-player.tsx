"use client";

/**
 * IpNarrativePlayer — the IP-direct interactive player, in Duolingo design
 * language (dark): rounded chunky type, hard-edge 3D buttons, speech-bubble
 * dialogue, thick rounded progress. Flow: enter (generate bible) → setup →
 * turn loop (continue / choice / free) → ending.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { IconArrowLeft, IconRefresh, IconSend, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button3D } from "@/components/ui/button-3d";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import {
  enterPlay,
  playTurn,
  type EnterResult,
  type PlayerPersonality,
  type TurnResult,
} from "../_lib/play-api";

const FONT =
  "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif";
// Story prose reads like a novel (matches the original immersive player), not chat.
const SERIF =
  '"Iowan Old Style", "Noto Serif SC", ui-serif, Georgia, Cambria, "Times New Roman", serif';

const BUILD_STEPS = [
  "正在勘测这片世界…",
  "安置登场人物…",
  "给每个人留一个秘密…",
  "把线索藏进细节里…",
  "编排起承转合…",
  "写下藏到最后的真相…",
  "反复推演每一种结局…",
  "擦亮第一幕的灯…",
  "拉开帷幕…",
];
const AVATARS = ["#3a4a6a", "#6a3a4a", "#4a6a3a", "#5a4a6a", "#5c503d"];
const MAX_REVEAL_STEPS = 220;
const REVEAL_INTERVAL_MS = 34;

function progressFromTurnCount(turnCount: number): number {
  return Math.min(92, 12 + Math.max(0, turnCount) * 2);
}

type Phase = "loading" | "setup" | "playing" | "error";
type Line = { id: string; role: "player" | "narrator"; text: string; reveal?: boolean };
type Option = { id: string; label: string };
type PendingReveal = {
  lineId: string;
  options: Option[];
  finished: boolean;
  playerPersonality: PlayerPersonality | null;
};

export function IpNarrativePlayer({ ipId }: { ipId: string }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("narrativeDemo");

  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
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
  // Java keeps session state server-side; the browser only holds the opaque session id.
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    enterPlay(ipId, locale)
      .then((d) => {
        if (!alive) return;
        setEnterData(d);
        tokenRef.current = d.sessionId;
        setRoleId(d.defaults.roleId ?? d.setupOptions.roles[0]?.id);
        setDirection(d.defaults.directionKey ?? d.setupOptions.directions[0]?.key ?? "suspense");
        setPace(d.defaults.pace ?? d.setupOptions.paces[0]?.key ?? "standard");
        setPhase("setup");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, [ipId, locale]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, options, busy, pendingReveal, playerPersonality]);

  useEffect(() => {
    pendingRevealRef.current = pendingReveal;
  }, [pendingReveal]);

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

  async function turn(req: Omit<Parameters<typeof playTurn>[1], "sessionId">, playerEcho?: string) {
    if (busy || pendingRevealRef.current || !tokenRef.current) return;
    setBusy(true);
    setOptions([]);
    pendingRevealRef.current = null;
    setPendingReveal(null);
    setPlayerPersonality(null);
    if (playerEcho) {
      setLines((l) => [...l, { id: nextLineId("player"), role: "player", text: playerEcho }]);
    }
    try {
      const r: TurnResult = await playTurn(locale, { ...req, sessionId: tokenRef.current });
      const lineId = nextLineId("narrator");
      const pending = {
        lineId,
        options: r.options,
        finished: r.finished,
        playerPersonality: r.playerPersonality ?? null,
      };
      setLines((l) => [...l, { id: lineId, role: "narrator", text: r.narrative, reveal: true }]);
      pendingRevealRef.current = pending;
      setPendingReveal(pending);
      setTurnCount(r.turnCount);
    } catch (e) {
      const lineId = nextLineId("narrator");
      const pending = { lineId, options: [], finished: false, playerPersonality: null };
      setLines((l) => [
        ...l,
        {
          id: lineId,
          role: "narrator",
          text: `（生成失败：${e instanceof Error ? e.message : String(e)}）`,
          reveal: true,
        },
      ]);
      pendingRevealRef.current = pending;
      setPendingReveal(pending);
    } finally {
      setBusy(false);
    }
  }

  function start() {
    if (startedRef.current || !enterData) return;
    startedRef.current = true;
    setPhase("playing");
    void turn({
      action: "start",
      setup: { roleId, directionKey: direction, pace },
    });
  }

  const submitFree = () => {
    const text = draft.trim();
    if (!text || !enterData || busy || pendingRevealRef.current) return;
    setDraft("");
    void turn({ action: "free", text }, text);
  };

  const close = (
    <Link
      href={localizePath("/ips", locale)}
      aria-label="退出"
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#5f7580] transition-colors hover:bg-white/5 hover:text-[#8ea6b2]"
    >
      <IconX size={26} />
    </Link>
  );

  // ── loading ──
  if (phase === "loading") {
    return (
      <Root>
        <div className="px-4 pt-3">{close}</div>
        <PlayLoading />
      </Root>
    );
  }

  // ── error ──
  if (phase === "error") {
    return (
      <Root>
        <div className="px-4 pt-3">{close}</div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-3xl bg-[#24363f] text-3xl">
            😵
          </div>
          <p className="text-[15px] text-[#8ea6b2]">开局失败：{error}</p>
          <Button3D block onClick={() => window.location.reload()} icon={<IconRefresh />}>
            重试
          </Button3D>
        </div>
      </Root>
    );
  }

  // ── setup (step-by-step wizard) ──
  if (phase === "setup" && enterData) {
    const so = enterData.setupOptions;
    const steps: Array<{ eyebrow?: string; heading: string; body: React.ReactNode; cta: string }> =
      [];
    if (enterData.prologue) {
      steps.push({
        eyebrow: "开场设定",
        heading: enterData.title || "走进这个故事",
        body: <p className="text-[15px] leading-relaxed text-[#c7d3d9]">{enterData.prologue}</p>,
        cta: "开始",
      });
    }
    if (so.roles.length > 0) {
      steps.push({
        heading: "你想扮演谁?",
        body: (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
            {so.roles.map((r, i) => (
              <RoleCard
                key={r.id}
                on={roleId === r.id}
                onClick={() => setRoleId(r.id)}
                name={r.name}
                role={r.role}
                avatar={AVATARS[i % AVATARS.length]}
              />
            ))}
          </div>
        ),
        cta: "继续",
      });
    }
    steps.push({
      heading: "想要哪种改编?",
      body: (
        <div className="flex flex-wrap gap-2">
          {so.directions.map((d) => (
            <Pill key={d.key} on={direction === d.key} onClick={() => setDirection(d.key)}>
              {d.label}
            </Pill>
          ))}
        </div>
      ),
      cta: "继续",
    });
    steps.push({
      heading: "想要多快的节奏?",
      body: (
        <div className="flex flex-wrap gap-2">
          {so.paces.map((p) => (
            <Pill key={p.key} on={pace === p.key} onClick={() => setPace(p.key)}>
              {p.label}
            </Pill>
          ))}
        </div>
      ),
      cta: "进入故事",
    });

    const idx = Math.min(step, steps.length - 1);
    const cur = steps[idx];
    const isLast = idx >= steps.length - 1;

    return (
      <Root>
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
          <button
            type="button"
            aria-label="返回"
            onClick={() =>
              idx > 0 ? setStep(idx - 1) : window.location.assign(localizePath("/ips", locale))
            }
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#5f7580] transition-colors hover:bg-white/5 hover:text-[#8ea6b2]"
          >
            <IconArrowLeft size={24} />
          </button>
          <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-[#14232a]">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#ff5a2c] transition-[width] duration-300 ease-out"
              style={{ width: `${((idx + 1) / steps.length) * 100}%` }}
            >
              <span className="absolute inset-x-1.5 top-0.75 h-1 rounded-full bg-white/35" />
            </div>
          </div>
        </div>

        {/* Content fills the middle and vertically-centers (m-auto); the CTA is
            pinned to the bottom bar. Only the play phase flows top-to-bottom. */}
        <div className="flex flex-1 flex-col overflow-y-auto px-5 py-8 sm:px-6">
          <div className="m-auto w-full max-w-5xl">
            {cur.eyebrow ? (
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#ff5a2c]">
                {cur.eyebrow}
              </p>
            ) : null}
            <h1 className="mt-1 text-[26px] font-extrabold leading-tight">{cur.heading}</h1>
            <div className="mt-6">{cur.body}</div>
          </div>
        </div>

        <div className="border-t border-white/5 px-5 py-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-5xl justify-end">
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
      </Root>
    );
  }

  // ── playing ──
  const progress = finished ? 100 : progressFromTurnCount(turnCount);
  const interactionLocked = busy || Boolean(pendingReveal);
  return (
    <Root>
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
        {close}
        <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-[#14232a]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[#ff5a2c] transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          >
            <span className="absolute inset-x-1.5 top-0.75 h-1 rounded-full bg-white/35" />
          </div>
        </div>
      </div>

      {/* Immersive reading — flowing serif prose, not chat bubbles. Player
          actions are dimmer inset lines within the narrative. */}
      <div ref={feedRef} className="w-full flex-1 overflow-y-auto px-5 py-8 sm:px-6">
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
                className="mb-7 whitespace-pre-line border-l-2 border-[#ff5a2c]/50 pl-4 text-[17px] font-medium italic leading-[1.9] text-white/52 duration-300 animate-in fade-in-0 slide-in-from-bottom-1 sm:text-[18px] motion-reduce:animate-none"
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

      <div className="mx-auto w-full max-w-2xl px-4 pb-5 sm:px-6">
        {finished ? (
          <Button3D block onClick={() => window.location.reload()} icon={<IconRefresh />}>
            {t("play.restart")}
          </Button3D>
        ) : (
          <div className="flex flex-col gap-2.5">
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
                onKeyDown={(e) => e.key === "Enter" && submitFree()}
                disabled={interactionLocked}
                placeholder="你想做什么…"
                style={{ fontFamily: FONT }}
                className="h-12 min-w-0 flex-1 rounded-2xl border-2 border-white/10 bg-[#17262d] px-4 text-[15px] font-semibold text-[#f1f7fb] outline-none placeholder:font-medium placeholder:text-[#5f7580] focus:border-white/25 disabled:opacity-50"
              />
              <button
                onClick={submitFree}
                disabled={interactionLocked || !draft.trim()}
                aria-label="发送"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#24363f] text-[#8ea6b2] shadow-[0_4px_0_#131f25] transition active:translate-y-1 active:shadow-[0_0_0_#131f25] disabled:opacity-40"
              >
                <IconSend size={18} />
              </button>
              <Button3D
                size="md"
                className="w-23 shrink-0"
                disabled={interactionLocked}
                onClick={() => void turn({ action: "continue" })}
              >
                继续
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
      <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#ff5a2c]">{label}</p>
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
        <span className="ml-1 inline-block h-[1.15em] w-0.5 translate-y-0.5 animate-pulse bg-[#ff5a2c]/75 align-text-bottom" />
      ) : null}
    </p>
  );
}

function TurnLoadingCue() {
  return (
    <div
      className="mb-8 flex items-center gap-3 border-l-2 border-[#ff5a2c]/40 pl-4 text-white/42 duration-500 animate-in fade-in-0 motion-reduce:animate-none"
      aria-live="polite"
    >
      <span className="text-[17px] font-medium italic leading-[1.9]" style={{ fontFamily: SERIF }}>
        落笔中
      </span>
      <LoadingDots />
    </div>
  );
}

function LoadingDots() {
  return (
    <span className="flex h-5 items-center gap-1.5" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff5a2c]/70 motion-reduce:animate-none"
          style={{ animationDelay: `${index * 180}ms`, animationDuration: "1.2s" }}
        />
      ))}
    </span>
  );
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

function subscribeReducedMotion(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function getServerReducedMotionSnapshot() {
  return false;
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getServerReducedMotionSnapshot
  );
}

// ── Duo primitives ──

function Root({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-screen flex-col bg-[#0c1418] text-[#f1f7fb] p-6"
      style={{ fontFamily: FONT }}
    >
      {children}
    </div>
  );
}

function RoleCard({
  on,
  onClick,
  name,
  role,
  avatar,
}: {
  on: boolean;
  onClick: () => void;
  name: string;
  role: string;
  avatar: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition",
        on
          ? "border-[#ff5a2c] bg-[#2a1a15] shadow-[0_4px_0_#5a2410]"
          : "border-transparent bg-[#24363f] shadow-[0_4px_0_#131f25]"
      )}
    >
      <span
        className="grid h-10.5 w-10.5 shrink-0 place-items-center rounded-full text-[15px] font-extrabold text-white"
        style={{ background: avatar }}
      >
        {name.trim().charAt(0) || "?"}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-extrabold">{name}</span>
        <span className="block truncate text-xs text-[#8ea6b2]">{role}</span>
      </span>
    </button>
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
      className={cn(
        "rounded-2xl border-2 px-4 py-2.5 text-sm font-bold transition",
        on
          ? "border-[#ff5a2c] bg-[#2a1a15] text-white shadow-[0_4px_0_#5a2410]"
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
      className="w-full rounded-2xl bg-[#24363f] px-4 py-3.5 text-left text-[15px] font-bold text-[#f1f7fb] shadow-[0_4px_0_#131f25] transition duration-500 animate-in fade-in-0 slide-in-from-bottom-2 active:translate-y-1 active:shadow-[0_0_0_#131f25] disabled:opacity-50 motion-reduce:animate-none"
      style={{ animationDelay: `${index * 130}ms` }}
    >
      {children}
    </button>
  );
}

function PlayLoading() {
  const [progress, setProgress] = useState(3);
  useEffect(() => {
    const id = setInterval(() => setProgress((p) => Math.min(92, p + (92 - p) * 0.02)), 200);
    return () => clearInterval(id);
  }, []);
  const step = Math.min(BUILD_STEPS.length - 1, Math.floor((progress / 100) * BUILD_STEPS.length));

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-10">
      <div className="rounded-[28px] bg-[#111d22] px-6 py-7 shadow-[0_16px_60px_rgba(0,0,0,0.24)]">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#24363f] text-2xl">
            🎭
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="min-h-[1.4em] text-base font-extrabold text-[#f1f7fb]">
              {BUILD_STEPS[step]}
            </p>
            <p className="mt-1 text-xs font-semibold text-[#5f7580]">每一次推门,都是不一样的世界</p>
          </div>
        </div>
        <div className="mt-6 flex items-center gap-4">
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[#14232a]">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#ff5a2c] transition-[width] duration-300 ease-out"
              style={{ width: `${Math.round(progress)}%` }}
            />
          </div>
          <LoadingDots />
        </div>
      </div>
    </div>
  );
}
