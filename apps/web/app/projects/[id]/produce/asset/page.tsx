"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconFileX, IconRefresh } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
