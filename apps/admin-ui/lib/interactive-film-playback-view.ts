import type {
  StoryPlaybackClip,
  StoryPlaybackClipState,
  StoryPlaybackExclusion,
  StoryPlaybackGame,
  StoryPlaybackOverview,
  StoryPlaybackReconcileResult,
  StoryPlaybackRetryFailedResult,
  StoryPlaybackTakedown,
} from "@repo/shared/story-playback";

/**
 * Presentation rules for the .cn interactive-film HLS distribution views.
 * Isomorphic and pure: every relative time is measured against the overview's
 * `generatedAt`, never the render clock, so server and client agree.
 */

/** The detail page's HLS read: Nest's overview, or its error verbatim. */
export type InteractiveFilmPlaybackLoadResult = {
  data: StoryPlaybackOverview | null;
  error: string | null;
};

export type PlaybackTone = "success" | "info" | "warn" | "risk" | "muted";

type PlaybackJob = NonNullable<StoryPlaybackClip["hls"]["job"]>;
type PlaybackSummary = NonNullable<StoryPlaybackGame["summary"]>;
type PlaybackCleanupItem = NonNullable<StoryPlaybackGame["cleanup"]["items"]>[number];
type PlaybackReconciler = StoryPlaybackOverview["reconciler"];

export const PLAYBACK_STATE_LABELS: Record<StoryPlaybackClipState, string> = {
  ready: "已就绪",
  queued: "排队中",
  processing: "转码中",
  retrying: "重试中",
  failed: "失败",
  not_queued: "待入队",
  blocked: "已屏蔽",
  excluded: "不转码",
};

export const PLAYBACK_STATE_TONES: Record<StoryPlaybackClipState, PlaybackTone> = {
  ready: "success",
  queued: "info",
  processing: "info",
  retrying: "warn",
  failed: "risk",
  not_queued: "muted",
  blocked: "risk",
  excluded: "muted",
};

export const PLAYBACK_EXCLUSION_LABELS: Record<StoryPlaybackExclusion, string> = {
  unavailable: "源文件不可用",
  storage_provider: "非本站 OSS 存储",
  moderation_pending: "待审核",
  pinned_rendition: "指定了非原始版本",
  paid_content: "付费作品",
  invalid_build: "版本清单无法解析",
};

export const PLAYBACK_MODERATION_LABELS: Record<StoryPlaybackClip["moderation"]["status"], string> =
  {
    unreviewed: "默认可用 / 未复核",
    approved: "确认安全",
    flagged: "标记复核",
    blocked: "全平台下架",
  };

export const PLAYBACK_JOB_STATUS_LABELS: Record<PlaybackJob["status"], string> = {
  pending: "待执行",
  processing: "执行中",
  completed: "已完成",
  failed: "失败待重试",
  cancelled: "已取消",
  dead: "已终止",
};

export const PLAYBACK_CLEANUP_REASON_LABELS: Record<PlaybackCleanupItem["reason"], string> = {
  offline: "作品下线",
  replaced: "版本替换",
};

export const PLAYBACK_CLEANUP_STATE_LABELS: Record<PlaybackCleanupItem["state"], string> = {
  scheduled: "待清理",
  cleaning: "清理中",
};

export function takedownStatusLabel(takedown: StoryPlaybackTakedown): string {
  if (takedown.status === "completed") return "已清理";
  if (takedown.status === "failed") return "清理失败";
  return takedown.waitingForTranscode ? "等待转码结束" : "清理中";
}

export function takedownStatusTone(takedown: StoryPlaybackTakedown): PlaybackTone {
  if (takedown.status === "completed") return "success";
  return takedown.status === "failed" ? "risk" : "info";
}

/** Clips the retry action re-queues: dead jobs plus failed jobs awaiting backoff. */
export function retryableClipCount(summary: PlaybackSummary | null): number {
  return summary ? summary.failed + summary.retrying : 0;
}

export type HlsListCell = { text: string; tone: "success" | "warn" | "risk" | "muted" };

