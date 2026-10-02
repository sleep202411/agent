"use client";

import { useMemo, useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronRight, IconPlayerPlay } from "@tabler/icons-react";
import type {
  StoryPlaybackClip,
  StoryPlaybackClipState,
  StoryPlaybackTakedown,
} from "@repo/shared/story-playback";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatBytes,
  formatClockTime,
  formatPlaybackDateTime,
  formatSeconds,
  PLAYBACK_EXCLUSION_LABELS,
  PLAYBACK_JOB_STATUS_LABELS,
  PLAYBACK_MODERATION_LABELS,
  PLAYBACK_STATE_LABELS,
  PLAYBACK_STATE_TONES,
  takedownStatusLabel,
  takedownStatusTone,
} from "@/lib/interactive-film-playback-view";
import { cn } from "@/lib/utils";
import { HlsPreviewPlayer } from "./hls-preview-player";
import { PlaybackPill } from "./playback-pill";

type Occurrence = StoryPlaybackClip["occurrences"][number];
type StateFilter = "all" | StoryPlaybackClipState;

// A work can hold a hundred or more clips; rendering every row at once makes the
// page sluggish, so the table pages and the toolbar narrows it to one state.
const PAGE_SIZE = 20;
const STATE_FILTER_ORDER: StoryPlaybackClipState[] = [
  "failed",
  "retrying",
  "processing",
  "queued",
  "not_queued",
  "ready",
  "blocked",
  "excluded",
];

