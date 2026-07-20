"use client";

/**
 * TextExperiencePlayer — the published text-adventure player.
 *
 * A text adventure is an authored skeleton the model narrates between anchors,
 * so it reads like a novel that accumulates rather than a scene that is
 * replaced: anchors and narration append to one flowing column, the player's
 * own action stays in the column as an inset line, and choices sit at the end
 * of what has been read. Interactive films keep the frozen-manifest player —
 * this shell is only mounted for the `narrative` experience profile.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { IconRefresh, IconSend } from "@tabler/icons-react";
import { Button3D } from "@/components/ui/button-3d";
import {
  getTextPlayDirections,
  playTextTurn,
  startTextPlay,
  TextPlayError,
  type TextPlayAction,
  type TextPlayDirection,
  type TextPlayEvent,
  type TextPlayResult,
  type TextPlayState,
} from "../_lib/text-experience-api";

const SERIF =
  '"Iowan Old Style", "Noto Serif SC", ui-serif, Georgia, Cambria, "Times New Roman", serif';
const FONT =
  "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif";

/** How much room the model gets between two authored anchors. */
const PACES = [
  { key: "brisk", freeTurnLimit: 0 },
  { key: "steady", freeTurnLimit: 3 },
  { key: "leisurely", freeTurnLimit: 6 },
] as const;
type PaceKey = (typeof PACES)[number]["key"];

type Line =
  | { id: string; kind: "anchor"; title?: string; body?: string }
  | { id: string; kind: "narration"; text: string }
  | { id: string; kind: "player"; text: string };

interface Pending {
  prompt?: string;
  choices: Array<{ choiceId: string; label: string }>;
  suggestions: string[];
  canContinue: boolean;
}

export interface TextExperienceCopy {
  start: string;
  pace: string;
  paceBrisk: string;
  paceSteady: string;
  paceLeisurely: string;
  continue: string;
  send: string;
  inputPlaceholder: string;
  ended: string;
  replay: string;
  loading: string;
  directionsEyebrow: string;
  directionsTitle: string;
  directionsSubtitle: string;
  directionsCount: string;
  directionsLoading: string;
  reroll: string;
  conflict: string;
  hook: string;
  twist: string;
  retry: string;
}