/** The review list's HLS column; the first matching rule wins. */
export function hlsListCell(game: StoryPlaybackGame, generatedAt: string): HlsListCell {
  if (!game.managed || !game.catalogue.listed) {
    if (game.cleanup.pending === 0) return { text: "—", tone: "muted" };
    const next = game.cleanup.nextAt
      ? ` · ${formatRelativeTime(game.cleanup.nextAt, generatedAt)}`
      : "";
    return { text: `待清理 ${game.cleanup.pending}${next}`, tone: "muted" };
  }
  const summary = game.summary;
  if (!game.catalogue.versionResolved || !summary) return { text: "版本未解析", tone: "warn" };
  if (summary.total === 0) return { text: "无视频片段", tone: "muted" };
  const progress = `${summary.ready}/${summary.eligible}`;
  if (summary.eligible === 0) {
    const reason = ineligibleReason(game, summary);
    return { text: reason ? `不转码（${reason}）` : "不转码", tone: "muted" };
  }
  if (summary.failed > 0) return { text: `失败 ${summary.failed} · ${progress}`, tone: "risk" };
  if (summary.queued + summary.processing + summary.retrying + summary.notQueued > 0) {
    return {
      text: `${summary.processing > 0 ? "转码中" : "排队中"} ${progress}`,
      tone: "warn",
    };
  }
  return {
    text: summary.blocked > 0 ? `${progress} · 屏蔽 ${summary.blocked}` : progress,
    tone: "success",
  };
}

/**
 * Why no clip of the work transcodes. Exclusion reasons travel only with
 * `include=clips` (one work per request), so the list knows the reason only
 * when every clip is blocked.
 */
function ineligibleReason(game: StoryPlaybackGame, summary: PlaybackSummary): string | null {
  if (!game.clips) return summary.excluded === 0 ? PLAYBACK_STATE_LABELS.blocked : null;
  const reasons = new Set(
    game.clips.flatMap((clip) =>
      clip.hls.state === "blocked"
        ? [PLAYBACK_STATE_LABELS.blocked]
        : clip.hls.state === "excluded" && clip.hls.exclusion
          ? [PLAYBACK_EXCLUSION_LABELS[clip.hls.exclusion]]
          : []
    )
  );
  if (reasons.size === 0) return null;
  return reasons.size === 1 ? [...reasons][0] : "混合原因";
}

/** The detail section's catalogue pill. */
export function playbackCataloguePill(game: StoryPlaybackGame): {
  text: string;
  tone: PlaybackTone;
} {
  if (!game.managed) return { text: "非 Story Studio 作品", tone: "muted" };
  if (!game.catalogue.listed) return { text: "不在玩家目录", tone: "muted" };
  if (!game.catalogue.versionResolved) return { text: "版本未解析", tone: "warn" };
  return { text: `玩家目录在线 · ${game.catalogue.version ?? "—"}`, tone: "success" };
}

/** `上次对账 hh:mm（n 分钟前）· 间隔 2 分钟 · 目录 n 部（n 页）· 新入队 n · 清理 n` */
export function reconcilerHeartbeat(reconciler: PlaybackReconciler, generatedAt: string): string {
  const interval = `间隔 ${formatInterval(reconciler.intervalSeconds)}`;
  const run = reconciler.lastRun;
  if (!run) return `尚无对账记录 · ${interval}`;
  const { stats } = run;
  const finished = `${formatClockTime(run.finishedAt)}（${formatRelativeTime(run.finishedAt, generatedAt)}）`;
  return `上次对账 ${finished}· ${interval} · 目录 ${stats.catalogueGames} 部（${stats.cataloguePages} 页）· 新入队 ${stats.enqueued} · 清理 ${stats.expired}`;
}

