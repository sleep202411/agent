"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  IconCircleCheck,
  IconCircleOff,
  IconCloud,
  IconExternalLink,
  IconEye,
  IconFlag,
  IconPhoto,
  IconPhotoOff,
  IconRefresh,
  IconRotateClockwise2,
  IconSettingsAutomation,
  IconVideo,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  type AdminMediaModerationStatus,
  type AdminMediaModerationAction,
  type AdminMediaProcessingJob,
  type AdminMediaView,
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
  view,
  siteLabel,
  databaseLabel,
  initialData,
}: {
  view: AdminMediaView;
  siteLabel: string;
  databaseLabel: string;
  initialData: AdminMediaInitialData;
}) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialData.error);
  const [selectedAsset, setSelectedAsset] = useState<AdminMediaAsset | null>(null);
  const [showPreviews, setShowPreviews] = useState(false);

  const assets = data.assets?.items ?? [];
  const actions = data.moderationActions?.items ?? [];
  const jobs = data.processingJobs?.items ?? [];
  const page = MEDIA_PAGES[view];

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchMediaView(view));
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

  async function updateAssetModeration(
    asset: AdminMediaAsset,
    moderationStatus: AdminMediaModerationStatus,
    reason: string | null
  ) {
    setMutatingId(`moderation:${asset.id}`);
    setError(null);
    try {
      const updated = await mutateEnvelope<AdminMediaAsset>(
        `/api/admin/media/assets/${asset.id}/moderation`,
        {
          moderationStatus,
          reason,
        },
        "PATCH"
      );
      setSelectedAsset(updated);
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
        title={page.title}
        description={page.description}
        icon={page.icon}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {view === "assets" ? (
              <PreviewToggle checked={showPreviews} onCheckedChange={setShowPreviews} />
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
              刷新
            </Button>
          </div>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      {view === "overview" ? (
        <div className="space-y-4">
          <OverviewMetrics data={data.overview} />
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-lg border border-slate-200 bg-white">
              <SectionHeading
                icon={<IconPhoto className="size-4" />}
                title="最近媒体资产"
                caption="最近入库的媒体对象，完整资产索引在二级菜单中查看。"
              />
              <AssetTable
                assets={assets}
                mutatingId={mutatingId}
                onBackfillOriginalPlacement={backfillOriginalPlacement}
                onSelectAsset={setSelectedAsset}
                showPreviews={false}
                compact
              />
            </section>
            <section className="rounded-lg border border-slate-200 bg-white">
              <SectionHeading
                icon={<IconSettingsAutomation className="size-4" />}
                title="最近处理任务"
                caption="缩略图、转码、metadata probe 与 backfill 的最近任务。"
              />
              <ProcessingJobTable
                jobs={jobs}
                mutatingId={mutatingId}
                onRetry={retryProcessingJob}
              />
            </section>
          </div>
        </div>
      ) : null}

      {view === "assets" ? (
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
            onSelectAsset={setSelectedAsset}
            showPreviews={showPreviews}
          />
        </section>
      ) : null}

      {view === "moderation" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <SectionHeading
            icon={<IconCloud className="size-4" />}
            title="CDN Purge 队列"
            caption="blocked/takedown 后的 CDN 清理任务，失败会进入可重试队列或 DLQ。"
          />
          <PurgeActionTable actions={actions} mutatingId={mutatingId} onRetry={retryPurge} />
        </section>
      ) : null}

      {view === "processing" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <SectionHeading
            icon={<IconSettingsAutomation className="size-4" />}
            title="媒体处理任务"
            caption="缩略图、转码、metadata probe 与历史 backfill 的统一处理队列。"
          />
          <ProcessingJobTable jobs={jobs} mutatingId={mutatingId} onRetry={retryProcessingJob} />
        </section>
      ) : null}

      <AssetDetailSheet
        asset={selectedAsset}
        moderating={selectedAsset ? mutatingId === `moderation:${selectedAsset.id}` : false}
        onClose={() => setSelectedAsset(null)}
        onModerationChange={updateAssetModeration}
      />
    </div>
  );
}

