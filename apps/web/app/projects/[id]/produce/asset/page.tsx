"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  IconAlertCircle,
  IconArrowRight,
  IconFileX,
  IconPlayerStop,
  IconRefresh,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  loadProduceJavaAssets,
  loadProjectWorldId,
  type ProduceJavaAsset,
  type ProduceJavaAssetLists,
} from "@/src/lib/produce/java-produce-data";
import { ASSET_TABS, type AssetTabKey } from "../_data/steps";
import { useProduceCommittedResult } from "../_hooks/use-produce-seed";
import { useProduceAssetImage } from "../_hooks/use-produce-asset-image";
import {
  useProduceStep2,
  type Step2Draft,
  type Step2DraftAsset,
} from "../_hooks/use-produce-step2";
import { useStepAdvanceController } from "../_hooks/use-step-advance";
import { CharacterCard } from "./_components/character-card";
import { PropCard } from "./_components/prop-card";
import { SceneCard } from "./_components/scene-card";

function isAssetTab(value: string | null): value is AssetTabKey {
  return value === "character" || value === "scene" || value === "prop";
}

const EMPTY_LISTS: ProduceJavaAssetLists = { character: [], scene: [], prop: [] };

export default function ProduceAssetPage() {
  const params = useParams();
  const projectId = String(params.id ?? "");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("produce");
  const committed = useProduceCommittedResult(projectId);
  const committedWorldId = committed?.worldId ?? "";
  const [worldId, setWorldId] = useState(committedWorldId);
  const [assets, setAssets] = useState<ProduceJavaAssetLists>(EMPTY_LISTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const tabParam = searchParams.get("tab");
  const activeTab: AssetTabKey = isAssetTab(tabParam) ? tabParam : "character";
  const activeMeta = ASSET_TABS.find((tab) => tab.key === activeTab) ?? ASSET_TABS[0];
  const activeCards = assets[activeTab];
  const replaceAsset = useCallback((updated: ProduceJavaAsset) => {
    setAssets((current) => ({
      ...current,
      [updated.kind]: current[updated.kind].map((item) =>
        item.id === updated.id ? updated : item
      ),
    }));
  }, []);
  const { statusById, generateImage, retryPersist } = useProduceAssetImage({
    worldId,
    onAssetUpdated: replaceAsset,
  });

  const reloadAssets = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const resolvedWorldId = committedWorldId || (await loadProjectWorldId(projectId));
      if (!resolvedWorldId) {
        setAssets(EMPTY_LISTS);
        setError("未找到项目世界，请先完成剧本步骤。");
        return;
      }
      setWorldId(resolvedWorldId);
      setAssets(await loadProduceJavaAssets(resolvedWorldId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "资产加载失败";
      setAssets(EMPTY_LISTS);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [committedWorldId, projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reloadAssets();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reloadAssets]);

  // Step 2 pipeline (asset extraction). When the LLM returns a draft,
  // we splat each item into the same `assets` map as a `draft_*`-id
  // entry so it shows up in-line with already-committed cards. The
  // user reviews them inline; clicking 保存继续 commits to Java and
  // navigates to /produce/episodes (Step 3).
  const step2 = useProduceStep2(projectId, worldId);
  const draftIds = useMemo(() => collectDraftIds(assets), [assets]);
  const hasDrafts = draftIds.size > 0;

  useEffect(() => {
    if (step2.status !== "completed" || !step2.draft) return;
    setAssets((current) => mergeDraftIntoAssets(current, step2.draft as Step2Draft));
    // After we've consumed the draft into the displayed list, clear
    // the hook's local state so generating again won't double-merge
    // the same items.
    step2.discard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step2.status]);

  const handleDiscardDrafts = useCallback(() => {
    setAssets((current) => stripDraftsFromAssets(current));
    step2.discard();
  }, [step2]);

  // Wire the layout's footer 下一步 button to commit pending drafts
  // before navigating. When there are no drafts (or step2 isn't in
  // a committable state), we leave the handler clear so the layout
  // falls through to plain link navigation.
  const { setHandler } = useStepAdvanceController();
  useEffect(() => {
    if (!hasDrafts || step2.status !== "completed") {
      setHandler(null);
      return;
    }
    setHandler(async () => {
      try {
        await step2.commit();
        await reloadAssets();
        router.push(`/projects/${projectId}/produce/episodes`);
      } catch (err) {
        console.error("[asset/page] commit failed:", err);
      }
    });
    return () => setHandler(null);
  }, [hasDrafts, step2, setHandler, reloadAssets, router, projectId]);

  const totals = useMemo(
    () => ({
      character: assets.character.length,
      scene: assets.scene.length,
      prop: assets.prop.length,
    }),
    [assets]
  );

  const setTab = (next: AssetTabKey) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", next);
    router.replace(`${pathname}?${sp.toString()}`);
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <IconRefresh className="size-5 animate-spin" />
          正在读取项目资产
        </div>
      </div>
    );
  }

  if (error && !activeCards.length) {
    return (
      <Empty className="min-h-[60vh] border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconFileX />
          </EmptyMedia>
          <EmptyTitle>还没有可生图的资产</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-450 flex-col gap-7">
      <Step2ActionBanner
        status={step2.status}
        error={step2.error}
        hasDrafts={hasDrafts}
        canGenerate={!!worldId}
        onGenerate={() => void step2.generate()}
        onCancel={step2.cancel}
        onRetry={() => {
          // Drop the previous draft batch first so the new run
          // doesn't double-stack on the existing list.
          setAssets((curr) => stripDraftsFromAssets(curr));
          step2.discard();
          void step2.generate();
        }}
        onDiscardDrafts={handleDiscardDrafts}
      />

      <div className="flex flex-wrap items-center gap-2">
        {ASSET_TABS.map((tab) => {
          const active = tab.key === activeTab;
          const count = totals[tab.key];
          return (
            <Button
              key={tab.key}
              variant={active ? "soft" : "ghost"}
              color={active ? "primary" : "muted"}
              size="lg"
              className="rounded-full"
              onClick={() => setTab(tab.key)}
            >
              {t(tab.labelKey)}
              <span
                className={cn(
                  "ml-1 rounded-full px-1.5 text-[11px]",
                  active
                    ? "bg-primary/15 text-primary"
                    : "bg-muted-foreground/10 text-muted-foreground"
                )}
              >
                {count}
              </span>
            </Button>
          );
        })}
        <Button
          variant="ghost"
          color="muted"
          size="lg"
          className="ml-auto rounded-full"
          onClick={() => void reloadAssets()}
        >
          <IconRefresh />
          刷新
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{t(activeMeta.descKey)}</p>

      {activeCards.length === 0 ? (
        <Empty className="min-h-[42vh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFileX />
            </EmptyMedia>
            <EmptyTitle>当前分类暂无资产</EmptyTitle>
            <EmptyDescription>Step1 确认后写入的 Java 资产会显示在这里。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            activeTab === "scene"
              ? // Scenes — landscape tiles, dense gallery.
                "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
              : activeTab === "prop"
                ? // Props — square tiles, even denser since each
                  // tile is smaller; can pack more on a row.
                  "sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
                : // Characters — taller horizontal cards with prose,
                  // fewer per row to keep description readable.
                  "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          )}
        >
          {activeCards.map((card) => {
            const sharedProps = {
              card,
              status: statusById[card.id] ?? { state: "idle" as const },
              onGenerate: () => void generateImage(card),
              onRetryPersist: () => void retryPersist(card),
            };
            // Each tab dispatches to its own dedicated card so the
            // visual treatment can diverge by asset kind (character
            // = portrait row, scene = landscape gallery, prop =
            // square gallery).
            if (activeTab === "scene") return <SceneCard key={card.id} {...sharedProps} />;
            if (activeTab === "prop") return <PropCard key={card.id} {...sharedProps} />;
            return <CharacterCard key={card.id} {...sharedProps} />;
          })}
        </div>
      )}
    </div>
  );
}

// ─── Step 2 helpers ──────────────────────────────────────────────

/**
 * Promote a Step 2 draft into the displayed asset list. We synthesise
 * a `draft_*` id (Java hasn't issued real ids yet — that happens on
 * commit) and leave imagePaths empty so the existing CharacterCard /
 * SceneCard / PropCard render their "no image yet" state. The items
 * sit alongside committed rows so the user reviews everything in one
 * grid; the action banner makes the draft / committed split visible
 * via the [N drafts pending] hint.
 */
function mergeDraftIntoAssets(
  current: ProduceJavaAssetLists,
  draft: Step2Draft
): ProduceJavaAssetLists {
  const buildItems = (
    items: Step2DraftAsset[],
    kind: "character" | "scene" | "prop"
  ): ProduceJavaAsset[] =>
    items.map((item, index) => ({
      kind,
      id: `draft_${kind}_${draft.generatedAt}_${index}`,
      name: item.name,
      description: item.description,
      prompt: item.prompt,
      imagePaths: [],
      referenceImagePaths: [],
      raw: { __draft: true } as Record<string, unknown>,
    }));
  // Drafts go at the front so they're the first thing the user sees
  // after the LLM run finishes. Saves a scroll on long lists, and the
  // "yellow ring" treatment is most readable when grouped at the top.
  return {
    character: [...buildItems(draft.characters, "character"), ...current.character],
    scene: [...buildItems(draft.scenes, "scene"), ...current.scene],
    prop: [...buildItems(draft.props, "prop"), ...current.prop],
  };
}

function collectDraftIds(assets: ProduceJavaAssetLists): Set<string> {
  const ids = new Set<string>();
  for (const kind of ["character", "scene", "prop"] as const) {
    for (const item of assets[kind]) {
      if (item.id.startsWith("draft_")) ids.add(item.id);
    }
  }
  return ids;
}

function stripDraftsFromAssets(current: ProduceJavaAssetLists): ProduceJavaAssetLists {
  const filterCommitted = (list: ProduceJavaAsset[]) =>
    list.filter((item) => !item.id.startsWith("draft_"));
  return {
    character: filterCommitted(current.character),
    scene: filterCommitted(current.scene),
    prop: filterCommitted(current.prop),
  };
}

// ─── Step 2 action banner ────────────────────────────────────────

interface Step2ActionBannerProps {
  status: "idle" | "running" | "completed" | "failed" | "cancelled" | "committing" | "committed";
  error?: string;
  hasDrafts: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDiscardDrafts: () => void;
}

function Step2ActionBanner(props: Step2ActionBannerProps) {
  const { status, error, hasDrafts, canGenerate, onGenerate, onCancel, onRetry, onDiscardDrafts } =
    props;

  if (status === "running") {
    return (
      <Card className="gap-3 p-4">
        <div className="flex items-center gap-3">
          <Spinner className="size-5 text-primary" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">正在抽取角色 / 场景 / 道具</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              基于已入库剧集的简介推断关键资产，去重后填进下方列表。
            </p>
          </div>
          <Button variant="outline" color="muted" size="sm" onClick={onCancel}>
            <IconPlayerStop className="size-3.5" /> 取消
          </Button>
        </div>
      </Card>
    );
  }

  if (status === "failed" || status === "cancelled") {
    return (
      <Card className="gap-3 p-4">
        <div className="flex items-start gap-3">
          <IconAlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">
              {status === "cancelled" ? "已取消抽取" : "资产抽取失败"}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {error || "请重试，或先去 Step 1 确认有可读的剧集简介。"}
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="solid" color="primary" size="sm" onClick={onRetry}>
            <IconRefresh className="size-3.5" /> 重试
          </Button>
        </div>
      </Card>
    );
  }

  if (hasDrafts) {
    return (
      <Card className="gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-primary">
              <IconSparkles className="size-3.5" /> 草稿已就绪 · 尚未入库
            </div>
            <h3 className="mt-1 text-sm font-semibold">下方列表已并入新生成的角色 / 场景 / 道具</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              草稿条目暂未生成图片。点击右下角"下一步"写入 Java 后再去 Step 3 生成分镜。
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" color="muted" size="sm" onClick={onDiscardDrafts}>
              <IconTrash className="size-3.5" /> 放弃
            </Button>
            <Button variant="outline" color="muted" size="sm" onClick={onRetry}>
              <IconRefresh className="size-3.5" /> 重试
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // Idle — show the "Generate assets" CTA.
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">从剧集简介中抽取角色 / 场景 / 道具</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            读取项目已入库的剧集简介，AI
            会推断出关键角色、场景、道具，自动去重已有的，结果会并入下方列表，由你确认后入库。
          </p>
        </div>
        <Button
          variant="solid"
          color="primary"
          size="lg"
          disabled={!canGenerate}
          onClick={onGenerate}
        >
          <IconSparkles className="size-4" /> 生成资产
        </Button>
      </div>
    </Card>
  );
}