/** Lines for the amber reconciler band; empty when the reconciler is healthy. */
export function reconcilerWarnings(reconciler: PlaybackReconciler, generatedAt: string): string[] {
  const warnings: string[] = [];
  if (reconciler.lastRun?.status === "failed") {
    warnings.push(`上次对账失败：${reconciler.lastRun.error ?? "后端未返回错误信息。"}`);
  }
  if (reconciler.stateError) warnings.push(`对账状态读取失败：${reconciler.stateError}`);
  if (reconciler.stale && warnings.length === 0) {
    const last = reconciler.lastSucceededAt
      ? `${formatClockTime(reconciler.lastSucceededAt)}（${formatRelativeTime(reconciler.lastSucceededAt, generatedAt)}）`
      : "无记录";
    warnings.push(
      `对账心跳超时：${formatInterval(reconciler.intervalSeconds * 3)}内没有成功对账，上次成功 ${last}。`
    );
  }
  return warnings;
}

export type PlaybackNotice = { tone: PlaybackTone; message: string; details: string[] };

export function reconcileNotice(result: StoryPlaybackReconcileResult): PlaybackNotice {
  if (result.outcome === "already_running") {
    return { tone: "info", message: "已有对账在运行", details: [] };
  }
  const run = result.run;
  if (!run) return { tone: "success", message: "对账完成。", details: [] };
  if (run.status === "failed") {
    return {
      tone: "risk",
      message: `对账失败：${run.error ?? "后端未返回错误信息。"}`,
      details: [],
    };
  }
  const { stats } = run;
  return {
    tone: "success",
    message: `对账完成：目录 ${stats.catalogueGames} 部（${stats.cataloguePages} 页）· 新入队 ${stats.enqueued} · 清理 ${stats.expired}`,
    details: [],
  };
}

export function retryFailedNotice(result: StoryPlaybackRetryFailedResult): PlaybackNotice {
  const refused = result.refused.map((item) => `${item.assetId}：${item.reason}`);
  if (result.requeued.length === 0 && refused.length === 0) {
    return { tone: "info", message: "没有需要重试的片段。", details: [] };
  }
  const message = [
    result.requeued.length ? `已重新入队 ${result.requeued.length} 个片段` : null,
    refused.length ? `${refused.length} 个片段未重试` : null,
  ]
    .filter(Boolean)
    .join("，");
  return { tone: refused.length ? "warn" : "success", message: `${message}。`, details: refused };
}

export function formatBytes(value: string | null | undefined): string {
  if (!value) return "—";
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return `${value} B`;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 10) return `${seconds.toFixed(1)} 秒`;
  const total = Math.round(seconds);
  if (total < 60) return `${total} 秒`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0
    ? `${hours} 小时 ${String(minutes).padStart(2, "0")} 分`
    : `${minutes} 分 ${String(total % 60).padStart(2, "0")} 秒`;
}

export function formatBitrate(bitsPerSecond: number): string {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return "—";
  return bitsPerSecond >= 1_000_000
    ? `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`
    : `${Math.round(bitsPerSecond / 1000)} kbps`;
}

/** zh-CN distance from `now` (the overview's `generatedAt`) to `target`. */
export function formatRelativeTime(target: string | null | undefined, now: string): string {
  if (!target) return "—";
  const deltaMs = Date.parse(target) - Date.parse(now);
  if (!Number.isFinite(deltaMs)) return "—";
  const minutes = Math.floor(Math.abs(deltaMs) / 60_000);
  if (minutes < 1) return deltaMs <= 0 ? "刚刚" : "1 分钟内";
  const amount =
    minutes < 60
      ? `${minutes} 分钟`
      : minutes < 24 * 60
        ? `${Math.floor(minutes / 60)} 小时`
        : `${Math.floor(minutes / (24 * 60))} 天`;
  return deltaMs < 0 ? `${amount}前` : `${amount}后`;
}

const CLOCK_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatClockTime(value: string | null | undefined): string {
  return formatWith(CLOCK_FORMAT, value);
}

export function formatPlaybackDateTime(value: string | null | undefined): string {
  return formatWith(DATE_TIME_FORMAT, value);
}

function formatWith(format: Intl.DateTimeFormat, value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : format.format(date);
}

function formatInterval(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`;
}
