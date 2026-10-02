"use client";

import { useId, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconBroadcast,
  IconRefresh,
  IconRotateClockwise2,
} from "@tabler/icons-react";
import type { StoryPlaybackGame } from "@repo/shared/story-playback";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  formatBytes,
  formatClockTime,
  formatPlaybackDateTime,
  formatRelativeTime,
  PLAYBACK_CLEANUP_REASON_LABELS,
  PLAYBACK_CLEANUP_STATE_LABELS,
  playbackCataloguePill,
  reconcileNotice,
  reconcilerHeartbeat,
  reconcilerWarnings,
  retryableClipCount,
  retryFailedNotice,
  takedownStatusLabel,
  takedownStatusTone,
  type InteractiveFilmPlaybackLoadResult,
  type PlaybackNotice,
} from "@/lib/interactive-film-playback-view";
import { cn } from "@/lib/utils";
import { useAdminOperation } from "../../use-admin-operation";
import { InteractiveFilmErrorBanner, InteractiveFilmMetric } from "../shared";
import { PlaybackClipTable } from "./playback-clip-table";
import { PlaybackPill } from "./playback-pill";
import {
  readInteractiveFilmPlayback,
  reconcileInteractiveFilmPlayback,
  retryFailedInteractiveFilmPlayback,
} from "./request";

type PlaybackSummary = NonNullable<StoryPlaybackGame["summary"]>;
type CleanupItem = NonNullable<StoryPlaybackGame["cleanup"]["items"]>[number];
type Operation = NonNullable<ReturnType<ReturnType<typeof useAdminOperation>["begin"]>>;

/**
 * 播放分发（HLS）for one work on the cn site. Nest owns every state shown here;
 * the section only reads it and triggers the two operator actions, re-reading
 * after each. A newer server render (router.refresh) is adopted by its
 * `generatedAt`; there is no polling.
 */
