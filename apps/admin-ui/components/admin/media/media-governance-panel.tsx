"use client";

import { useMemo, useState } from "react";
import {
  IconCloud,
  IconPhoto,
  IconRefresh,
  IconRotateClockwise2,
  IconSettingsAutomation,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type AdminMediaAsset,
  type AdminMediaInitialData,
  type AdminMediaModerationAction,
  type AdminMediaProcessingJob,
} from "@/lib/admin-media";
import { cn } from "@/lib/utils";
import {
  ErrorBanner,
  Metric,
  StatusPill,
  formatDate,
  mutateEnvelope,
  requestEnvelope,
  toErrorMessage,
} from "@/components/admin/billing/shared";
import { PageHeader } from "@/components/admin/page-header";

export function MediaGovernancePanel({
  siteLabel,
  databaseLabel,
  initialData,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialData: AdminMediaInitialData;
}) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialData.error);

  const assets = data.assets?.items ?? [];
  const actions = data.moderationActions?.items ?? [];
  const jobs = data.processingJobs?.items ?? [];

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [overview, assetsNext, actionsNext, jobsNext] = await Promise.all([
        requestEnvelope<AdminMediaInitialData["overview"]>("/api/admin/media/overview"),
        requestEnvelope<NonNullable<AdminMediaInitialData["assets"]>>(
          "/api/admin/media/assets?limit=40"
        ),
        requestEnvelope<NonNullable<AdminMediaInitialData["moderationActions"]>>(
          "/api/admin/media/moderation-actions?actionType=purge_cdn&limit=40"
        ),
        requestEnvelope<NonNullable<AdminMediaInitialData["processingJobs"]>>(
          "/api/admin/media/processing-jobs?limit=40"
        ),
      ]);
      setData({
        overview,
        assets: assetsNext,
        moderationActions: actionsNext,
        processingJobs: jobsNext,
        error: null,
      });
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function retryPurge(actionId: string) {
    setMutatingId(actionId);
    setError(null);
    try {
      await mutateEnvelope(`/api/admin/media/moderation-actions/${actionId}/retry`, {});
      await refresh();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setMutatingId(null);
    }
  }

  async function retryProcessingJob(jobId: string) {
    setMutatingId(jobId);
    setError(null);
    try {
      await mutateEnvelope(`/api/admin/media/processing-jobs/${jobId}/retry`, {});
      await refresh();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setMutatingId(null);
    }
  }

  async function backfillOriginalPlacement(assetId: string) {
    setMutatingId(assetId);
    setError(null);
    try {
      await mutateEnvelope(`/api/admin/media/assets/${assetId}/processing-jobs`, {
        jobType: "backfill_original_placement",
        priority: 10,
      });
      await refresh();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setMutatingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="媒体资产"
        description="统一治理图片、视频、音频、上传资产、CDN purge 和衍生处理任务。"
        icon={<IconPhoto className="size-5" />}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
            刷新
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      <OverviewMetrics data={data.overview} />

      <section className="rounded-lg border border-slate-200 bg-white">
        <SectionHeading
          icon={<IconPhoto className="size-4" />}
          title="资产索引"
          caption="按最近创建排序；包含原始对象、variant、placement 和使用来源。"
        />
        <AssetTable
          assets={assets}
          mutatingId={mutatingId}
          onBackfillOriginalPlacement={backfillOriginalPlacement}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white">
          <SectionHeading
            icon={<IconCloud className="size-4" />}
            title="CDN Purge 队列"
            caption="blocked/takedown 后的 CDN 清理任务，失败会进入可重试队列或 DLQ。"
          />
          <PurgeActionTable actions={actions} mutatingId={mutatingId} onRetry={retryPurge} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          <SectionHeading
            icon={<IconSettingsAutomation className="size-4" />}
            title="媒体处理任务"
            caption="缩略图、转码、metadata probe 与历史 backfill 的统一处理队列。"
          />
          <ProcessingJobTable jobs={jobs} mutatingId={mutatingId} onRetry={retryProcessingJob} />
        </section>
      </div>
    </div>
  );
}