export function TextExperiencePlayer({
  gameId,
  contentVersion,
  title,
  copy,
}: {
  gameId: string;
  contentVersion: string;
  title: string;
  copy: TextExperienceCopy;
}) {
  const [started, setStarted] = useState(false);
  const [pace, setPace] = useState<PaceKey>("steady");
  const [directions, setDirections] = useState<TextPlayDirection[] | null>(null);
  const [directionId, setDirectionId] = useState<string | null>(null);
  const [directionsBusy, setDirectionsBusy] = useState(true);
  const [directionsError, setDirectionsError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [ending, setEnding] = useState<{ title?: string; summary?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const stateRef = useRef<TextPlayState | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const nextId = () => `line-${(idRef.current += 1)}`;

  const freeTurnLimit = PACES.find((entry) => entry.key === pace)?.freeTurnLimit ?? 3;
  const paceLabel: Record<PaceKey, string> = {
    brisk: copy.paceBrisk,
    steady: copy.paceSteady,
    leisurely: copy.paceLeisurely,
  };

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [lines, pending, ending, busy]);

  const absorb = useCallback((result: TextPlayResult) => {
    stateRef.current = result.state;
    const additions: Line[] = [];
    let prompt: string | undefined;
    let choices: Pending["choices"] = [];
    let suggestions: string[] = [];
    let canContinue = false;
    let reachedEnding: { title?: string; summary?: string } | null = null;

    for (const event of result.events as TextPlayEvent[]) {
      if (event.kind === "anchor") {
        additions.push({ id: nextId(), kind: "anchor", title: event.title, body: event.body });
      } else if (event.kind === "narration" && event.text) {
        additions.push({ id: nextId(), kind: "narration", text: event.text });
      } else if (event.kind === "choices") {
        prompt = event.prompt;
        choices = event.choices ?? [];
      } else if (event.kind === "suggestions") {
        suggestions = event.items ?? [];
      } else if (event.kind === "ending") {
        reachedEnding = { title: event.title, summary: event.summary };
      }
    }
    // Nothing to pick and not over yet means the anchor simply continues.
    canContinue = !reachedEnding && choices.length === 0;
    setLines((current) => [...current, ...additions]);
    setEnding(reachedEnding);
    setPending(reachedEnding ? null : { prompt, choices, suggestions, canContinue });
  }, []);

  const loadDirections = useCallback(async () => {
    setDirectionsBusy(true);
    setDirectionsError(null);
    setDirectionId(null);
    try {
      const pitched = await getTextPlayDirections(gameId, contentVersion);
      setDirections(pitched);
    } catch (cause) {
      setDirectionsError(cause instanceof TextPlayError ? cause.message : String(cause));
      setDirections([]);
    } finally {
      setDirectionsBusy(false);
    }
  }, [contentVersion, gameId]);

  useEffect(() => {
    void loadDirections();
  }, [loadDirections]);

  const begin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const chosen = directions?.find((entry) => entry.id === directionId) ?? null;
      absorb(await startTextPlay(gameId, contentVersion, chosen));
      setStarted(true);
    } catch (cause) {
      setError(cause instanceof TextPlayError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [absorb, contentVersion, directionId, directions, gameId]);

  const take = useCallback(
    async (action: TextPlayAction, echo?: string) => {
      const state = stateRef.current;
      if (!state || busy) return;
      if (echo) setLines((current) => [...current, { id: nextId(), kind: "player", text: echo }]);
      setPending(null);
      setBusy(true);
      setError(null);
      try {
        absorb(await playTextTurn(gameId, contentVersion, { state, action, freeTurnLimit }));
      } catch (cause) {
        setError(cause instanceof TextPlayError ? cause.message : String(cause));
        setPending((current) => current);
      } finally {
        setBusy(false);
      }
    },
    [absorb, busy, contentVersion, freeTurnLimit, gameId]
  );

  const submitFree = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void take({ kind: "free", text }, text);
  };

  if (!started) {
    // Entry is a real decision, not a splash: the model pitches distinct angles
    // INTO the authored story and the player commits to one before beat one.
    if (directionsBusy) {
      return (
        <div
          className="grid h-full place-items-center px-6 text-center"
          style={{ fontFamily: FONT }}
        >
          <div className="w-full max-w-sm">
            <h1
              className="text-2xl font-bold tracking-[-0.02em] text-white"
              style={{ fontFamily: SERIF }}
            >
              {title}
            </h1>
            <div className="mt-8 h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-[#ea2804]" />
            </div>
            <p className="mt-4 text-[13px] font-semibold text-white/45">{copy.directionsLoading}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="h-full overflow-y-auto px-5 pb-32 sm:px-8" style={{ fontFamily: FONT }}>
        <div className="mx-auto w-full max-w-5xl pt-10">
          <p className="text-[12px] font-bold tracking-[0.18em] text-white/38 uppercase">
            {copy.directionsEyebrow}
          </p>
          <h1
            className="mt-2 text-3xl font-bold tracking-[-0.02em] text-white sm:text-4xl"
            style={{ fontFamily: SERIF }}
          >
            {copy.directionsTitle}
          </h1>
          <p className="mt-3 text-[15px] font-medium text-white/52">{copy.directionsSubtitle}</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-[13px] font-semibold text-white/35">
              {copy.directionsCount.replace("{count}", String(directions?.length ?? 0))}
            </span>
            <button
              type="button"
              onClick={() => void loadDirections()}
              className="rounded-full border border-white/[0.1] px-3 py-1.5 text-[12px] font-bold text-white/55 transition hover:text-white/90"
            >
              {copy.reroll}
            </button>
          </div>

          {directionsError ? (
            <div className="mt-6 rounded-2xl bg-[#321918] px-4 py-3 text-[13px] font-semibold text-[#ffb4aa]">
              {directionsError}
              <button
                type="button"
                onClick={() => void loadDirections()}
                className="ml-3 underline underline-offset-4"
              >
                {copy.retry}
              </button>
            </div>
          ) : null}

          <div className="mt-7 grid gap-4 md:grid-cols-2">
            {(directions ?? []).map((entry) => {
              const selected = directionId === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDirectionId(entry.id)}
                  className={`rounded-3xl border p-5 text-left transition ${
                    selected
                      ? "border-[#ea2804]/70 bg-[#1d1614]"
                      : "border-white/[0.07] bg-[#141414] hover:border-white/[0.14]"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${
                        selected ? "border-[#ea2804]" : "border-white/25"
                      }`}
                    >
                      {selected ? <span className="size-2.5 rounded-full bg-[#ea2804]" /> : null}
                    </span>
                    <span
                      className="text-[17px] font-bold text-white"
                      style={{ fontFamily: SERIF }}
                    >
                      {entry.title}
                    </span>
                  </span>
                  {entry.tags.length ? (
                    <span className="mt-3 block text-[12px] font-semibold text-white/40">
                      {entry.tags.join(" / ")}
                    </span>
                  ) : null}
                  <span
                    className="mt-3 block text-[14px] leading-[1.75] text-white/72"
                    style={{ fontFamily: SERIF }}
                  >
                    {entry.logline}
                  </span>
                  <span className="mt-4 grid gap-2 text-[13px] leading-6 text-white/50">
                    {entry.conflict ? (
                      <span>
                        <b className="font-bold text-white/62">{copy.conflict}</b>：{entry.conflict}
                      </span>
                    ) : null}
                    {entry.hook ? (
                      <span>
                        <b className="font-bold text-white/62">{copy.hook}</b>：{entry.hook}
                      </span>
                    ) : null}
                    {entry.twist ? (
                      <span>
                        <b className="font-bold text-white/62">{copy.twist}</b>：{entry.twist}
                      </span>
                    ) : null}
                  </span>
                  {entry.tagline ? (
                    <span
                      className="mt-4 block text-[14px] font-bold text-[#ea2804]/85"
                      style={{ fontFamily: SERIF }}
                    >
                      {entry.tagline}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mt-8">
            <p className="text-[13px] font-semibold text-white/40">{copy.pace}</p>
            <div className="mt-3 flex gap-2">
              {PACES.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setPace(entry.key)}
                  aria-pressed={pace === entry.key}
                  className={`rounded-2xl px-4 py-2.5 text-[14px] font-bold transition ${
                    pace === entry.key
                      ? "bg-white text-black"
                      : "border border-white/[0.1] bg-[#1b1b1b] text-white/60 hover:text-white/90"
                  }`}
                >
                  {paceLabel[entry.key]}
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <p role="alert" className="mt-4 text-[13px] font-semibold text-[#ffb4aa]">
              {error}
            </p>
          ) : null}
        </div>

        <div className="fixed inset-x-0 bottom-0 border-t border-white/[0.06] bg-[#0b0b0b]/95 px-5 py-4 backdrop-blur sm:px-8">
          <div className="mx-auto flex max-w-5xl justify-end">
            <Button3D
              className="min-w-40"
              disabled={busy || !directionId}
              onClick={() => void begin()}
            >
              {busy ? copy.loading : copy.start}
            </Button3D>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" style={{ fontFamily: FONT }}>
      <div ref={feedRef} className="min-h-0 w-full flex-1 overflow-y-auto px-5 py-8 sm:px-6">
        <div className="mx-auto max-w-2xl">
          {lines.map((line) =>
            line.kind === "player" ? (
              <p
                key={line.id}
                className="mb-7 border-l-2 border-[#ea2804]/50 pl-4 text-[17px] font-medium italic leading-[1.9] whitespace-pre-line text-white/52 duration-300 animate-in fade-in-0 slide-in-from-bottom-1 sm:text-[18px] motion-reduce:animate-none"
                style={{ fontFamily: SERIF }}
              >
                {line.text}
              </p>
            ) : line.kind === "anchor" ? (
              <div key={line.id} className="mb-7">
                {line.title ? (
                  <h2
                    className="mb-3 text-[13px] font-bold tracking-[0.16em] text-white/38 uppercase"
                    style={{ fontFamily: FONT }}
                  >
                    {line.title}
                  </h2>
                ) : null}
                {line.body ? (
                  <p
                    className="text-[17px] leading-[1.9] whitespace-pre-line text-white/88 duration-500 animate-in fade-in-0 sm:text-[18px] motion-reduce:animate-none"
                    style={{ fontFamily: SERIF }}
                  >
                    {line.body}
                  </p>
                ) : null}
              </div>
            ) : (
              <p
                key={line.id}
                className="mb-7 text-[17px] leading-[1.9] whitespace-pre-line text-white/80 duration-500 animate-in fade-in-0 sm:text-[18px] motion-reduce:animate-none"
                style={{ fontFamily: SERIF }}
              >
                {line.text}
              </p>
            )
          )}
          {busy ? <p className="mb-7 text-[15px] text-white/35">{copy.loading}</p> : null}
          {ending ? (
            <div className="mb-7 rounded-3xl border border-white/[0.08] bg-[#161616] p-6 text-center">
              <p className="text-[11px] font-bold tracking-[0.2em] text-white/35 uppercase">
                {copy.ended}
              </p>
              {ending.title ? (
                <h2 className="mt-3 text-2xl font-bold text-white" style={{ fontFamily: SERIF }}>
                  {ending.title}
                </h2>
              ) : null}
              {ending.summary ? (
                <p
                  className="mt-2 text-[15px] leading-7 text-white/58"
                  style={{ fontFamily: SERIF }}
                >
                  {ending.summary}
                </p>
              ) : null}
              <div className="mt-6">
                <Button3D block icon={<IconRefresh />} onClick={() => window.location.reload()}>
                  {copy.replay}
                </Button3D>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {pending && !ending ? (
        <div className="w-full border-t border-white/[0.06] bg-[#0b0b0b] px-5 py-4 sm:px-6">
          <div className="mx-auto grid max-w-2xl gap-2.5">
            {error ? (
              <div
                role="alert"
                className="rounded-2xl bg-[#321918] px-4 py-3 text-[13px] font-semibold leading-5 text-[#ffb4aa] [overflow-wrap:anywhere]"
              >
                {error}
              </div>
            ) : null}
            {pending.prompt ? (
              <p className="text-[13px] font-bold text-white/45">{pending.prompt}</p>
            ) : null}
            {pending.choices.map((choice, index) => (
              <button
                key={choice.choiceId}
                type="button"
                disabled={busy}
                onClick={() =>
                  void take({ kind: "choice", choiceId: choice.choiceId }, choice.label)
                }
                className="w-full rounded-2xl border border-white/[0.08] bg-[#1f1f1f] px-4 py-3.5 text-left text-[15px] font-bold text-white/88 shadow-[0_4px_0_#080808] transition duration-500 animate-in fade-in-0 slide-in-from-bottom-2 hover:border-white/[0.14] hover:bg-[#262626] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none active:translate-y-1 active:shadow-[0_0_0_#080808] disabled:opacity-50 motion-reduce:animate-none"
                style={{ animationDelay: `${index * 130}ms` }}
              >
                {choice.label}
              </button>
            ))}
            {pending.suggestions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {pending.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={busy}
                    onClick={() => void take({ kind: "free", text: suggestion }, suggestion)}
                    className="rounded-full border border-white/[0.1] bg-[#161616] px-3.5 py-2 text-[13px] font-semibold text-white/62 transition hover:text-white/90 disabled:opacity-45"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
            {freeTurnLimit > 0 || pending.canContinue ? (
              <div className="mt-1 flex items-center gap-2.5">
                {freeTurnLimit > 0 ? (
                  <>
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                        event.preventDefault();
                        submitFree();
                      }}
                      disabled={busy}
                      placeholder={copy.inputPlaceholder}
                      className="h-12 min-w-0 flex-1 rounded-2xl border border-white/[0.1] bg-[#111111] px-4 text-[15px] font-semibold text-white/90 transition outline-none placeholder:font-medium placeholder:text-white/32 focus:border-[#ea2804]/70 focus:bg-[#151515] disabled:opacity-45"
                    />
                    <button
                      type="button"
                      onClick={submitFree}
                      disabled={busy || !draft.trim()}
                      aria-label={copy.send}
                      className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/[0.08] bg-[#1b1b1b] text-white/40 shadow-[0_4px_0_#070707] transition hover:border-white/[0.14] hover:text-[#ea2804] active:translate-y-1 active:shadow-[0_0_0_#070707] disabled:opacity-35"
                    >
                      <IconSend size={18} />
                    </button>
                  </>
                ) : null}
                {pending.canContinue ? (
                  <Button3D
                    size="md"
                    className="w-23 shrink-0"
                    disabled={busy}
                    onClick={() => void take({ kind: "continue" })}
                  >
                    {copy.continue}
                  </Button3D>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
