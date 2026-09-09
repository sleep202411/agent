"use client";

import { type ChangeEvent, useEffect, useId, useMemo, useState } from "react";
import {
  IconEdit,
  IconInfoCircle,
  IconLanguage,
  IconLayoutCards,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconUpload,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  formatDate,
  Metric,
  PageHeader,
  requestEnvelope,
  StatusPill,
  toErrorMessage,
} from "./shared";
import type { AdminIpDiscoveryData, AdminIpsData, IpDiscoveryRecommendationRow } from "./types";

type PlacementKey = "ip_plaza_hero" | "ip_plaza_for_you" | "ip_plaza_list_pinned";
type RecommendationStatus = "enabled" | "draft" | "paused" | "archived";
type EffectiveRecommendationStatus =
  | "active"
  | "pending"
  | "ended"
  | "draft"
  | "paused"
  | "archived";
type LocaleCode = "en-US" | "zh-CN" | "zh-HK";

type LocaleCopy = {
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
};

type IpOption = {
  id: string;
  roomNumber: string;
  title: string;
  status: string;
};

type RecommendationItem = {
  id: string;
  placementKey: PlacementKey;
  ipId: string;
  ipTitle: string;
  ipRoomNumber: string;
  sortOrder: number;
  status: RecommendationStatus;
  startsAt: string;
  endsAt: string;
  desktopMediaUrl: string;
  mobileMediaUrl: string;
  trailerUrl: string;
  imageAssetId: string | null;
  mobileImageAssetId: string | null;
  trailerAssetId: string | null;
  updatedBy: string;
  updatedAt: string;
  locale: Record<LocaleCode, LocaleCopy>;
};

type RecommendationDraft = Omit<RecommendationItem, "id" | "updatedAt" | "updatedBy">;

const LOCALES: Array<{ code: LocaleCode; label: string }> = [
  { code: "en-US", label: "English" },
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-HK", label: "繁體中文" },
];

const EMPTY_COPY: LocaleCopy = {
  eyebrow: "",
  title: "",
  description: "",
  ctaLabel: "",
};

function emptyLocaleCopy(): Record<LocaleCode, LocaleCopy> {
  return {
    "en-US": { ...EMPTY_COPY },
    "zh-CN": { ...EMPTY_COPY },
    "zh-HK": { ...EMPTY_COPY },
  };
}

const EMPTY_DRAFT: RecommendationDraft = {
  placementKey: "ip_plaza_hero",
  ipId: "",
  ipTitle: "",
  ipRoomNumber: "",
  sortOrder: 1,
  status: "draft",
  startsAt: "",
  endsAt: "",
  desktopMediaUrl: "",
  mobileMediaUrl: "",
  trailerUrl: "",
  imageAssetId: null,
  mobileImageAssetId: null,
  trailerAssetId: null,
  locale: emptyLocaleCopy(),
};

