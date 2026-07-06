"use client";

/**
 * IpNarrativePlayer — the IP-direct interactive player, in Duolingo design
 * language (dark): rounded chunky type, hard-edge 3D buttons, speech-bubble
 * dialogue, thick rounded progress. Flow: enter (generate bible) → setup →
 * turn loop (continue / choice / free) → ending.
 *
 * Backend is the throwaway Next prototype; Java owns the real one later.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconArrowLeft, IconLoader2, IconRefresh, IconSend, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button3D } from "@/components/ui/button-3d";
import type { Locale } from "@/src/i18n/config";
import { useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { enterPlay, playTurn, type EnterResult, type TurnResult } from "../_lib/play-api";

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
const ACT_PROGRESS: Record<string, number> = { qi: 12, cheng: 40, zhuan: 68, he: 92 };
const AVATARS = ["#3a4a6a", "#6a3a4a", "#4a6a3a", "#5a4a6a", "#5c503d"];

type Phase = "loading" | "setup" | "playing" | "error";
type Line = { role: "player" | "narrator"; text: string };

export function IpNarrativePlayer({ ipId }: { ipId: string }) {
  const locale = useLocale() as Locale;

  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [enterData, setEnterData] = useState<EnterResult | null>(null);
  const [roleId, setRoleId] = useState<string | undefined>();
  const [direction, setDirection] = useState("suspense");
  const [pace, setPace] = useState("standard");
  const [step, setStep] = useState(0);

  const [lines, setLines] = useState<Line[]>([]);
  const [options, setOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [finished, setFinished] = useState(false);
  const [stage, setStage] = useState("qi");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");

  const feedRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  // Stateless session: the current opaque token, refreshed on every turn.
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    enterPlay(ipId, locale)
      .then((d) => {
        if (!alive) return;
        setEnterData(d);
        tokenRef.current = d.sessionId;
        setRoleId(d.defaults.roleId ?? d.setupOptions.roles[0]?.id);
        setDirection(d.defaults.directionKey ?? "suspense");
        setPace(d.defaults.pace ?? "standard");
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
  }, [lines, options, busy]);

  async function turn(req: Omit<Parameters<typeof playTurn>[1], "sessionId">, playerEcho?: string) {
    if (busy || !tokenRef.current) return;
    setBusy(true);
    setOptions([]);
    if (playerEcho) setLines((l) => [...l, { role: "player", text: playerEcho }]);
    try {
      const r: TurnResult = await playTurn(locale, { ...req, sessionId: tokenRef.current });
      tokenRef.current = r.sessionId;
      setLines((l) => [...l, { role: "narrator", text: r.narrative }]);
      setOptions(r.options);
      setFinished(r.finished);
      setStage(r.stage);
    } catch (e) {
      setLines((l) => [
        ...l,
        { role: "narrator", text: `（生成失败：${e instanceof Error ? e.message : String(e)}）` },
      ]);
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
    if (!text || !enterData) return;
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
  const progress = finished ? 100 : (ACT_PROGRESS[stage] ?? 12);
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
          {lines.map((ln, i) =>
            ln.role === "narrator" ? (
              <p
                key={i}
                className="mb-7 whitespace-pre-line text-[18px] font-medium leading-[1.9] text-white/88 sm:text-[19px]"
                style={{ fontFamily: SERIF }}
              >
                {ln.text}
              </p>
            ) : (
              <p
                key={i}
                className="mb-7 whitespace-pre-line border-l-2 border-[#ff5a2c]/50 pl-4 text-[17px] font-medium italic leading-[1.9] text-white/52 sm:text-[18px]"
                style={{ fontFamily: SERIF }}
              >
                {ln.text}
              </p>
            )
          )}
          {busy ? <IconLoader2 className="mt-1 animate-spin text-white/40" size={20} /> : null}
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 pb-5 sm:px-6">
        {finished ? (
          <Button3D block onClick={() => window.location.reload()} icon={<IconRefresh />}>
            再玩一次
          </Button3D>
        ) : (
          <div className="flex flex-col gap-2.5">
            {options.map((o) => (
              <Choice
                key={o.id}
                disabled={busy}
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
                disabled={busy}
                placeholder="你想做什么…"
                style={{ fontFamily: FONT }}
                className="h-12 min-w-0 flex-1 rounded-2xl border-2 border-white/10 bg-[#17262d] px-4 text-[15px] font-semibold text-[#f1f7fb] outline-none placeholder:font-medium placeholder:text-[#5f7580] focus:border-white/25 disabled:opacity-50"
              />
              <button
                onClick={submitFree}
                disabled={busy || !draft.trim()}
                aria-label="发送"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#24363f] text-[#8ea6b2] shadow-[0_4px_0_#131f25] transition active:translate-y-1 active:shadow-[0_0_0_#131f25] disabled:opacity-40"
              >
                <IconSend size={18} />
              </button>
              <Button3D
                size="md"
                className="w-23 shrink-0"
                disabled={busy}
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
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-2xl bg-[#24363f] px-4 py-3.5 text-left text-[15px] font-bold text-[#f1f7fb] shadow-[0_4px_0_#131f25] transition active:translate-y-1 active:shadow-[0_0_0_#131f25] disabled:opacity-50"
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
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 grid h-18.5 w-18.5 animate-bounce place-items-center rounded-3xl bg-[#24363f] text-4xl motion-reduce:animate-none">
        🎭
      </div>
      <p className="min-h-[1.4em] text-base font-bold">{BUILD_STEPS[step]}</p>
      <div className="relative mt-4 h-4 w-full overflow-hidden rounded-full bg-[#14232a]">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[#ff5a2c] transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.round(progress)}%` }}
        >
          <span className="absolute inset-x-1.5 top-0.75 h-1 rounded-full bg-white/35" />
        </div>
      </div>
      <p className="mt-3 text-xs text-[#5f7580]">每一次推门,都是不一样的世界</p>
    </div>
  );
}