function OverviewMetrics({ data }: { data: AdminMediaInitialData["overview"] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
      <Metric label="媒体资产" value={data?.totalAssets ?? "-"} />
      <Metric label="已屏蔽资产" value={data?.blockedAssets ?? "-"} tone="risk" />
      <Metric label="Purging placement" value={data?.purgingPlacements ?? "-"} />
      <Metric label="待处理 purge" value={data?.pendingPurgeActions ?? "-"} />
      <Metric label="Purge DLQ" value={data?.deadPurgeActions ?? "-"} tone="risk" />
      <Metric label="处理中任务" value={data?.activeProcessingJobs ?? "-"} />
      <Metric label="Processing DLQ" value={data?.deadProcessingJobs ?? "-"} tone="risk" />
    </div>
  );
}

function AssetTable({
  assets,
  mutatingId,
  onBackfillOriginalPlacement,
}: {
  assets: AdminMediaAsset[];
  mutatingId: string | null;
  onBackfillOriginalPlacement: (assetId: string) => Promise<void>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead>资产</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>对象</TableHead>
          <TableHead>Variants</TableHead>
          <TableHead>Placements</TableHead>
          <TableHead>最近使用</TableHead>
          <TableHead>创建时间</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assets.map((asset) => {
          const hasOriginal = asset.variants.some((variant) => variant.variantKey === "original");
          return (
            <TableRow key={asset.id}>
              <TableCell className="min-w-56">
                <div className="font-medium text-slate-950">
                  {asset.kind} · {asset.source}
                </div>
                <div className="mt-1 max-w-64 truncate font-mono text-[11px] text-slate-500">
                  {asset.id}
                </div>
                {asset.createdByUserId ? (
                  <div className="text-[11px] text-slate-500">user:{asset.createdByUserId}</div>
                ) : null}
              </TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-1">
                  <Status value={asset.status} />
                  <Status value={asset.moderationStatus} />
                </div>
              </TableCell>
              <TableCell className="max-w-72">
                <div className="font-mono text-[11px] text-slate-600">{asset.storageProvider}</div>
                <div className="mt-1 truncate text-[12px] text-slate-500">
                  {asset.objectKey ?? asset.externalUrl ?? "-"}
                </div>
              </TableCell>
              <TableCell>{asset.variants.length}</TableCell>
              <TableCell>
                <PlacementSummary asset={asset} />
              </TableCell>
              <TableCell>
                {asset.usages[0] ? (
                  <div className="text-[12px] text-slate-600">
                    {asset.usages[0].surface}
                    <div className="text-[11px] text-slate-500">
                      {formatDate(asset.usages[0].lastObservedAt)}
                    </div>
                  </div>
                ) : (
                  <span className="text-slate-400">-</span>
                )}
              </TableCell>
              <TableCell>{formatDate(asset.createdAt)}</TableCell>
              <TableCell className="text-right">
                {!hasOriginal ? (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={mutatingId === asset.id}
                    onClick={() => void onBackfillOriginalPlacement(asset.id)}
                  >
                    <IconRotateClockwise2 className="size-3" />
                    补齐 original
                  </Button>
                ) : (
                  <span className="text-[12px] text-slate-400">已补齐</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
        {assets.length === 0 ? <EmptyRow colSpan={8} text="暂无媒体资产" /> : null}
      </TableBody>
    </Table>
  );
}

function PurgeActionTable({
  actions,
  mutatingId,
  onRetry,
}: {
  actions: AdminMediaModerationAction[];
  mutatingId: string | null;
  onRetry: (actionId: string) => Promise<void>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead>任务</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>下次尝试</TableHead>
          <TableHead>错误</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {actions.map((action) => (
          <TableRow key={action.id}>
            <TableCell className="min-w-52">
              <div className="font-medium text-slate-950">{action.actionType}</div>
              <div className="mt-1 max-w-56 truncate font-mono text-[11px] text-slate-500">
                {action.assetId}
              </div>
              <div className="text-[11px] text-slate-500">attempt {action.attempt}</div>
            </TableCell>
            <TableCell>
              <Status value={action.deadAt ? "dead" : action.status} />
            </TableCell>
            <TableCell>
              <div className="text-[12px] text-slate-600">{action.provider ?? "-"}</div>
              <div className="max-w-40 truncate text-[11px] text-slate-500">
                {action.placement?.cdnCacheKey ?? action.placement?.objectKey ?? "-"}
              </div>
            </TableCell>
            <TableCell>{action.nextAttemptAt ? formatDate(action.nextAttemptAt) : "-"}</TableCell>
            <TableCell className="max-w-64">
              <div className="truncate text-[12px] text-red-700">{action.errorMessage ?? "-"}</div>
            </TableCell>
            <TableCell className="text-right">
              {action.status === "failed" || action.deadAt ? (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={mutatingId === action.id}
                  onClick={() => void onRetry(action.id)}
                >
                  <IconRotateClockwise2 className="size-3" />
                  重试
                </Button>
              ) : (
                <span className="text-[12px] text-slate-400">-</span>
              )}
            </TableCell>
          </TableRow>
        ))}
        {actions.length === 0 ? <EmptyRow colSpan={6} text="暂无 CDN purge 任务" /> : null}
      </TableBody>
    </Table>
  );
}

function ProcessingJobTable({
  jobs,
  mutatingId,
  onRetry,
}: {
  jobs: AdminMediaProcessingJob[];
  mutatingId: string | null;
  onRetry: (jobId: string) => Promise<void>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead>任务</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>资产</TableHead>
          <TableHead>下次尝试</TableHead>
          <TableHead>错误</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell className="min-w-52">
              <div className="font-medium text-slate-950">{job.jobType}</div>
              <div className="mt-1 font-mono text-[11px] text-slate-500">attempt {job.attempt}</div>
            </TableCell>
            <TableCell>
              <Status value={job.status} />
            </TableCell>
            <TableCell className="max-w-56">
              <div className="truncate font-mono text-[11px] text-slate-500">{job.assetId}</div>
              {job.asset ? (
                <div className="text-[11px] text-slate-500">
                  {job.asset.kind} · {job.asset.source}
                </div>
              ) : null}
            </TableCell>
            <TableCell>{job.nextAttemptAt ? formatDate(job.nextAttemptAt) : "-"}</TableCell>
            <TableCell className="max-w-64">
              <div className="truncate text-[12px] text-red-700">{job.errorMessage ?? "-"}</div>
            </TableCell>
            <TableCell className="text-right">
              {job.status === "failed" || job.status === "dead" ? (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={mutatingId === job.id}
                  onClick={() => void onRetry(job.id)}
                >
                  <IconRotateClockwise2 className="size-3" />
                  重试
                </Button>
              ) : (
                <span className="text-[12px] text-slate-400">-</span>
              )}
            </TableCell>
          </TableRow>
        ))}
        {jobs.length === 0 ? <EmptyRow colSpan={6} text="暂无媒体处理任务" /> : null}
      </TableBody>
    </Table>
  );
}

function SectionHeading({
  icon,
  title,
  caption,
}: {
  icon: React.ReactNode;
  title: string;
  caption: string;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
      <span className="mt-0.5 text-slate-500">{icon}</span>
      <div>
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <p className="mt-0.5 text-[12px] text-slate-500">{caption}</p>
      </div>
    </div>
  );
}

function PlacementSummary({ asset }: { asset: AdminMediaAsset }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const placement of asset.placements) {
      map.set(placement.status, (map.get(placement.status) ?? 0) + 1);
    }
    return Array.from(map.entries());
  }, [asset.placements]);

  if (counts.length === 0) return <span className="text-slate-400">0</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {counts.map(([status, count]) => (
        <span
          key={status}
          className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600"
        >
          {status}:{count}
        </span>
      ))}
    </div>
  );
}

function Status({ value }: { value: string }) {
  const tone = statusTone(value);
  return <StatusPill tone={tone}>{value}</StatusPill>;
}

function statusTone(value: string): "success" | "risk" | "muted" {
  if (["ready", "active", "approved", "completed", "purged"].includes(value)) return "success";
  if (["failed", "blocked", "dead", "deleted"].includes(value)) return "risk";
  return "muted";
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-slate-500">
        {text}
      </TableCell>
    </TableRow>
  );
}