export function IpDiscoveryPanel({
  siteLabel,
  databaseLabel,
  initialData,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialData: AdminIpDiscoveryData | null;
  initialError: string | null;
}) {
  const [items, setItems] = useState<RecommendationItem[]>(() =>
    (initialData?.items ?? []).map(rowToItem)
  );
  const [query, setQuery] = useState("");
  const [placementFilter, setPlacementFilter] = useState<"all" | PlacementKey>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [localeTab, setLocaleTab] = useState<LocaleCode>("en-US");
  const [draft, setDraft] = useState<RecommendationDraft>(EMPTY_DRAFT);
  const [statusNow, setStatusNow] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  useEffect(() => {
    const timer = window.setInterval(() => setStatusNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const metrics = useMemo(() => getMetrics(items, statusNow), [items, statusNow]);
  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .filter((item) => placementFilter === "all" || item.placementKey === placementFilter)
      .filter((item) =>
        needle
          ? `${item.ipTitle} ${item.ipRoomNumber} ${item.ipId} ${placementLabel(item.placementKey)}`
              .toLowerCase()
              .includes(needle)
          : true
      )
      .sort((left, right) =>
        left.placementKey === right.placementKey
          ? left.sortOrder - right.sortOrder
          : left.placementKey.localeCompare(right.placementKey)
      );
  }, [items, placementFilter, query]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await requestEnvelope<AdminIpDiscoveryData>("/api/admin/ip-commerce/discovery");
      setItems(data.items.map(rowToItem));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function openCreateDrawer() {
    setDrawerMode("create");
    setEditingId(null);
    const placementKey = placementFilter === "all" ? "ip_plaza_hero" : placementFilter;
    setDraft(
      normalizeDraftForPlacement({
        ...EMPTY_DRAFT,
        placementKey,
        sortOrder: nextSortOrder(items, placementKey),
        locale: emptyLocaleCopy(),
      })
    );
    setLocaleTab("en-US");
    setDrawerOpen(true);
  }

  function openEditDrawer(item: RecommendationItem) {
    setDrawerMode("edit");
    setEditingId(item.id);
    setDraft(toDraft(item));
    setLocaleTab("en-US");
    setDrawerOpen(true);
  }

  async function saveDraft() {
    const normalized = normalizeDraftForPlacement(draft);
    setSaving(true);
    setError(null);
    try {
      const payload = draftToPayload(normalized);
      if (drawerMode === "create") {
        await requestEnvelope("/api/admin/ip-commerce/discovery", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            placementKey: normalized.placementKey,
            ipId: normalized.ipId,
            ...payload,
          }),
        });
      } else if (editingId) {
        await requestEnvelope(`/api/admin/ip-commerce/discovery/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setDrawerOpen(false);
      await refresh();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="IP 广场运营位"
        description="配置 IP Plaza Hero、For You 和列表置顶。Hero 支持运营素材和文案，轻量推荐位使用 IP 原生卡片数据。"
        icon={<IconLayoutCards className="size-4" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="刷新"
            >
              <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
            <Button size="sm" type="button" onClick={openCreateDrawer}>
              <IconPlus className="size-3.5" />
              新增推荐
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="推荐条目" value={metrics.total} helper="Hero / For You / 置顶" />
        <Metric label="生效中" value={metrics.active} helper="当前可展示" />
        <Metric label="待生效" value={metrics.pending} helper="未来上线" />
        <Metric
          label="待补字段"
          value={metrics.incomplete}
          tone={metrics.incomplete ? "warn" : "default"}
          helper="Hero 文案或素材不完整"
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">推荐位列表</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">运营排序、上下线状态、Hero 完整度</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={placementFilter}
              onValueChange={(value) => setPlacementFilter(value as "all" | PlacementKey)}
            >
              <SelectTrigger size="sm" className="w-[148px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部位置</SelectItem>
                <SelectItem value="ip_plaza_hero">Hero</SelectItem>
                <SelectItem value="ip_plaza_for_you">For You</SelectItem>
                <SelectItem value="ip_plaza_list_pinned">列表置顶</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative w-60">
              <IconSearch className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索 IP / ID"
                className="h-8 pl-8 text-[12px]"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <TableHead>位置</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>排序</TableHead>
                <TableHead>文案</TableHead>
                <TableHead>生效窗口</TableHead>
                <TableHead>素材</TableHead>
                <TableHead>更新</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const displayStatus = effectiveStatus(item, statusNow);

                return (
                  <tr key={item.id} className="group hover:bg-slate-50/60">
                    <TableCell>
                      <p className="font-medium text-slate-950">
                        {placementLabel(item.placementKey)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[220px] truncate font-medium text-slate-950">
                        {item.ipTitle}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        Room {item.ipRoomNumber}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={statusTone(displayStatus)}>
                        {statusLabel(displayStatus)}
                      </StatusPill>
                    </TableCell>
                    <TableCell>#{item.sortOrder}</TableCell>
                    <TableCell>
                      <CopyCompleteness item={item} />
                    </TableCell>
                    <TableCell>
                      <p className="text-[12px] text-slate-700">{formatDate(item.startsAt)}</p>
                      <p className="text-[11px] text-slate-500">至 {formatDate(item.endsAt)}</p>
                    </TableCell>
                    <TableCell>
                      <AssetCompleteness item={item} />
                    </TableCell>
                    <TableCell>
                      <p className="text-[12px] text-slate-700">{item.updatedBy}</p>
                      <p className="text-[11px] text-slate-500">{formatDate(item.updatedAt)}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => openEditDrawer(item)}
                      >
                        <IconEdit className="size-3.5" />
                        编辑
                      </Button>
                    </TableCell>
                  </tr>
                );
              })}
              {!filteredItems.length ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-500">
                    暂无匹配推荐位
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <RecommendationDrawer
        open={drawerOpen}
        mode={drawerMode}
        draft={draft}
        localeTab={localeTab}
        saving={saving}
        onOpenChange={setDrawerOpen}
        onLocaleTabChange={setLocaleTab}
        onDraftChange={setDraft}
        onSave={saveDraft}
      />
    </div>
  );
}

function RecommendationDrawer({
  open,
  mode,
  draft,
  localeTab,
  saving,
  onOpenChange,
  onLocaleTabChange,
  onDraftChange,
  onSave,
}: {
  open: boolean;
  mode: "create" | "edit";
  draft: RecommendationDraft;
  localeTab: LocaleCode;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onLocaleTabChange: (locale: LocaleCode) => void;
  onDraftChange: (draft: RecommendationDraft) => void;
  onSave: () => void;
}) {
  const copy = draft.locale[localeTab];
  const heroPlacement = isHeroPlacement(draft.placementKey);

  function patchDraft(patch: Partial<RecommendationDraft>) {
    onDraftChange(normalizeDraftForPlacement({ ...draft, ...patch }));
  }

  function patchCopy(patch: Partial<LocaleCopy>) {
    onDraftChange({
      ...draft,
      locale: {
        ...draft.locale,
        [localeTab]: { ...copy, ...patch },
      },
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // Don't auto-focus into the form on open — the first focusable element is
        // the 位置 field's info button, and a focused Tooltip trigger pops its
        // tooltip immediately. Keep focus on the opener; Tab/hover still work.
        onOpenAutoFocus={(event) => event.preventDefault()}
        // The base-ui IP combobox popup is portaled to <body>, outside this
        // modal layer, so clicking an option reads as an "outside" interaction
        // and would dismiss the Sheet. Keep it open for combobox interactions.
        onInteractOutside={(event) => {
          const target = event.detail.originalEvent.target as Element | null;
          if (target?.closest?.('[data-slot="combobox-content"]')) {
            event.preventDefault();
          }
        }}
        className="!w-[min(520px,calc(100vw-24px))] !max-w-[min(520px,calc(100vw-24px))] sm:!max-w-[min(520px,calc(100vw-24px))]"
      >
        <SheetHeader className="border-b border-slate-200">
          <SheetTitle>{mode === "create" ? "新增推荐位" : "编辑推荐位"}</SheetTitle>
        </SheetHeader>

        <TooltipProvider>
          <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
            <FormSection title="基础信息">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="位置"
                  tooltip="推荐位类型:Hero 大图轮播 / For You 推荐 / 列表置顶。决定渲染方式,只有 Hero 需要自定义素材与文案。"
                >
                  {(id) => (
                    <Select
                      value={draft.placementKey}
                      onValueChange={(value) => patchDraft({ placementKey: value as PlacementKey })}
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ip_plaza_hero">IP Plaza Hero</SelectItem>
                        <SelectItem value="ip_plaza_for_you">For You 推荐</SelectItem>
                        <SelectItem value="ip_plaza_list_pinned">列表置顶</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Field label="状态" tooltip="草稿不展示;启用后按排期自动生效;暂停为临时下线。">
                  {(id) => (
                    <>
                      <Select
                        value={draft.status}
                        onValueChange={(value) =>
                          patchDraft({ status: value as RecommendationStatus })
                        }
                      >
                        <SelectTrigger id={id} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">草稿</SelectItem>
                          <SelectItem value="enabled">启用</SelectItem>
                          <SelectItem value="paused">已暂停</SelectItem>
                          <SelectItem value="archived">已归档</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-slate-500">
                        启用后按排期自动显示待生效、生效中或已结束。
                      </p>
                    </>
                  )}
                </Field>
                <Field
                  label="IP"
                  className="sm:col-span-2"
                  tooltip="绑定的 IP。公开端点击跳转到该 IP;For You 与置顶复用 IP 原生卡片(标题/封面/简介)。"
                >
                  <IpCombobox
                    ipId={draft.ipId}
                    ipTitle={draft.ipTitle}
                    ipRoomNumber={draft.ipRoomNumber}
                    onChange={(option) =>
                      patchDraft({
                        ipId: option.id,
                        ipTitle: option.title,
                        ipRoomNumber: option.roomNumber,
                      })
                    }
                  />
                </Field>
                <Field label="排序" tooltip="同一位置内的展示顺序,数字越小越靠前。">
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      value={draft.sortOrder}
                      onChange={(event) =>
                        patchDraft({ sortOrder: Number(event.target.value) || 1 })
                      }
                    />
                  )}
                </Field>
              </div>
            </FormSection>

            <FormSection title="排期">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="开始时间" tooltip="排期开始时间,留空表示立即生效。">
                  {(id) => (
                    <Input
                      id={id}
                      type="datetime-local"
                      value={draft.startsAt}
                      onChange={(event) => patchDraft({ startsAt: event.target.value })}
                    />
                  )}
                </Field>
                <Field label="结束时间" tooltip="排期结束时间,留空表示长期有效。">
                  {(id) => (
                    <Input
                      id={id}
                      type="datetime-local"
                      value={draft.endsAt}
                      onChange={(event) => patchDraft({ endsAt: event.target.value })}
                    />
                  )}
                </Field>
              </div>
            </FormSection>

            {heroPlacement ? (
              <>
                <FormSection title="运营素材">
                  <div className="grid gap-3">
                    <AssetUploadField
                      label="桌面图 / 默认封面"
                      tooltip="桌面端 Hero 背景图,也作为缺少移动图时的回退。需为已就绪(ready)的图片素材。"
                      value={draft.desktopMediaUrl}
                      accept="image/*"
                      assetType="image"
                      onChange={(next) =>
                        patchDraft({ desktopMediaUrl: next.url, imageAssetId: next.assetId })
                      }
                    />
                    <AssetUploadField
                      label="移动图"
                      tooltip="移动端 Hero 背景图(竖屏适配)。缺省时回退到桌面图。需为已就绪(ready)的图片素材。"
                      value={draft.mobileMediaUrl}
                      accept="image/*"
                      assetType="image"
                      onChange={(next) =>
                        patchDraft({
                          mobileMediaUrl: next.url,
                          mobileImageAssetId: next.assetId,
                        })
                      }
                    />
                    <AssetUploadField
                      label="Trailer 视频"
                      tooltip="Hero 预告视频,鼠标悬停或点击播放。需为已就绪(ready)的视频素材。"
                      value={draft.trailerUrl}
                      accept="video/*"
                      assetType="video"
                      onChange={(next) =>
                        patchDraft({ trailerUrl: next.url, trailerAssetId: next.assetId })
                      }
                    />
                  </div>
                </FormSection>

                <FormSection
                  title="多语言文案"
                  aside={
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                      {LOCALES.map((locale) => (
                        <button
                          key={locale.code}
                          type="button"
                          onClick={() => onLocaleTabChange(locale.code)}
                          className={cn(
                            "rounded-md px-2 py-1 text-[12px] font-medium transition",
                            localeTab === locale.code
                              ? "bg-white text-slate-950 shadow-sm"
                              : "text-slate-500 hover:text-slate-900"
                          )}
                        >
                          {locale.label}
                        </button>
                      ))}
                    </div>
                  }
                >
                  <div className="grid gap-3">
                    <Field label="Eyebrow" tooltip="标题上方的小字提示(kicker),可选。">
                      {(id) => (
                        <Input
                          id={id}
                          value={copy.eyebrow}
                          onChange={(event) => patchCopy({ eyebrow: event.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="标题" tooltip="Hero 主标题,覆盖 IP 原生标题。Hero 建议必填。">
                      {(id) => (
                        <Input
                          id={id}
                          value={copy.title}
                          onChange={(event) => patchCopy({ title: event.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="CTA Label" tooltip="行动按钮文案,如「立即观看」。留空使用默认。">
                      {(id) => (
                        <Input
                          id={id}
                          value={copy.ctaLabel}
                          onChange={(event) => patchCopy({ ctaLabel: event.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="描述" tooltip="副标题/简介,展示在标题下方。">
                      {(id) => (
                        <Textarea
                          id={id}
                          value={copy.description}
                          onChange={(event) => patchCopy({ description: event.target.value })}
                          className="min-h-24 resize-none"
                        />
                      )}
                    </Field>
                  </div>
                </FormSection>
              </>
            ) : (
              <NativeIpCardNotice placementKey={draft.placementKey} />
            )}
          </div>
        </TooltipProvider>

        <SheetFooter className="border-t border-slate-200">
          <Button
            variant="outline"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button type="button" onClick={onSave} disabled={saving || !draft.ipId}>
            {saving ? "保存中" : "保存"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AssetUploadField({
  label,
  tooltip,
  value,
  accept,
  assetType,
  onChange,
}: {
  label: string;
  tooltip?: string;
  value: string;
  accept: string;
  assetType: "image" | "video";
  onChange: (next: { assetId: string | null; url: string }) => void;
}) {
  const inputId = useId();
  const Icon = assetType === "video" ? IconVideo : IconPhoto;
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const previewUrl = localPreviewUrl ?? adminRenderableMediaUrl(value);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const preview = URL.createObjectURL(file);
    setLocalPreviewUrl(preview);
    setUploading(true);
    setUploadError(null);
    try {
      const kind = assetType === "video" ? "video" : "image";
      const form = new FormData();
      form.append("file", file);
      const data = await requestEnvelope<{
        asset: { id: string; url: string | null } | null;
      }>(`/api/admin/ip-commerce/discovery/media?kind=${kind}`, {
        method: "POST",
        body: form,
      });
      if (!data.asset) throw new Error("上传失败");
      onChange({
        assetId: data.asset.id,
        url: adminMediaContentUrl(data.asset.id) ?? data.asset.url ?? "",
      });
    } catch (err) {
      setUploadError(toErrorMessage(err));
      setLocalPreviewUrl(null);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Field label={label} tooltip={tooltip}>
      <div className="w-full overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50">
        <div className="relative flex h-32 w-full items-center justify-center overflow-hidden bg-slate-100">
          {previewUrl && assetType === "image" ? (
            <img src={previewUrl} alt="" className="size-full object-cover" />
          ) : previewUrl && assetType === "video" ? (
            <video src={previewUrl} controls className="size-full bg-slate-950 object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-slate-500">
              <span className="grid size-10 place-items-center rounded-lg border border-slate-200 bg-white">
                <Icon className="size-5" />
              </span>
              <span className="text-[12px] font-medium">
                {value ? "已绑定素材" : assetType === "video" ? "未上传视频" : "未上传图片"}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2">
          <p
            className={cn(
              "min-w-0 truncate text-[11px]",
              uploadError ? "text-red-600" : "font-mono text-slate-500"
            )}
          >
            {uploadError ?? (uploading ? "上传中…" : value || "上传后生成媒体地址")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {value && !uploading ? (
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => {
                  setLocalPreviewUrl(null);
                  setUploadError(null);
                  onChange({ assetId: null, url: "" });
                }}
              >
                <IconX className="size-3.5" />
                清除
              </Button>
            ) : null}
            <Button
              asChild={!uploading}
              variant="outline"
              size="sm"
              className="cursor-pointer"
              disabled={uploading}
            >
              {uploading ? (
                <span>
                  <IconUpload className="size-3.5" />
                  上传中
                </span>
              ) : (
                <label htmlFor={inputId}>
                  <IconUpload className="size-3.5" />
                  {value ? "替换" : "上传"}
                </label>
              )}
            </Button>
          </div>
        </div>
        <input
          id={inputId}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={handleFileChange}
        />
      </div>
    </Field>
  );
}

function IpCombobox({
  ipId,
  ipTitle,
  ipRoomNumber,
  onChange,
}: {
  ipId: string;
  ipTitle: string;
  ipRoomNumber: string;
  onChange: (option: IpOption) => void;
}) {
  const [options, setOptions] = useState<IpOption[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: "20" });
      if (search.trim()) params.set("q", search.trim());
      requestEnvelope<AdminIpsData>(`/api/admin/ip-commerce/ips?${params.toString()}`)
        .then((data) => {
          if (cancelled) return;
          setOptions(
            data.items.map((row) => ({
              id: row.id,
              roomNumber: row.roomNumber,
              title: row.title,
              status: row.status,
            }))
          );
        })
        .catch(() => {
          if (!cancelled) setOptions([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [search]);

  const selectedIp =
    options.find((option) => option.id === ipId) ??
    (ipId
      ? { id: ipId, roomNumber: ipRoomNumber, title: ipTitle || ipId, status: "当前值" }
      : null);
  const items =
    selectedIp && !options.some((option) => option.id === selectedIp.id)
      ? [selectedIp, ...options]
      : options;

  return (
    <div className="space-y-1.5">
      <Combobox<IpOption>
        items={items}
        value={selectedIp}
        onValueChange={(option) => {
          if (option) onChange(option);
        }}
        onInputValueChange={(value: string) => setSearch(value)}
        itemToStringLabel={(option) => `${option.roomNumber} · ${option.title}`}
        itemToStringValue={(option) => option.id}
        isItemEqualToValue={(item, value) => item.id === value.id}
        autoHighlight
      >
        <ComboboxInput placeholder="Search room number or title" />
        <ComboboxContent>
          <ComboboxEmpty>未找到 IP</ComboboxEmpty>
          <ComboboxList>
            {(option: IpOption) => (
              <ComboboxItem key={option.id} value={option}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-950">{option.title}</p>
                  <p className="font-mono text-[11px] text-slate-500">Room {option.roomNumber}</p>
                </div>
                <span className="shrink-0 rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500">
                  {option.status}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {ipId ? (
        <p className="truncate text-[11px] text-slate-500">
          已选择 <span className="font-mono text-slate-700">{ipId}</span>
          {ipTitle ? ` · ${ipTitle}` : " · 未匹配标题"}
        </p>
      ) : null}
    </div>
  );
}

function isRenderableAssetUrl(value: string) {
  return /^(blob:|data:|https?:\/\/|\/)/.test(value);
}

function adminRenderableMediaUrl(value: string) {
  if (!value) return null;
  const mediaMatch = value.match(/^\/aurora\/media\/assets\/([^/]+)\/content(?:\?(.*))?$/u);
  if (mediaMatch?.[1]) {
    const query = mediaMatch[2] ? `?${mediaMatch[2]}` : "?variantKey=original";
    return `/api/admin/media/assets/${encodeURIComponent(decodeURIComponent(mediaMatch[1]))}/content${query}`;
  }
  return isRenderableAssetUrl(value) ? value : null;
}

function adminMediaContentUrl(assetId: string | null | undefined) {
  if (!assetId) return null;
  return `/api/admin/media/assets/${encodeURIComponent(assetId)}/content?variantKey=original`;
}

function FormSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function FieldLabel({
  htmlFor,
  tooltip,
  children,
}: {
  htmlFor?: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={htmlFor} className="text-[12px] text-slate-600">
        {children}
      </Label>
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="字段说明"
              className="inline-flex text-slate-400 transition hover:text-slate-600 focus-visible:text-slate-600 focus-visible:outline-none"
            >
              <IconInfoCircle className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[260px] text-[12px] leading-5">{tooltip}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function Field({
  label,
  tooltip,
  className,
  children,
}: {
  label: string;
  tooltip?: string;
  className?: string;
  /** Pass a function to receive a generated id for shadcn Label↔control association. */
  children: React.ReactNode | ((id: string) => React.ReactNode);
}) {
  const id = useId();
  const isRenderProp = typeof children === "function";
  return (
    <div className={cn("space-y-1.5", className)}>
      <FieldLabel htmlFor={isRenderProp ? id : undefined} tooltip={tooltip}>
        {label}
      </FieldLabel>
      {isRenderProp ? (children as (id: string) => React.ReactNode)(id) : children}
    </div>
  );
}

function TableHead({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <th
      className={cn(
        "border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500",
        className
      )}
    >
      {children}
    </th>
  );
}

function TableCell({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <td className={cn("border-b border-slate-100 px-3 py-3 text-sm text-slate-700", className)}>
      {children}
    </td>
  );
}

function NativeIpCardNotice({ placementKey }: { placementKey: PlacementKey }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-[12px] font-semibold text-slate-700">
        {placementLabel(placementKey)} 使用 IP 原生卡片
      </p>
      <p className="mt-1 text-[12px] leading-5 text-slate-500">
        标题、封面、简介和跳转来自已选择 IP；这里只配置排序、状态和排期。
      </p>
    </section>
  );
}

function CopyCompleteness({ item }: { item: RecommendationItem }) {
  if (!isHeroPlacement(item.placementKey)) {
    return (
      <div>
        <p className="text-[12px] text-slate-700">IP 原生</p>
        <p className="text-[11px] text-slate-500">跟随 IP 多语言</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <IconLanguage className="size-3.5 text-slate-400" />
      {LOCALES.map((locale) => {
        const complete = isLocaleComplete(item.locale[locale.code]);
        return (
          <span
            key={locale.code}
            className={cn(
              "inline-flex h-5 min-w-7 items-center justify-center rounded border px-1 text-[10px] font-semibold",
              complete
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            )}
          >
            {locale.code.split("-")[0]}
          </span>
        );
      })}
    </div>
  );
}

function AssetCompleteness({ item }: { item: RecommendationItem }) {
  if (!isHeroPlacement(item.placementKey)) {
    return (
      <div>
        <p className="text-[12px] text-slate-700">IP 原生</p>
        <p className="text-[11px] text-slate-500">封面 / 简介</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[12px] text-slate-700">{assetCompleteness(item)}/3</p>
      <p className="text-[11px] text-slate-500">桌面 / 移动 / 视频</p>
    </div>
  );
}

function getMetrics(items: RecommendationItem[], now: Date) {
  const statuses = items.map((item) => effectiveStatus(item, now));
  return {
    total: items.length,
    active: statuses.filter((status) => status === "active").length,
    pending: statuses.filter((status) => status === "pending").length,
    incomplete: items.filter((item) => recommendationIncomplete(item)).length,
  };
}

function recommendationIncomplete(item: RecommendationItem) {
  if (!item.ipId.trim()) return true;
  if (!isHeroPlacement(item.placementKey)) return false;

  return (
    !LOCALES.every((locale) => isLocaleComplete(item.locale[locale.code])) ||
    assetCompleteness(item) < 3
  );
}

function isLocaleComplete(copy: LocaleCopy) {
  return Boolean(copy.title.trim() && copy.description.trim() && copy.ctaLabel.trim());
}

function assetCompleteness(item: RecommendationItem) {
  return [item.desktopMediaUrl, item.mobileMediaUrl, item.trailerUrl].filter((value) =>
    value.trim()
  ).length;
}

function nextSortOrder(items: RecommendationItem[], placementKey: PlacementKey) {
  return (
    Math.max(
      0,
      ...items.filter((item) => item.placementKey === placementKey).map((item) => item.sortOrder)
    ) + 1
  );
}

function placementLabel(placementKey: PlacementKey) {
  const labels: Record<PlacementKey, string> = {
    ip_plaza_hero: "Hero",
    ip_plaza_for_you: "For You",
    ip_plaza_list_pinned: "列表置顶",
  };
  return labels[placementKey];
}

function isHeroPlacement(placementKey: PlacementKey) {
  return placementKey === "ip_plaza_hero";
}

function normalizeDraftForPlacement(draft: RecommendationDraft): RecommendationDraft {
  if (isHeroPlacement(draft.placementKey)) return draft;

  return {
    ...draft,
    desktopMediaUrl: "",
    mobileMediaUrl: "",
    trailerUrl: "",
    imageAssetId: null,
    mobileImageAssetId: null,
    trailerAssetId: null,
    locale: emptyLocaleCopy(),
  };
}

function effectiveStatus(
  item: RecommendationItem,
  now: Date = new Date()
): EffectiveRecommendationStatus {
  if (item.status === "draft") return "draft";
  if (item.status === "paused") return "paused";
  if (item.status === "archived") return "archived";

  const startsAt = scheduleDate(item.startsAt);
  const endsAt = scheduleDate(item.endsAt);
  if (startsAt && startsAt.getTime() > now.getTime()) return "pending";
  if (endsAt && endsAt.getTime() < now.getTime()) return "ended";
  return "active";
}

function scheduleDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function statusLabel(status: EffectiveRecommendationStatus) {
  const labels: Record<EffectiveRecommendationStatus, string> = {
    active: "生效中",
    pending: "待生效",
    ended: "已结束",
    draft: "草稿",
    paused: "已暂停",
    archived: "已归档",
  };
  return labels[status];
}

function statusTone(status: EffectiveRecommendationStatus) {
  if (status === "active") return "success";
  if (status === "pending") return "warn";
  if (status === "paused") return "risk";
  return "muted";
}

function toDraft(item: RecommendationItem): RecommendationDraft {
  return {
    placementKey: item.placementKey,
    ipId: item.ipId,
    ipTitle: item.ipTitle,
    ipRoomNumber: item.ipRoomNumber,
    sortOrder: item.sortOrder,
    status: item.status,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    desktopMediaUrl: item.desktopMediaUrl,
    mobileMediaUrl: item.mobileMediaUrl,
    trailerUrl: item.trailerUrl,
    imageAssetId: item.imageAssetId,
    mobileImageAssetId: item.mobileImageAssetId,
    trailerAssetId: item.trailerAssetId,
    locale: item.locale,
  };
}

// --- real-data adapters ---

function datetimeLocalValue(iso: string | null) {
  // ISO -> "YYYY-MM-DDTHH:mm" for <input type="datetime-local">
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function rowToItem(row: IpDiscoveryRecommendationRow): RecommendationItem {
  const locale = emptyLocaleCopy();
  for (const entry of row.localizations) {
    const code = entry.locale as LocaleCode;
    if (!locale[code]) continue;
    locale[code] = {
      eyebrow: entry.eyebrow ?? "",
      title: entry.title ?? "",
      description: entry.description ?? "",
      ctaLabel: entry.ctaLabel ?? "",
    };
  }
  return {
    id: row.id,
    placementKey: row.placementKey,
    ipId: row.ipId,
    ipTitle: row.ip?.title ?? row.ipId,
    ipRoomNumber: row.ip?.roomNumber ?? "",
    sortOrder: row.sortOrder,
    status: row.status,
    startsAt: datetimeLocalValue(row.startsAt),
    endsAt: datetimeLocalValue(row.endsAt),
    desktopMediaUrl: row.imageAsset?.url ?? "",
    mobileMediaUrl: row.mobileImageAsset?.url ?? "",
    trailerUrl: row.trailerAsset?.url ?? "",
    imageAssetId: row.imageAsset?.id ?? null,
    mobileImageAssetId: row.mobileImageAsset?.id ?? null,
    trailerAssetId: row.trailerAsset?.id ?? null,
    updatedBy: row.updatedById ?? row.createdById,
    updatedAt: row.updatedAt,
    locale,
  };
}

function draftToPayload(draft: RecommendationDraft) {
  const hero = isHeroPlacement(draft.placementKey);
  const localizations = hero
    ? LOCALES.flatMap(({ code }) => {
        const copy = draft.locale[code];
        const eyebrow = copy.eyebrow.trim();
        const title = copy.title.trim();
        const description = copy.description.trim();
        const ctaLabel = copy.ctaLabel.trim();
        if (!eyebrow && !title && !description && !ctaLabel) return [];
        return [
          {
            locale: code,
            eyebrow: eyebrow || null,
            title: title || null,
            description: description || null,
            ctaLabel: ctaLabel || null,
          },
        ];
      })
    : [];

  // Mutable fields shared by create + update. (placementKey/ipId are added only
  // on create — the update endpoint is strict and rejects them.)
  return {
    status: draft.status,
    sortOrder: draft.sortOrder,
    startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
    endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
    imageAssetId: hero ? draft.imageAssetId : null,
    mobileImageAssetId: hero ? draft.mobileImageAssetId : null,
    trailerAssetId: hero ? draft.trailerAssetId : null,
    localizations,
  };
}
