"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useTranslations } from "next-intl";
import { IconPlus, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { backendApi, type Paginated } from "@/src/lib/api";
import {
  WORKSPACE_FOCUS_ASSET_PANEL_EVENT,
  type AssetPanelFocusDetail,
} from "../asset-panel-events";
import { PanelLayout } from "../panel-layout";
import { SceneList } from "./scene-list";
import { SceneCreateDialog } from "./scene-create-dialog";
import { SceneEditDialog } from "./scene-edit-dialog";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  addScene,
  setScenes,
  setScenesLoading,
  selectCurrentInstance,
  type Asset,
} from "@/src/store/slices/projectSlice";
import {
  normalizeSceneName,
  normalizeSceneItem,
  mergeScenes,
  type ScenePanelItem,
} from "./scene-utils";

export function ScenesPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("scene");
  const tc = useTranslations("common");
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const scenes = useAppSelector((s) => selectCurrentInstance(s).scenes);
  const isLoading = useAppSelector((s) => selectCurrentInstance(s).isScenesLoading);
  const scenesVersion = useAppSelector((s) => selectCurrentInstance(s).scenesVersion);

  const [createOpen, setCreateOpen] = useState(false);
  const [editScene, setEditScene] = useState<ScenePanelItem | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [assetScenes, setAssetScenes] = useState<ScenePanelItem[]>([]);
  const pageRef = useRef(1);
  const pendingFocusRef = useRef<AssetPanelFocusDetail | null>(null);

  const visibleScenes = useMemo(
    () =>
      mergeScenes(
        scenes.map((item, index) => normalizeSceneItem(item, index, "world")),
        assetScenes
      ),
    [assetScenes, scenes]
  );

  const loadAssetScenes = useCallback(async () => {
    setAssetScenes([]);
  }, []);

  const loadScenes = useCallback(
    async (options?: { reset?: boolean; silent?: boolean }) => {
      if (!worldId) return;
      const reset = options?.reset ?? true;
      const silent = options?.silent ?? false;
      const targetPage = reset ? 1 : pageRef.current + 1;
      // Actions imported from slice: setScenes, setScenesLoading

      if (!silent) {
        if (reset) {
          store.dispatch(setScenesLoading(true));
        } else {
          setLoadingMore(true);
        }
      }

      try {
        const data = await backendApi.post<Paginated<Asset>>("/api/user/world/list/worldscene", {
          data: { worldId, page: targetPage, pageSize: 20 },
        });
        const nextList = data?.list ?? [];
        store.dispatch(
          setScenes(
            reset ? nextList : [...selectCurrentInstance(store.getState()).scenes, ...nextList]
          )
        );
        pageRef.current = targetPage;
        const totalCount = Number(data?.totalCount ?? 0);
        setHasMore(totalCount > 0 ? targetPage * 20 < totalCount : nextList.length === 20);
        if (reset) {
          await loadAssetScenes();
        }
      } catch (err) {
        console.error("[ScenesPanel] 加载失败:", err);
      } finally {
        if (!silent) {
          store.dispatch(setScenesLoading(false));
          setLoadingMore(false);
        }
      }
    },
    [loadAssetScenes, worldId]
  );

  useEffect(() => {
    if (!worldId) return;
    if (scenes.length === 0) {
      // 首次加载，显示 loading
      void loadScenes({ reset: true });
    } else {
      // 已有数据，静默刷新（不显示 loading）
      void loadScenes({ reset: true, silent: true });
    }
  }, [worldId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleFocus = (event: Event) => {
      const detail = (event as CustomEvent<AssetPanelFocusDetail>).detail;
      if (!detail || detail.panel !== "scenes") return;
      pendingFocusRef.current = detail;
    };
    window.addEventListener(WORKSPACE_FOCUS_ASSET_PANEL_EVENT, handleFocus);
    return () => window.removeEventListener(WORKSPACE_FOCUS_ASSET_PANEL_EVENT, handleFocus);
  }, []);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const target = visibleScenes.find((item) => {
      const matchesId =
        pending.assetId &&
        [item.id, item.aiId]
          .map((value) => String(value ?? ""))
          .filter(Boolean)
          .includes(String(pending.assetId));
      const matchesName =
        pending.assetName &&
        normalizeSceneName(item.name) === normalizeSceneName(pending.assetName);
      return Boolean(matchesId || matchesName);
    });
    if (!target) return;
    pendingFocusRef.current = null;
    if (pending.openEditor !== false) {
      setEditScene(target);
    }
    window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-panel-key="${target.__panelKey.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
      );
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [visibleScenes]);

  const handleCreated = useCallback((scene: Asset) => {
    store.dispatch(addScene(scene));
    setEditScene(normalizeSceneItem(scene, 0, "world"));
  }, []);

  return (
    <>
      <PanelLayout
        title={t("title")}
        onClose={onClose}
        loading={isLoading}
        actions={
          <button
            type="button"
            onClick={() => void loadScenes({ reset: true })}
            className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={tc("refresh")}
          >
            <IconRefresh className="size-3.5" />
          </button>
        }
        footer={
          <Button className="w-full" size="lg" variant="solid" onClick={() => setCreateOpen(true)}>
            <IconPlus className="size-3.5" /> {t("addScene")}
          </Button>
        }
      >
        <SceneList
          scenes={visibleScenes}
          onEdit={(s) => setEditScene(s)}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={() => void loadScenes({ reset: false })}
        />
      </PanelLayout>

      <SceneCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />

      {editScene && (
        <SceneEditDialog
          open={!!editScene}
          onOpenChange={(open) => {
            if (!open) setEditScene(null);
          }}
          scene={editScene}
          onSaved={() => {
            setEditScene(null);
          }}
          onDeleted={() => {
            setEditScene(null);
          }}
        />
      )}
    </>
  );
}