export function InteractiveFilmPlaybackSection({
  gameId,
  title,
  playback,
}: {
  gameId: string;
  title: string | null;
  playback: InteractiveFilmPlaybackLoadResult;
}) {
  const headingId = useId();
  const sourceKey = playback.data?.generatedAt ?? `error:${playback.error ?? ""}`;
  const [adoptedKey, setAdoptedKey] = useState(sourceKey);
  const [overview, setOverview] = useState(playback.data);
  const [loadError, setLoadError] = useState(playback.error);
  const [notice, setNotice] = useState<PlaybackNotice | null>(null);
  const { busy, begin } = useAdminOperation();
  if (sourceKey !== adoptedKey) {
    setAdoptedKey(sourceKey);
    setOverview(playback.data);
    setLoadError(playback.error);
  }

  const game = overview?.games.find((entry) => entry.gameId === gameId) ?? null;
  const retryable = retryableClipCount(game?.summary ?? null);
  const workName = title ? `《${title}》` : `作品 ${gameId}`;

  async function reload(operation: Operation) {
    try {
      const next = await readInteractiveFilmPlayback([gameId], {
        includeClips: true,
        signal: operation.signal,
      });
      if (!operation.current()) return;
      setOverview(next);
      setLoadError(null);
    } catch (error) {
      if (operation.current()) setLoadError(playbackErrorMessage(error));
    }
  }

  async function refresh() {
    const operation = begin("read");
    if (!operation) return;
    try {
      await reload(operation);
    } finally {
      operation.finish();
    }
  }

  async function runAction(
    failure: string,
    action: (signal: AbortSignal) => Promise<PlaybackNotice>
  ) {
    const operation = begin();
    if (!operation) return;
    setNotice(null);
    try {
      let outcome: PlaybackNotice;
      try {
        outcome = await action(operation.signal);
      } catch (error) {
        // Nest may have committed part of a failed call (some clips requeued, a
        // cycle already run), so a failure re-reads too and keeps its error verbatim.
        outcome = {
          tone: "risk",
          message: `${failure}：${playbackErrorMessage(error)}`,
          details: [],
        };
      }
      if (!operation.current()) return;
      setNotice(outcome);
      await reload(operation);
    } finally {
      operation.finish();
    }
  }

  const reconcile = () =>
    runAction("立即对账失败", async (signal) =>
      reconcileNotice(await reconcileInteractiveFilmPlayback(signal))
    );
  const retryFailed = () =>
    runAction("重试请求失败", async (signal) =>
      retryFailedNotice(await retryFailedInteractiveFilmPlayback(gameId, signal))
    );

  const pill = game ? playbackCataloguePill(game) : null;
  const warnings = overview ? reconcilerWarnings(overview.reconciler, overview.generatedAt) : [];
  return (
    <section aria-labelledby={headingId} className="space-y-4 border-t border-slate-200 pt-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <IconBroadcast className="size-4 text-slate-500" />
            <h2 id={headingId} className="text-sm font-semibold text-slate-950">
              播放分发（HLS）
            </h2>
            {pill ? <PlaybackPill tone={pill.tone}>{pill.text}</PlaybackPill> : null}
          </div>
          {overview ? (
            <p className="text-[12px] text-slate-500">
              {reconcilerHeartbeat(overview.reconciler, overview.generatedAt)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="刷新播放分发"
            title="刷新"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <IconRefresh className={cn("size-3.5", busy && "animate-spin")} />
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void reconcile()}>
            <IconArrowsExchange className="size-3.5" />
            立即对账
          </Button>
          <ConfirmDialog
            title="重试失败的 HLS 片段？"
            description={`将为${workName}重新提交 ${retryable} 个失败或重试中的片段。每个片段都会再次调用阿里云 IMM 转码，并重新产生转码费用。`}
            confirmLabel={`重试 ${retryable} 个片段`}
            onConfirm={retryFailed}
            trigger={
              <Button variant="outline" size="sm" disabled={busy || retryable === 0}>
                <IconRotateClockwise2 className="size-3.5" />
                重试失败的片段 ({retryable})
              </Button>
            }
          />
        </div>
      </div>

      {warnings.length ? <ReconcilerBand lines={warnings} /> : null}
      {loadError ? (
        <InteractiveFilmErrorBanner message={`播放分发数据加载失败：${loadError}`} />
      ) : null}
      {overview && !game ? (
        <InteractiveFilmErrorBanner message={`后台返回的播放分发数据中没有作品 ${gameId}。`} />
      ) : null}
      {notice ? <NoticeBanner notice={notice} /> : null}

      {game?.summary ? <PlaybackMetrics summary={game.summary} /> : null}
      {game && !game.summary ? <CatalogueStateNote game={game} /> : null}
      {overview && game?.cleanup.items?.length ? (
        <CleanupTable items={game.cleanup.items} generatedAt={overview.generatedAt} />
      ) : null}
      {overview && game?.summary && game.clips ? (
        <PlaybackClipTable
          clips={game.clips}
          renditionLadder={overview.renditionLadder}
          generatedAt={overview.generatedAt}
        />
      ) : null}
    </section>
  );
}

const STATE_SEGMENTS: {
  key: string;
  label: string;
  className: string;
  count: (summary: PlaybackSummary) => number;
}[] = [
  { key: "ready", label: "已就绪", className: "bg-emerald-500", count: (s) => s.ready },
  { key: "processing", label: "转码中", className: "bg-sky-500", count: (s) => s.processing },
  { key: "queued", label: "排队", className: "bg-sky-200", count: (s) => s.queued + s.notQueued },
  { key: "retrying", label: "重试中", className: "bg-amber-400", count: (s) => s.retrying },
  { key: "failed", label: "失败", className: "bg-red-500", count: (s) => s.failed },
  { key: "blocked", label: "已屏蔽", className: "bg-slate-600", count: (s) => s.blocked },
  { key: "excluded", label: "不转码", className: "bg-slate-300", count: (s) => s.excluded },
];

function PlaybackMetrics({ summary }: { summary: PlaybackSummary }) {
  const segments = STATE_SEGMENTS.map((segment) => ({ ...segment, value: segment.count(summary) }));
  const allReady = summary.eligible > 0 && summary.ready === summary.eligible;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <InteractiveFilmMetric
          label="就绪"
          value={`${summary.ready}/${summary.eligible}`}
          tone={allReady ? "success" : "default"}
        />
        <InteractiveFilmMetric label="排队" value={summary.queued + summary.notQueued} />
        <InteractiveFilmMetric label="转码中" value={summary.processing} />
        <InteractiveFilmMetric
          label="重试中"
          value={summary.retrying}
          tone={summary.retrying ? "warn" : "default"}
        />
        <InteractiveFilmMetric
          label="失败"
          value={summary.failed}
          tone={summary.failed ? "risk" : "default"}
        />
        <InteractiveFilmMetric label="已屏蔽" value={summary.blocked} />
        <InteractiveFilmMetric label="不转码" value={summary.excluded} />
      </div>
      <figure className="space-y-2">
        <div
          role="img"
          aria-label={`片段状态：${segments.map((segment) => `${segment.label} ${segment.value}`).join("，")}`}
          className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100"
        >
          {segments
            .filter((segment) => segment.value > 0)
            .map((segment) => (
              <span
                key={segment.key}
                title={`${segment.label} ${segment.value}/${summary.total}`}
                className={cn("h-full basis-0", segment.className)}
                style={{ flexGrow: segment.value }}
              />
            ))}
        </div>
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          {segments.map((segment) => (
            <span key={segment.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2 rounded-full", segment.className)} />
              {segment.label}
              <span className="font-medium tabular-nums text-slate-900">{segment.value}</span>
            </span>
          ))}
        </figcaption>
      </figure>
    </div>
  );
}

function CatalogueStateNote({ game }: { game: StoryPlaybackGame }) {
  const text = !game.managed
    ? "非 Story Studio 作品，不参与 HLS 转码。"
    : !game.catalogue.listed
      ? "作品不在玩家目录中，不会新建转码。"
      : `玩家目录版本 ${game.catalogue.version ?? "—"} 没有对应的可播放构建，无法统计片段。`;
  return (
    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
      {text}
    </p>
  );
}

function CleanupTable({ items, generatedAt }: { items: CleanupItem[]; generatedAt: string }) {
  const columns = useMemo<ColumnDef<CleanupItem, unknown>[]>(
    () => [
      {
        id: "asset",
        header: "资产",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-slate-600">{row.original.assetId}</span>
        ),
      },
      {
        id: "reason",
        header: "原因",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-700">
            {PLAYBACK_CLEANUP_REASON_LABELS[row.original.reason]}
          </span>
        ),
      },
      {
        id: "state",
        header: "状态",
        enableSorting: false,
        cell: ({ row }) => (
          <PlaybackPill tone={row.original.state === "cleaning" ? "info" : "muted"}>
            {PLAYBACK_CLEANUP_STATE_LABELS[row.original.state]}
          </PlaybackPill>
        ),
      },
      {
        id: "scheduledAt",
        header: "计划时间",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.scheduledAt ? (
            <div className="whitespace-nowrap text-[12px] tabular-nums text-slate-700">
              <p>{formatPlaybackDateTime(row.original.scheduledAt)}</p>
              <p className="text-[11px] text-slate-500">
                {formatRelativeTime(row.original.scheduledAt, generatedAt)}
              </p>
            </div>
          ) : (
            <span className="text-[12px] text-slate-400">—</span>
          ),
      },
      {
        id: "outputBytes",
        header: "输出大小",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-700">
            {formatBytes(row.original.outputBytes)}
          </span>
        ),
      },
      {
        id: "takedown",
        header: "清理任务",
        enableSorting: false,
        cell: ({ row }) => {
          const takedown = row.original.takedown;
          if (!takedown) return <span className="text-[12px] text-slate-400">—</span>;
          return (
            <div className="w-[300px] space-y-1 whitespace-normal text-[11px]">
              <PlaybackPill tone={takedownStatusTone(takedown)}>
                {takedownStatusLabel(takedown)}
              </PlaybackPill>
              <p className="font-mono text-[10px] text-slate-500">
                第 {takedown.attempt} 次
                {takedown.nextAttemptAt ? ` · 下次 ${formatClockTime(takedown.nextAttemptAt)}` : ""}
                {takedown.cdnRefreshedAt
                  ? ` · CDN 已刷新 ${formatClockTime(takedown.cdnRefreshedAt)}`
                  : ""}
              </p>
              {takedown.error ? <p className="break-all text-red-700">{takedown.error}</p> : null}
            </div>
          );
        },
      },
    ],
    [generatedAt]
  );
  return (
    <div className="space-y-2">
      <h3 className="text-[12px] font-semibold text-slate-700">待清理输出（{items.length}）</h3>
      <DataTable columns={columns} data={items} minWidth={960} getRowId={(item) => item.assetId} />
    </div>
  );
}

function ReconcilerBand({ lines }: { lines: string[] }) {
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-900"
      role="alert"
    >
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        {lines.map((line) => (
          <p key={line} className="break-words">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

const NOTICE_TONES: Record<PlaybackNotice["tone"], string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  risk: "border-red-200 bg-red-50 text-red-700",
  muted: "border-slate-200 bg-slate-50 text-slate-700",
};

function NoticeBanner({ notice }: { notice: PlaybackNotice }) {
  return (
    <div
      className={cn("rounded-xl border px-4 py-3 text-sm", NOTICE_TONES[notice.tone])}
      role={notice.tone === "risk" ? "alert" : "status"}
    >
      <p className="break-words">{notice.message}</p>
      {notice.details.length ? (
        <ul className="mt-2 space-y-1 font-mono text-[11px]">
          {notice.details.map((detail, index) => (
            <li key={index} className="break-all">
              {detail}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function playbackErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "播放分发请求失败。";
}
