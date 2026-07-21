"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconArrowLeft, IconLoader2, IconRefresh, IconSend2 } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useWorkspace } from "@/app/_components/workspace-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import {
  startStoryTextPlay,
  storyApiErrorMessage,
  turnStoryTextPlay,
  type StoryTextPlayAction,
  type StoryTextPlayEvent,
  type StoryTextPlayState,
  type StoryTextPlayTurnResult,
} from "@/lib/story-projects-api";

/**
 * The creator playtest runs at the default pace. There is no static mode to
 * fall back to: an authored beat is a direction marker, so every turn is
 * narrated, exactly as a player would see it.
 */
const PLAYTEST_PACE = "standard" as const;

type FeedEntry =
  | { id: string; kind: "anchor"; title?: string; body?: string }
  | { id: string; kind: "narration"; text: string }
  | { id: string; kind: "player"; text: string }
  | { id: string; kind: "ending"; title?: string; summary?: string };

interface Pending {
  prompt?: string;
  choices: Array<{ choiceId: string; label: string }>;
  suggestions: string[];
  canContinue: boolean;
}

export function StoryTextPlayPanel({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio.canvas.textPlay");
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;

  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [state, setState] = useState<StoryTextPlayState | null>(null);
  const [pending, setPending] = useState<Pending>({
    choices: [],
    suggestions: [],
    canContinue: false,
  });
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const nextId = () => `entry-${(seq.current += 1)}`;

  const absorb = useCallback((result: StoryTextPlayTurnResult) => {
    setState(result.state);
    setEnded(result.ended);
    const additions: FeedEntry[] = [];
    let prompt: string | undefined;
    let choices: Pending["choices"] = [];
    let suggestions: string[] = [];
    let canContinue = false;
    for (const event of result.events as StoryTextPlayEvent[]) {
      if (event.kind === "anchor") {
        additions.push({ id: nextId(), kind: "anchor", title: event.title, body: event.body });
        canContinue = true;
      } else if (event.kind === "narration" && event.text) {
        additions.push({ id: nextId(), kind: "narration", text: event.text });
      } else if (event.kind === "choices") {
        prompt = event.prompt;
        choices = event.choices ?? [];
        canContinue = false;
      } else if (event.kind === "suggestions") {
        suggestions = event.items ?? [];
      } else if (event.kind === "ending") {
        additions.push({
          id: nextId(),
          kind: "ending",
          title: event.title,
          summary: event.summary,
        });
        canContinue = false;
      } else if (event.kind === "end") {
        canContinue = false;
      }
    }
    setFeed((current) => [...current, ...additions]);
    setPending({ prompt, choices, suggestions, canContinue: canContinue && !result.ended });
  }, []);

  const begin = useCallback(async () => {
    if (!workspaceId) return;
    setBusy(true);
    setError(null);
    setFeed([]);
    setPending({ choices: [], suggestions: [], canContinue: false });
    setEnded(false);
    try {
      absorb(await startStoryTextPlay(workspaceId, projectId));
    } catch (err) {
      setError(storyApiErrorMessage(err, t("errorFallback")));
    } finally {
      setBusy(false);
    }
  }, [absorb, projectId, t, workspaceId]);

  useEffect(() => {
    if (workspaceId && !state && !busy && !error) void begin();
  }, [begin, busy, error, state, workspaceId]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [feed, pending]);

  const act = useCallback(
    async (action: StoryTextPlayAction, echo?: string) => {
      if (!workspaceId || !state || busy) return;
      setBusy(true);
      setError(null);
      if (echo) setFeed((current) => [...current, { id: nextId(), kind: "player", text: echo }]);
      setPending({ choices: [], suggestions: [], canContinue: false });
      try {
        absorb(
          await turnStoryTextPlay(workspaceId, projectId, {
            state,
            action,
            pace: PLAYTEST_PACE,
          })
        );
      } catch (err) {
        setError(storyApiErrorMessage(err, t("errorFallback")));
      } finally {
        setBusy(false);
      }
    },
    [absorb, busy, projectId, state, t, workspaceId]
  );

  const submitFree = () => {
    const text = draftText.trim();
    if (!text) return;
    setDraftText("");
    void act({ kind: "free", text }, text);
  };

  if (workspaceLoading) {
    return <CenterLoader label={t("loading")} />;
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 px-4 py-5">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/story-studio/projects/${encodeURIComponent(projectId)}/canvas`}>
            <IconArrowLeft className="size-4" />
            {t("back")}
          </Link>
        </Button>
        <span className="text-[11px] font-medium tracking-[0.14em] text-white/34 uppercase">
          {t("eyebrow")}
        </span>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void begin()}>
          <IconRefresh className="size-4" />
          {t("restart")}
        </Button>
      </div>

      <div
        ref={feedRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl bg-white/[0.02] p-4"
      >
        {feed.map((entry) => (
          <FeedBubble key={entry.id} entry={entry} anchorLabel={t("anchorLabel")} />
        ))}
        {busy ? (
          <div className="flex items-center gap-2 text-xs text-white/40">
            <IconLoader2 className="size-3.5 animate-spin" />
            {t("thinking")}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-xl bg-destructive/12 px-3 py-2 text-xs text-destructive/90">
          {error}
        </p>
      ) : null}

      {ended ? (
        <div className="rounded-2xl bg-white/[0.05] px-4 py-3 text-center">
          <p className="text-sm font-semibold text-white/80">{t("theEnd")}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void begin()}>
            <IconRefresh className="size-4" />
            {t("playAgain")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.prompt ? (
            <p className="text-xs font-medium text-white/50">{pending.prompt}</p>
          ) : null}
          {pending.choices.length > 0 ? (
            <div className="grid gap-2">
              {pending.choices.map((choice) => (
                <Button
                  key={choice.choiceId}
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act({ kind: "choice", choiceId: choice.choiceId }, choice.label)
                  }
                  className="h-auto justify-start whitespace-normal py-2.5 text-left"
                >
                  {choice.label}
                </Button>
              ))}
            </div>
          ) : null}
          {pending.canContinue && pending.choices.length === 0 ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void act({ kind: "continue" })}
              className="w-full"
            >
              {t("continue")}
            </Button>
          ) : null}
          {pending.suggestions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {pending.suggestions.map((suggestion, index) => (
                <button
                  key={`${index}:${suggestion}`}
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ kind: "free", text: suggestion }, suggestion)}
                  className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/62 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-center gap-2 rounded-2xl bg-white/[0.04] p-1.5">
            <Input
              value={draftText}
              disabled={busy || !state}
              placeholder={t("inputPlaceholder")}
              onChange={(event) => setDraftText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitFree();
                }
              }}
              className="h-10 min-w-0 flex-1 rounded-xl bg-transparent px-3"
            />
            <Button
              size="icon"
              disabled={busy || !draftText.trim()}
              onClick={submitFree}
              aria-label={t("send")}
            >
              <IconSend2 className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedBubble({ entry, anchorLabel }: { entry: FeedEntry; anchorLabel: string }) {
  if (entry.kind === "anchor") {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-white/34 uppercase">
          {entry.title || anchorLabel}
        </p>
        {entry.body ? <p className="mt-1.5 text-sm leading-6 text-white/78">{entry.body}</p> : null}
      </div>
    );
  }
  if (entry.kind === "narration") {
    return <p className="px-1 text-sm leading-7 text-white/72">{entry.text}</p>;
  }
  if (entry.kind === "player") {
    return (
      <p className="ml-auto max-w-[80%] rounded-2xl bg-white/[0.1] px-3.5 py-2 text-sm leading-6 text-white/88">
        {entry.text}
      </p>
    );
  }
  return (
    <div className="rounded-2xl bg-white/[0.06] px-4 py-3 text-center">
      <p className="text-sm font-semibold text-white/82">{entry.title}</p>
      {entry.summary ? (
        <p className="mt-1 text-xs leading-5 text-white/52">{entry.summary}</p>
      ) : null}
    </div>
  );
}

function CenterLoader({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-white/50">
      <IconLoader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}