const MEDIA_PAGES: Record<AdminMediaView, { title: string; description: string; icon: ReactNode }> =
  {
    overview: {
      title: "媒体总览",
      description: "跨存储 provider 扫描媒体资产、违规下架、CDN purge 和处理队列健康度。",
      icon: <IconPhoto className="size-5" />,
    },
    assets: {
      title: "资产索引",
      description: "按资产维度查看图片、视频、音频、来源、对象位置、使用关系和治理状态。",
      icon: <IconPhoto className="size-5" />,
    },
    moderation: {
      title: "审核 / CDN",
      description: "查看下架后触发的 CDN purge 动作、失败原因和可重试任务。",
      icon: <IconCloud className="size-5" />,
    },
    processing: {
      title: "处理任务",
      description: "统一查看缩略图、转码、metadata probe 和历史 backfill 处理队列。",
      icon: <IconSettingsAutomation className="size-5" />,
    },
  };

async function fetchMediaView(view: AdminMediaView): Promise<AdminMediaInitialData> {
  if (view === "overview") {
    const [overview, assets, moderationActions, processingJobs] = await Promise.all([
      requestEnvelope<AdminMediaInitialData["overview"]>("/api/admin/media/overview"),
      requestEnvelope<NonNullable<AdminMediaInitialData["assets"]>>(
        "/api/admin/media/assets?limit=12"
      ),
      requestEnvelope<NonNullable<AdminMediaInitialData["moderationActions"]>>(
        "/api/admin/media/moderation-actions?actionType=purge_cdn&limit=12"
      ),
      requestEnvelope<NonNullable<AdminMediaInitialData["processingJobs"]>>(
        "/api/admin/media/processing-jobs?limit=12"
      ),
    ]);
    return { overview, assets, moderationActions, processingJobs, error: null };
  }
  if (view === "assets") {
    return {
      overview: null,
      assets: await requestEnvelope<NonNullable<AdminMediaInitialData["assets"]>>(
        "/api/admin/media/assets?limit=80"
      ),
      moderationActions: null,
      processingJobs: null,
      error: null,
    };
  }
  if (view === "moderation") {
    return {
      overview: null,
      assets: null,
      moderationActions: await requestEnvelope<
        NonNullable<AdminMediaInitialData["moderationActions"]>
      >("/api/admin/media/moderation-actions?actionType=purge_cdn&limit=80"),
      processingJobs: null,
      error: null,
    };
  }
  return {
    overview: null,
    assets: null,
    moderationActions: null,
    processingJobs: await requestEnvelope<NonNullable<AdminMediaInitialData["processingJobs"]>>(
      "/api/admin/media/processing-jobs?limit=80"
    ),
    error: null,
  };
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
  onSelectAsset,
  showPreviews,
  compact = false,
}: {
  assets: AdminMediaAsset[];
  mutatingId: string | null;
  onBackfillOriginalPlacement: (assetId: string) => Promise<void>;
  onSelectAsset: (asset: AdminMediaAsset) => void;
  showPreviews: boolean;
  compact?: boolean;
}) {
  const colSpan = showPreviews ? 9 : 8;
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          {showPreviews ? <TableHead className="w-20">预览</TableHead> : null}
          <TableHead>资产</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>对象</TableHead>
          <TableHead>Variants</TableHead>
          <TableHead>Placements</TableHead>
          {!compact ? <TableHead>最近使用</TableHead> : <TableHead>归属</TableHead>}
          <TableHead>创建时间</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assets.map((asset) => {
          const hasOriginal = asset.variants.some((variant) => variant.variantKey === "original");
          return (
            <TableRow
              key={asset.id}
              className="cursor-pointer"
              onClick={() => onSelectAsset(asset)}
            >
              {showPreviews ? (
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <AssetPreview asset={asset} mode="thumb" />
                </TableCell>
              ) : null}
              <TableCell className="min-w-56">
                <div className="font-medium text-slate-950">
                  {asset.kind} · {asset.source}
                </div>
                <div className="mt-1 max-w-64 truncate font-mono text-[11px] text-slate-500">
                  {asset.id}
                </div>
                {asset.createdByUserId && !compact ? (
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
                {compact ? (
                  <div className="text-[12px] text-slate-600">
                    {asset.createdByUserId ? `user:${asset.createdByUserId}` : "-"}
                  </div>
                ) : asset.usages[0] ? (
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
              <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                {!hasOriginal ? (
                  <div className="flex justify-end gap-1.5">
                    <Button variant="outline" size="xs" onClick={() => onSelectAsset(asset)}>
                      <IconEye className="size-3" />
                      查看
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={mutatingId === asset.id}
                      onClick={() => void onBackfillOriginalPlacement(asset.id)}
                    >
                      <IconRotateClockwise2 className="size-3" />
                      补齐 original
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="xs" onClick={() => onSelectAsset(asset)}>
                    <IconEye className="size-3" />
                    查看
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
        {assets.length === 0 ? <EmptyRow colSpan={colSpan} text="暂无媒体资产" /> : null}
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

function PreviewToggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="inline-flex h-7 items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-label="显示预览图"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative h-5 w-9 rounded-full border transition-colors outline-none focus-visible:ring-3 focus-visible:ring-slate-300/60",
          checked
            ? "border-slate-900 bg-slate-900"
            : "border-slate-300 bg-slate-200 hover:bg-slate-300"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform",
            checked && "translate-x-4"
          )}
        />
      </button>
      <span className="text-[12px] font-medium text-slate-600">显示预览图</span>
    </div>
  );
}

function AssetDetailSheet({
  asset,
  moderating,
  onClose,
  onModerationChange,
}: {
  asset: AdminMediaAsset | null;
  moderating: boolean;
  onClose: () => void;
  onModerationChange: (
    asset: AdminMediaAsset,
    moderationStatus: AdminMediaModerationStatus,
    reason: string | null
  ) => Promise<void>;
}) {
  const previewUrl = asset ? mediaPreviewUrl(asset) : null;
  const moderationCases = asset?.moderationCases ?? [];
  const moderationActions = asset?.moderationActions ?? [];
  const processingJobs = asset?.processingJobs ?? [];

  return (
    <Sheet open={!!asset} onOpenChange={(open) => (!open ? onClose() : null)}>
      <SheetContent side="right" className="!w-full gap-0 p-0 sm:!max-w-3xl">
        {asset ? (
          <>
            <SheetHeader className="border-b border-slate-200 px-5 py-4">
              <SheetTitle>媒体资产详情</SheetTitle>
              <SheetDescription className="font-mono text-[12px] text-slate-500">
                {asset.id}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="space-y-5">
                <div className="space-y-3">
                  <AssetPreview asset={asset} mode="large" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[12px] text-slate-500">
                      {previewUrl ? "使用 admin 受控签名地址预览" : "当前资产没有可预览地址"}
                    </div>
                    {previewUrl ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={previewUrl} target="_blank" rel="noreferrer">
                          <IconExternalLink className="size-3.5" />
                          打开受控预览
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>
                <ModerationForm
                  key={asset.id}
                  asset={asset}
                  moderating={moderating}
                  onModerationChange={onModerationChange}
                />
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="grid gap-x-4 gap-y-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                    <DetailRow label="类型" value={`${asset.kind} · ${asset.source}`} />
                    <DetailRow label="状态" value={`${asset.status} / ${asset.moderationStatus}`} />
                    <DetailRow label="存储" value={asset.storageProvider} />
                    <DetailRow label="内容类型" value={asset.contentType} />
                    <DetailRow label="尺寸" value={formatDimensions(asset)} />
                    <DetailRow label="大小" value={formatBytes(asset.sizeBytes)} />
                    <DetailRow label="用户" value={asset.createdByUserId ?? "-"} />
                    <DetailRow label="Workspace" value={asset.workspaceId ?? "-"} />
                    <DetailRow label="创建时间" value={formatDate(asset.createdAt)} />
                    <DetailRow label="更新时间" value={formatDate(asset.updatedAt)} />
                  </div>
                  {asset.moderationReason ? (
                    <div className="border-t border-slate-200 px-4 py-3">
                      <p className="text-[11px] font-medium text-slate-500">审核原因</p>
                      <p className="mt-1 text-sm text-slate-800">{asset.moderationReason}</p>
                    </div>
                  ) : null}
                  <div className="border-t border-slate-200 px-4 py-3">
                    <p className="text-[11px] font-medium text-slate-500">对象 Key / URL</p>
                    <p className="mt-1 break-all font-mono text-[12px] text-slate-700">
                      {asset.objectKey ?? asset.externalUrl ?? "-"}
                    </p>
                  </div>
                </div>
              </div>

              <DetailSection title="Placements" count={asset.placements.length}>
                <PlacementDetailTable assetId={asset.id} placements={asset.placements} />
              </DetailSection>

              <DetailSection title="Variants" count={asset.variants.length}>
                <VariantDetailList asset={asset} />
              </DetailSection>

              <DetailSection title="使用来源" count={asset.usages.length}>
                <UsageDetailTable usages={asset.usages} />
              </DetailSection>

              <DetailSection title="审核 Case" count={moderationCases.length}>
                <CaseDetailTable cases={moderationCases} />
              </DetailSection>

              <DetailSection title="治理动作" count={moderationActions.length}>
                <InlineActionTable actions={moderationActions} />
              </DetailSection>

              <DetailSection title="处理任务" count={processingJobs.length}>
                <InlineProcessingTable jobs={processingJobs} />
              </DetailSection>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ModerationForm({
  asset,
  moderating,
  onModerationChange,
}: {
  asset: AdminMediaAsset;
  moderating: boolean;
  onModerationChange: (
    asset: AdminMediaAsset,
    moderationStatus: AdminMediaModerationStatus,
    reason: string | null
  ) => Promise<void>;
}) {
  const [moderationReason, setModerationReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  async function submitModeration(status: AdminMediaModerationStatus) {
    const reason = moderationReason.trim();
    if ((status === "flagged" || status === "blocked") && !reason) {
      setReasonError("标记复核或全平台下架必须填写处理原因。");
      return;
    }
    setReasonError(null);
    await onModerationChange(asset, status, reason || null);
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">风险治理</h3>
          <p className="mt-1 text-[12px] text-slate-500">
            默认可用且不需要人工审核；发现问题时可标记复核或全平台下架。 恢复默认状态会让 purging
            placement 回到 active。
          </p>
        </div>
        <Status value={asset.moderationStatus} />
      </div>
      <Textarea
        value={moderationReason}
        onChange={(event) => {
          setModerationReason(event.currentTarget.value);
          if (reasonError) setReasonError(null);
        }}
        rows={3}
        className="mt-3 resize-none rounded-lg text-sm"
        placeholder="处理原因。标记复核或全平台下架必填，会进入审计、case 和治理动作。"
      />
      {reasonError ? (
        <p className="mt-2 text-[12px] font-medium text-red-700">{reasonError}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={moderating || asset.moderationStatus === "approved"}
          onClick={() => void submitModeration("approved")}
        >
          <IconCircleCheck className="size-3.5" />
          确认安全
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={moderating || asset.moderationStatus === "flagged"}
          onClick={() => void submitModeration("flagged")}
        >
          <IconFlag className="size-3.5" />
          标记复核
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={moderating || asset.moderationStatus === "blocked"}
          onClick={() => void submitModeration("blocked")}
        >
          <IconCircleOff className="size-3.5" />
          全平台下架
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={moderating || asset.moderationStatus === "unreviewed"}
          onClick={() => void submitModeration("unreviewed")}
        >
          <IconRotateClockwise2 className="size-3.5" />
          恢复默认状态
        </Button>
      </div>
    </div>
  );
}

function AssetPreview({ asset, mode }: { asset: AdminMediaAsset; mode: "large" | "thumb" }) {
  const url = mediaPreviewUrl(asset);
  const type = mediaPreviewType(asset);
  const boxClass = mode === "large" ? "h-72 w-full rounded-lg sm:h-80" : "size-14 rounded-md";
  const mediaClass = mode === "large" ? "size-full object-contain" : "size-full object-cover";
  if (!url || !type) {
    const PlaceholderIcon = asset.kind === "video" ? IconVideo : IconPhotoOff;
    return (
      <div
        className={cn(
          "grid place-items-center border border-slate-200 bg-slate-50 text-slate-400",
          boxClass
        )}
      >
        <PlaceholderIcon className={mode === "large" ? "size-8" : "size-4"} />
      </div>
    );
  }
  if (type === "video") {
    return (
      <div className={cn("overflow-hidden border border-slate-200 bg-slate-950", boxClass)}>
        <video
          src={url}
          muted={mode === "thumb"}
          controls={mode === "large"}
          playsInline
          preload="metadata"
          className={mediaClass}
        />
      </div>
    );
  }
  return (
    <div className={cn("overflow-hidden border border-slate-200 bg-slate-50", boxClass)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" loading="lazy" className={mediaClass} />
    </div>
  );
}

type AssetPlacement = AdminMediaAsset["placements"][number];
type AssetUsage = AdminMediaAsset["usages"][number];
type AssetCase = AdminMediaAsset["moderationCases"][number];
type AssetAction = AdminMediaAsset["moderationActions"][number];
type AssetProcessingJob = AdminMediaAsset["processingJobs"][number];

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <div className="mt-1 break-words text-sm text-slate-900">{value || "-"}</div>
    </div>
  );
}

function DetailSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="mt-5 rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

function PlacementDetailTable({
  assetId,
  placements,
}: {
  assetId: string;
  placements: AssetPlacement[];
}) {
  if (placements.length === 0) return <EmptyBlock text="暂无 placement" />;
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead>角色</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>对象</TableHead>
          <TableHead>更新时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {placements.map((placement) => {
          const url = placementAdminContentUrl(assetId, placement.id, placement.status);
          return (
            <TableRow key={placement.id}>
              <TableCell>
                <div className="font-medium text-slate-950">{placement.role}</div>
                <div className="text-[11px] text-slate-500">priority {placement.priority}</div>
              </TableCell>
              <TableCell>
                <Status value={placement.status} />
              </TableCell>
              <TableCell>
                <div className="text-[12px] text-slate-700">{placement.storageProvider}</div>
                <div className="text-[11px] text-slate-500">{placement.cdnProvider ?? "-"}</div>
              </TableCell>
              <TableCell className="max-w-72">
                <div className="truncate font-mono text-[11px] text-slate-600">
                  {placement.objectKey ?? placement.externalUrl ?? "-"}
                </div>
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-900 hover:underline"
                  >
                    打开 <IconExternalLink className="size-3" />
                  </a>
                ) : null}
              </TableCell>
              <TableCell>{formatDate(placement.updatedAt)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function VariantDetailList({ asset }: { asset: AdminMediaAsset }) {
  if (asset.variants.length === 0) return <EmptyBlock text="暂无 variant" />;
  return (
    <div className="divide-y divide-slate-200">
      {asset.variants.map((variant) => (
        <div key={variant.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_1.5fr]">
          <div className="min-w-0">
            <div className="font-medium text-slate-950">{variant.variantKey}</div>
            <div className="mt-1 text-[12px] text-slate-500">
              {variant.kind} · {variant.contentType}
            </div>
            <div className="mt-2">
              <Status value={variant.status} />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500">Placements</p>
            {variant.placements.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {variant.placements.map((placement) => (
                  <span
                    key={placement.id}
                    className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600"
                  >
                    {placement.role}:{placement.status}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[12px] text-slate-400">暂无 placement</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function UsageDetailTable({ usages }: { usages: AssetUsage[] }) {
  if (usages.length === 0) return <EmptyBlock text="暂无使用来源" />;
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead>来源</TableHead>
          <TableHead>角色</TableHead>
          <TableHead>归属</TableHead>
          <TableHead>AI Job</TableHead>
          <TableHead>最后观察</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {usages.map((usage) => (
          <TableRow key={usage.id}>
            <TableCell>
              <div className="font-medium text-slate-950">{usage.surface}</div>
              <div className="text-[11px] text-slate-500">{usage.sourceSurface ?? "-"}</div>
            </TableCell>
            <TableCell>{usage.role}</TableCell>
            <TableCell>
              <div className="text-[12px] text-slate-700">
                {usage.userId ? `user:${usage.userId}` : "-"}
              </div>
              <div className="text-[11px] text-slate-500">
                {usage.projectId ?? usage.workspaceId ?? "-"}
              </div>
            </TableCell>
            <TableCell className="max-w-44 truncate font-mono text-[11px] text-slate-500">
              {usage.aiJobId ?? "-"}
            </TableCell>
            <TableCell>{formatDate(usage.lastObservedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CaseDetailTable({ cases }: { cases: AssetCase[] }) {
  if (cases.length === 0) return <EmptyBlock text="暂无审核 case" />;
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead>Case</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>严重度</TableHead>
          <TableHead>原因</TableHead>
          <TableHead>时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cases.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="max-w-44 truncate font-mono text-[11px] text-slate-500">
              {item.id}
            </TableCell>
            <TableCell>
              <Status value={item.status} />
            </TableCell>
            <TableCell>{item.severity}</TableCell>
            <TableCell className="max-w-64">
              <div className="text-[12px] text-slate-700">{item.reasonCode}</div>
              <div className="truncate text-[11px] text-slate-500">{item.reason ?? "-"}</div>
            </TableCell>
            <TableCell>
              <div className="text-[12px] text-slate-700">{formatDate(item.openedAt)}</div>
              <div className="text-[11px] text-slate-500">
                {item.resolvedAt ? formatDate(item.resolvedAt) : "未解决"}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function InlineActionTable({ actions }: { actions: AssetAction[] }) {
  if (actions.length === 0) return <EmptyBlock text="暂无治理动作" />;
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead>动作</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>错误</TableHead>
          <TableHead>创建时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {actions.map((action) => (
          <TableRow key={action.id}>
            <TableCell>
              <div className="font-medium text-slate-950">{action.actionType}</div>
              <div className="text-[11px] text-slate-500">attempt {action.attempt}</div>
            </TableCell>
            <TableCell>
              <Status value={action.deadAt ? "dead" : action.status} />
            </TableCell>
            <TableCell>{action.provider ?? "-"}</TableCell>
            <TableCell className="max-w-64 truncate text-[12px] text-red-700">
              {action.errorMessage ?? "-"}
            </TableCell>
            <TableCell>{formatDate(action.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function InlineProcessingTable({ jobs }: { jobs: AssetProcessingJob[] }) {
  if (jobs.length === 0) return <EmptyBlock text="暂无处理任务" />;
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead>任务</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>错误</TableHead>
          <TableHead>创建时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell>
              <div className="font-medium text-slate-950">{job.jobType}</div>
              <div className="text-[11px] text-slate-500">attempt {job.attempt}</div>
            </TableCell>
            <TableCell>
              <Status value={job.deadAt ? "dead" : job.status} />
            </TableCell>
            <TableCell className="max-w-64 truncate text-[12px] text-red-700">
              {job.errorMessage ?? "-"}
            </TableCell>
            <TableCell>{formatDate(job.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-sm text-slate-500">{text}</div>;
}

function mediaPreviewUrl(asset: AdminMediaAsset) {
  return mediaPreviewSource(asset)?.url ?? null;
}

function mediaPreviewType(asset: AdminMediaAsset) {
  return mediaPreviewSource(asset)?.type ?? null;
}

function mediaPreviewSource(
  asset: AdminMediaAsset
): { url: string; type: "image" | "video" } | null {
  const assetType = previewTypeFrom(asset.kind, asset.contentType);
  if (asset.status === "ready" && assetType) {
    return { url: adminAssetContentUrl(asset.id), type: assetType };
  }
  return null;
}

function adminAssetContentUrl(assetId: string) {
  return `/api/admin/media/assets/${encodeURIComponent(assetId)}/content?variantKey=original`;
}

function placementAdminContentUrl(assetId: string, placementId: string, status: string) {
  if (!["active", "purging", "purged"].includes(status)) return null;
  const params = new URLSearchParams({
    placementId,
    variantKey: "original",
  });
  return `/api/admin/media/assets/${encodeURIComponent(assetId)}/content?${params.toString()}`;
}

function previewTypeFrom(
  kind: string | null,
  contentType: string | null
): "image" | "video" | null {
  if (contentType?.startsWith("image/")) return "image";
  if (contentType?.startsWith("video/")) return "video";
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  return null;
}

function formatDimensions(asset: AdminMediaAsset) {
  const dimensions = asset.width && asset.height ? `${asset.width} x ${asset.height}` : "-";
  if (!asset.durationSeconds) return dimensions;
  return `${dimensions} · ${Math.round(asset.durationSeconds)}s`;
}

function formatBytes(value: string | null) {
  if (!value) return "-";
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return `${value} B`;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function SectionHeading({
  icon,
  title,
  caption,
}: {
  icon: ReactNode;
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
  return <StatusPill tone={tone}>{statusLabel(value)}</StatusPill>;
}

function statusTone(value: string): "success" | "risk" | "muted" {
  if (["ready", "active", "approved", "completed", "purged"].includes(value)) return "success";
  if (["failed", "blocked", "dead", "deleted"].includes(value)) return "risk";
  return "muted";
}

function statusLabel(value: string) {
  switch (value) {
    case "unreviewed":
      return "默认可用 / 未复核";
    case "approved":
      return "确认安全";
    case "flagged":
      return "标记复核";
    case "blocked":
      return "全平台下架";
    default:
      return value;
  }
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
