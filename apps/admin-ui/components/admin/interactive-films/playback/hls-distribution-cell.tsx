"use client";

import { useEffect, useMemo, useState } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { StoryPlaybackGame, StoryPlaybackOverview } from "@repo/shared/story-playback";
import { hlsListCell } from "@/lib/interactive-film-playback-view";
import { useAdminOperation } from "../../use-admin-operation";
import { PlaybackPill } from "./playback-pill";
import { readInteractiveFilmPlayback } from "./request";

export type HlsDistribution = {
  games: ReadonlyMap<string, StoryPlaybackGame>;
  generatedAt: string | null;
  loading: boolean;
  error: string | null;
};

/**
 * Reads HLS summaries for the visible works after the Java list has rendered,
 * so the review queue never waits on Nest. `items` gets a new identity on every
 * server render (page, filter or refresh), which re-reads the column. `null`
 * disables the column (non-cn sites).
 */
export function useHlsDistribution(items: readonly { gameId: string }[] | null): HlsDistribution {
  const { busy, begin } = useAdminOperation(items !== null);
  const rows = items?.map((item) => item.gameId).join(",") ?? "";
  const [result, setResult] = useState<{
    rows: string;
    overview: StoryPlaybackOverview | null;
    error: string | null;
  }>({ rows: "", overview: null, error: null });

  useEffect(() => {
    if (!items?.length) return;
    const operation = begin("read");
    if (!operation) return;
    void readInteractiveFilmPlayback(
      items.map((item) => item.gameId),
      { includeClips: false, signal: operation.signal }
    )
      .then((overview) => {
        if (operation.current()) setResult({ rows, overview, error: null });
      })
      .catch((error: unknown) => {
        if (!operation.current()) return;
        setResult({
          rows,
          overview: null,
          error: error instanceof Error ? error.message : "HLS 分发状态加载失败。",
        });
      })
      .finally(() => operation.finish());
  }, [begin, items, rows]);

  // The error describes the whole read, so only the rows it was read for show it.
  // Entries are keyed by gameId, so a refresh keeps the cells the last read
  // covered, and other rows show loading until their own read lands.
  const current = result.rows === rows;
  const games = useMemo(
    () => new Map((result.overview?.games ?? []).map((game) => [game.gameId, game])),
    [result.overview]
  );
  return {
    games,
    generatedAt: result.overview?.generatedAt ?? null,
    loading: busy || !current,
    error: current ? result.error : null,
  };
}

export function HlsDistributionCell({
  game,
  generatedAt,
  loading,
}: {
  game: StoryPlaybackGame | undefined;
  generatedAt: string | null;
  loading: boolean;
}) {
  if (!game || !generatedAt) {
    return <span className="text-[12px] text-slate-400">{loading ? "加载中…" : "—"}</span>;
  }
  const cell = hlsListCell(game, generatedAt);
  if (cell.tone === "muted") {
    return <span className="whitespace-nowrap text-[12px] text-slate-500">{cell.text}</span>;
  }
  return <PlaybackPill tone={cell.tone}>{cell.text}</PlaybackPill>;
}

export function HlsDistributionError({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"
      role="alert"
    >
      <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">HLS 分发状态加载失败：{message}</span>
    </div>
  );
}