export function PlaybackClipTable({
  clips,
  renditionLadder,
  generatedAt,
}: {
  clips: StoryPlaybackClip[];
  renditionLadder: string[];
  generatedAt: string;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const stateCounts = useMemo(() => {
    const counts = new Map<StoryPlaybackClipState, number>();
    for (const clip of clips) counts.set(clip.hls.state, (counts.get(clip.hls.state) ?? 0) + 1);
    return counts;
  }, [clips]);
  const visibleClips = useMemo(
    () => (stateFilter === "all" ? clips : clips.filter((clip) => clip.hls.state === stateFilter)),
    [clips, stateFilter]
  );
  const preview = clips.find((clip) => clip.assetId === previewId) ?? null;
  const previewUrl = preview?.hls.playback?.url ?? null;
  if (previewId !== null && previewUrl === null) setPreviewId(null);

  const columns = useMemo<ColumnDef<StoryPlaybackClip, unknown>[]>(
    () => [
      {
        id: "expander",
        header: "",
        enableSorting: false,
        meta: { cellClassName: "w-[44px]" },
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => row.toggleExpanded()}
            aria-label={row.getIsExpanded() ? "收起片段详情" : "展开片段详情"}
            className="grid size-7 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:text-slate-900"
          >
            {row.getIsExpanded() ? (
              <IconChevronDown className="size-4" />
            ) : (
              <IconChevronRight className="size-4" />
            )}
          </button>
        ),
      },
      {
        id: "scene",
        header: "场景/片段",
        enableSorting: false,
        cell: ({ row }) => {
          const clip = row.original;
          const [first, ...more] = clip.occurrences;
          return (
            <div className="min-w-0 max-w-[260px]">
              <p className="truncate text-[13px] font-medium text-slate-950">
                {occurrenceLabel(first!)}
              </p>
              <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
                {first!.logicalKey}
              </p>
              <p className="truncate font-mono text-[10px] text-slate-400">{clip.assetId}</p>
              {more.length ? (
                <p className="mt-1 text-[11px] text-slate-500">另有 {more.length} 处引用</p>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "duration",
        header: "时长",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-700">
            {row.original.durationMs == null ? "—" : formatSeconds(row.original.durationMs / 1000)}
          </span>
        ),
      },
      {
        id: "source",
        header: "源大小",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-700">
            {formatBytes(row.original.source.sizeBytes)}
          </span>
        ),
      },
      {
        id: "state",
        header: "HLS 状态",
        enableSorting: false,
        cell: ({ row }) => <ClipStateCell clip={row.original} />,
      },
      {
        id: "renditions",
        header: "档位",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1">
            {renditionLadder.map((name) => {
              const rendition = row.original.hls.renditions.find((item) => item.name === name);
              return (
                <span
                  key={name}
                  title={rendition ? renditionSize(rendition) : `${name} 未产出`}
                  data-filled={rendition ? "true" : "false"}
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
                    rendition
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-400"
                  )}
                >
                  {name}
                </span>
              );
            })}
          </div>
        ),
      },
      {
        id: "output",
        header: "输出大小",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-700">
            {formatBytes(row.original.hls.outputBytes)}
          </span>
        ),
      },
      {
        id: "transcode",
        header: "转码耗时",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-700">
            {transcodeTime(row.original, generatedAt)}
          </span>
        ),
      },
      {
        id: "error",
        header: "错误",
        enableSorting: false,
        cell: ({ row }) => {
          const error = row.original.hls.job?.error;
          return error ? (
            <p
              className="line-clamp-2 w-[220px] whitespace-normal break-all text-[12px] text-red-700"
              title={error}
            >
              {error}
            </p>
          ) : (
            <span className="text-[12px] text-slate-400">—</span>
          );
        },
      },
      {
        id: "preview",
        header: "预览",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="xs"
            disabled={!row.original.hls.playback}
            onClick={() => setPreviewId(row.original.assetId)}
          >
            <IconPlayerPlay className="size-3" />
            预览
          </Button>
        ),
      },
    ],
    [generatedAt, renditionLadder]
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-slate-500">
          {stateFilter === "all"
            ? `共 ${clips.length} 个片段`
            : `${visibleClips.length} / ${clips.length} 个片段`}
        </p>
        <Select value={stateFilter} onValueChange={(value) => setStateFilter(value as StateFilter)}>
          <SelectTrigger className="h-9 w-full sm:w-[160px]" aria-label="HLS 状态筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态（{clips.length}）</SelectItem>
            {STATE_FILTER_ORDER.filter(
              (state) => stateCounts.has(state) || state === stateFilter
            ).map((state) => (
              <SelectItem key={state} value={state}>
                {PLAYBACK_STATE_LABELS[state]}（{stateCounts.get(state) ?? 0}）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        key={stateFilter}
        columns={columns}
        data={visibleClips}
        minWidth={1360}
        pageSize={PAGE_SIZE}
        getRowId={(clip) => clip.assetId}
        emptyLabel={stateFilter === "all" ? "该版本没有视频片段" : "没有该状态的片段"}
        renderExpanded={(clip) => <ClipDetails clip={clip} />}
      />
      <Dialog
        open={preview !== null && previewUrl !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              HLS 预览 · {preview ? occurrenceLabel(preview.occurrences[0]!) : ""}
            </DialogTitle>
            <DialogDescription className="break-all font-mono text-[11px]">
              {previewUrl}
            </DialogDescription>
          </DialogHeader>
          {preview && previewUrl ? (
            <HlsPreviewPlayer key={preview.assetId} url={previewUrl} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ClipStateCell({ clip }: { clip: StoryPlaybackClip }) {
  const { state, exclusion, job } = clip.hls;
  return (
    <div className="w-[240px] space-y-1 whitespace-normal">
      <PlaybackPill tone={PLAYBACK_STATE_TONES[state]}>{PLAYBACK_STATE_LABELS[state]}</PlaybackPill>
      {state === "excluded" && exclusion ? (
        <p className="text-[11px] text-slate-500">{PLAYBACK_EXCLUSION_LABELS[exclusion]}</p>
      ) : null}
      {state === "blocked" ? (
        <div className="space-y-1 text-[11px]">
          <p className="break-words text-slate-600">{clip.moderation.reason ?? "未填写屏蔽原因"}</p>
          {clip.moderation.takedown ? <TakedownStatus takedown={clip.moderation.takedown} /> : null}
        </div>
      ) : null}
      {job ? (
        <div className="space-y-0.5 font-mono text-[10px] text-slate-500">
          <p>
            attempt {job.attempt}/{job.maxAttempts}
            {job.nextAttemptAt ? ` · 下次 ${formatClockTime(job.nextAttemptAt)}` : ""}
          </p>
          {job.immTaskId ? (
            <p className="truncate" title={job.immTaskId}>
              IMM {job.immTaskId}
            </p>
          ) : null}
          <p className="truncate" title={job.id}>
            job {job.id}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function TakedownStatus({ takedown }: { takedown: StoryPlaybackTakedown }) {
  return (
    <div className="space-y-0.5">
      <PlaybackPill tone={takedownStatusTone(takedown)}>
        {takedownStatusLabel(takedown)}
      </PlaybackPill>
      {takedown.error ? <p className="break-all text-red-700">{takedown.error}</p> : null}
    </div>
  );
}

function ClipDetails({ clip }: { clip: StoryPlaybackClip }) {
  const { job, playback, renditions } = clip.hls;
  const takedown = clip.moderation.takedown;
  return (
    <div className="sticky left-0 grid max-w-[900px] gap-4 whitespace-normal px-4 py-3 text-[12px] md:grid-cols-2">
      <DetailBlock title="引用位置">
        <ul className="space-y-2">
          {clip.occurrences.map((occurrence) => (
            <li key={`${occurrence.buildId}:${occurrence.logicalKey}`}>
              <p className="text-slate-800">{occurrenceLabel(occurrence)}</p>
              <p className="break-all font-mono text-[10px] text-slate-500">
                {occurrence.sceneId} · {occurrence.logicalKey} · build {occurrence.buildId}
              </p>
            </li>
          ))}
        </ul>
      </DetailBlock>
      <DetailBlock title="源文件与输出">
        <DetailRow label="类型" value={clip.source.contentType} />
        <DetailRow
          label="源规格"
          value={`${formatBytes(clip.source.sizeBytes)} · ${dimensions(clip.source.width, clip.source.height)}`}
        />
        <DetailRow
          label="档位"
          value={renditions.length ? renditions.map(renditionSize).join("，") : "—"}
        />
        <DetailRow label="输出大小" value={formatBytes(clip.hls.outputBytes)} />
        <DetailRow label="Master" value={playback?.url ?? "—"} mono />
      </DetailBlock>
      <DetailBlock title="转码任务">
        {job ? (
          <>
            <DetailRow label="状态" value={PLAYBACK_JOB_STATUS_LABELS[job.status]} />
            <DetailRow label="尝试" value={`${job.attempt}/${job.maxAttempts}`} />
            <DetailRow label="Job" value={job.id} mono />
            <DetailRow label="IMM 任务" value={job.immTaskId ?? "—"} mono />
            <DetailRow label="提交时间" value={formatPlaybackDateTime(job.submittedAt)} />
            <DetailRow label="完成时间" value={formatPlaybackDateTime(job.completedAt)} />
            <DetailRow label="下次尝试" value={formatPlaybackDateTime(job.nextAttemptAt)} />
          </>
        ) : (
          <p className="text-slate-500">尚无转码任务。</p>
        )}
      </DetailBlock>
      <DetailBlock title="审核与清理">
        <DetailRow label="审核" value={PLAYBACK_MODERATION_LABELS[clip.moderation.status]} />
        <DetailRow label="原因" value={clip.moderation.reason ?? "—"} />
        {takedown ? (
          <>
            <DetailRow
              label="清理"
              value={`${takedownStatusLabel(takedown)} · 第 ${takedown.attempt} 次`}
            />
            <DetailRow label="清理任务" value={takedown.actionId} mono />
            <DetailRow label="下次尝试" value={formatPlaybackDateTime(takedown.nextAttemptAt)} />
            <DetailRow label="CDN 刷新" value={formatPlaybackDateTime(takedown.cdnRefreshedAt)} />
            <DetailRow label="完成时间" value={formatPlaybackDateTime(takedown.completedAt)} />
          </>
        ) : null}
      </DetailBlock>
      {job?.error || takedown?.error ? (
        <DetailBlock title="完整错误" className="md:col-span-2">
          {job?.error ? (
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-red-700">
              {job.error}
            </pre>
          ) : null}
          {takedown?.error ? (
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-red-700">
              {takedown.error}
            </pre>
          ) : null}
        </DetailBlock>
      ) : null}
    </div>
  );
}

function DetailBlock({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("min-w-0 space-y-1.5", className)}>
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {title}
      </h4>
      {children}
    </section>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={cn("break-all text-slate-800", mono && "font-mono text-[11px]")}>
        {value}
      </span>
    </div>
  );
}

function occurrenceLabel(occurrence: Occurrence): string {
  const chapter =
    occurrence.chapterTitle ??
    (occurrence.chapterRank == null ? null : `章节 #${occurrence.chapterRank}`);
  return [chapter, occurrence.sceneLabel, `片段 ${occurrence.clipIndex}`]
    .filter(Boolean)
    .join(" · ");
}

function renditionSize(rendition: StoryPlaybackClip["hls"]["renditions"][number]): string {
  return `${rendition.name} ${dimensions(rendition.width, rendition.height)}`;
}

function dimensions(width: number | null, height: number | null): string {
  return width && height ? `${width}×${height}` : "尺寸未知";
}

function transcodeTime(clip: StoryPlaybackClip, generatedAt: string): string {
  const job = clip.hls.job;
  if (!job) return "—";
  if (job.transcodeSeconds != null) return formatSeconds(job.transcodeSeconds);
  if (clip.hls.state === "processing" && job.submittedAt) {
    return `已进行 ${formatSeconds((Date.parse(generatedAt) - Date.parse(job.submittedAt)) / 1000)}`;
  }
  return "—";
}
