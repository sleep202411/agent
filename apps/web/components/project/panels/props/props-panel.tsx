import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { backendApi, type Paginated } from "@/src/lib/api";
import {
  WORKSPACE_FOCUS_ASSET_PANEL_EVENT,
  type AssetPanelFocusDetail,
} from "../asset-panel-events";
import { PanelLayout } from "../panel-layout";
import { PropList } from "./prop-list";
import { PropCreateDialog } from "./prop-create-dialog";
import { PropEditDialog } from "./prop-edit-dialog";
import { normalizePropName, normalizePropItem, mergeProps, type PropPanelItem } from "./prop-utils";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  addProp,
  setProps,
  setPropsLoading,
  selectCurrentInstance,
  type Asset,
} from "@/src/store/slices/projectSlice";

export function PropsPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("prop");
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const props = useAppSelector((s) => selectCurrentInstance(s).props);
  const isLoading = useAppSelector((s) => selectCurrentInstance(s).isPropsLoading);

  const [createOpen, setCreateOpen] = useState(false);
  const [editProp, setEditProp] = useState<PropPanelItem | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [assetProps, setAssetProps] = useState<PropPanelItem[]>([]);
  const pageRef = useRef(1);
  const pendingFocusRef = useRef<AssetPanelFocusDetail | null>(null);

  const visibleProps = useMemo(
    () =>
      mergeProps(
        props.map((item, index) => normalizePropItem(item, index, "world")),
        assetProps
      ),
    [assetProps, props]
  );

  const loadAssetProps = useCallback(async () => {
    setAssetProps([]);
  }, []);

  const loadProps = useCallback(
    async (options?: { reset?: boolean; silent?: boolean }) => {
      if (!worldId) return;
      const reset = options?.reset ?? true;
      const silent = options?.silent ?? false;
      const targetPage = reset ? 1 : pageRef.current + 1;
      // Actions imported from slice: setProps, setPropsLoading

      if (!silent) {
        if (reset) {
          store.dispatch(setPropsLoading(true));
        } else {
          setLoadingMore(true);
        }
      }

      try {
        const data = await backendApi.post<Paginated<Asset>>("/api/user/world/list/worldprop", {
          data: { worldId, page: targetPage, pageSize: 20 },
        });
        const nextList = data?.list ?? [];
        store.dispatch(
          setProps(
            reset ? nextList : [...selectCurrentInstance(store.getState()).props, ...nextList]
          )
        );
        pageRef.current = targetPage;
        const totalCount = Number(data?.totalCount ?? 0);
        setHasMore(totalCount > 0 ? targetPage * 20 < totalCount : nextList.length === 20);
        if (reset) {
          await loadAssetProps();
        }
      } catch (err) {
        console.error("[PropsPanel] 加载失败:", err);
      } finally {
        if (!silent) {
          store.dispatch(setPropsLoading(false));
          setLoadingMore(false);
        }
      }
    },
    [loadAssetProps, worldId]
  );

  useEffect(() => {
    if (!worldId) return;
    if (props.length === 0) {
      void loadProps({ reset: true });
    } else {
      void loadProps({ reset: true, silent: true });
    }
  }, [worldId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleFocus = (event: Event) => {
      const detail = (event as CustomEvent<AssetPanelFocusDetail>).detail;
      if (!detail || detail.panel !== "props") return;
      pendingFocusRef.current = detail;
    };
    window.addEventListener(WORKSPACE_FOCUS_ASSET_PANEL_EVENT, handleFocus);
    return () => window.removeEventListener(WORKSPACE_FOCUS_ASSET_PANEL_EVENT, handleFocus);
  }, []);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const target = visibleProps.find((item) => {
      const matchesId =
        pending.assetId &&
        [item.id, item.aiId]
          .map((value) => String(value ?? ""))
          .filter(Boolean)
          .includes(String(pending.assetId));
      const matchesName =
        pending.assetName && normalizePropName(item.name) === normalizePropName(pending.assetName);
      return Boolean(matchesId || matchesName);
    });
    if (!target) return;
    pendingFocusRef.current = null;
    if (pending.openEditor !== false) {
      setEditProp(target);
    }
    window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-panel-key="${target.__panelKey.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
      );
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [visibleProps]);

  const handleCreated = useCallback((prop: Asset) => {
    store.dispatch(addProp(prop));
    setEditProp(normalizePropItem(prop, 0, "world"));
  }, []);

  return (
    <>
      <PanelLayout
        title={t("title")}
        onClose={onClose}
        loading={isLoading}
        footer={
          <Button className="w-full" size="lg" variant="solid" onClick={() => setCreateOpen(true)}>
            <IconPlus className="size-3.5" /> {t("addProp")}
          </Button>
        }
      >
        <PropList
          props={visibleProps}
          onEdit={(p) => setEditProp(p)}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={() => void loadProps({ reset: false })}
        />
      </PanelLayout>

      <PropCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />

      {editProp && (
        <PropEditDialog
          open={!!editProp}
          onOpenChange={(open) => {
            if (!open) setEditProp(null);
          }}
          prop={editProp}
          onSaved={() => setEditProp(null)}
          onDeleted={() => setEditProp(null)}
        />
      )}
    </>
  );
}
