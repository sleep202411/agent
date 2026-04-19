"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { IconCirclePlus, IconDownload, IconSearch } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { backendApi, type Paginated } from "@/src/lib/api";
import { CharacterFusionDialog } from "../character-fusion/character-fusion-dialog";
import { ImportEntityDialog } from "../import-entity-dialog";
import {
  WORKSPACE_FOCUS_ASSET_PANEL_EVENT,
  type AssetPanelFocusDetail,
} from "@/src/lib/panel-events";
import { PanelLayout } from "../panel-layout";
import {
  mergeCharacters,
  normalizeCharacter,
  normalizeCharacterName,
  PAGE_SIZE,
  type CharacterPanelItem,
} from "./character-utils";
import { CharacterList } from "./character-list";
import { CharacterEditDialog } from "./character-edit-dialog";
import { QuickCreateCharacterDialog } from "./character-create-dialog";
import { DeleteCharacterAlert } from "./character-delete-alert";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  touchCharacters,
  selectCurrentInstance,
  type Asset,
} from "@/src/store/slices/projectSlice";
import { useAssetImageStatuses } from "@/src/lib/assets/use-asset-image-statuses";
import { regenerateAssetImage } from "@/src/lib/assets/image-status-client";

export function CharactersPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("character");
  const tc = useTranslations("common");
  const worldId = useAppSelector((state) => selectCurrentInstance(state).worldId);
  const projectId = useAppSelector((state) => state.project.currentProjectId);
  const charactersVersion = useAppSelector(
    (state) => selectCurrentInstance(state).charactersVersion
  );
  const { statuses: imageStatuses, refetch: refetchImageStatuses } =
    useAssetImageStatuses(projectId);

  const [worldCharacters, setWorldCharacters] = useState<CharacterPanelItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<CharacterPanelItem | null>(null);
  const [fusionCharacter, setFusionCharacter] = useState<CharacterPanelItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CharacterPanelItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const pendingFocusRef = useRef<AssetPanelFocusDetail | null>(null);

  const loadWorldCharacters = useCallback(
    async (reset = true, keyword = "") => {
      if (!worldId) return;

      const page = reset ? 1 : pageRef.current;
      if (reset) {
        setLoading(true);
        setHasMore(true);
        hasMoreRef.current = true;
      } else {
        if (!hasMoreRef.current || loadingMoreRef.current) return;
        setLoadingMore(true);
        loadingMoreRef.current = true;
      }

      try {
        const searchName = keyword?.trim();
        const data = await backendApi.post<Paginated<Asset>>(
          searchName ? "/api/user/world/search/worldrole" : "/api/user/world/list/worldrole",
          {
            data: {
              worldId,
              page,
              pageSize: PAGE_SIZE,
              ...(searchName ? { name: searchName } : {}),
            },
          }
        );
        const list = (data?.list ?? []).map((item, index) => normalizeCharacter(item, index));
        setWorldCharacters((current) => (reset ? list : [...current, ...list]));
        pageRef.current = page + 1;
        const nextHasMore = list.length >= PAGE_SIZE;
        setHasMore(nextHasMore);
        hasMoreRef.current = nextHasMore;
      } catch (error) {
        console.error("[CharactersPanel] 加载角色失败:", error);
        toast.error("加载角色失败");
      } finally {
        setLoading(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    },
    [worldId]
  );

  useEffect(() => {
    if (!worldId) return;
    const timer = window.setTimeout(() => {
      void loadWorldCharacters(true, search.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [charactersVersion, loadWorldCharacters, search, worldId]);

  const visibleCharacters = useMemo(
    () => mergeCharacters(worldCharacters, [], search),
    [search, worldCharacters]
  );

  useEffect(() => {
    if (!visibleCharacters.some((item) => item.__panelKey === selectedVersion)) {
      setSelectedVersion("");
    }
  }, [selectedVersion, visibleCharacters]);

  useEffect(() => {
    const handleFocus = (event: Event) => {
      const detail = (event as CustomEvent<AssetPanelFocusDetail>).detail;
      if (!detail || detail.panel !== "characters") return;
      pendingFocusRef.current = detail;
      setSearch(detail.assetName?.trim() ?? "");
    };
    window.addEventListener(WORKSPACE_FOCUS_ASSET_PANEL_EVENT, handleFocus);
    return () => window.removeEventListener(WORKSPACE_FOCUS_ASSET_PANEL_EVENT, handleFocus);
  }, []);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const target = visibleCharacters.find((item) => {
      const matchesId =
        pending.assetId &&
        [item.id, item.aiId]
          .map((value) => String(value ?? ""))
          .filter(Boolean)
          .includes(String(pending.assetId));
      const matchesName =
        pending.assetName &&
        normalizeCharacterName(item.name) === normalizeCharacterName(pending.assetName);
      return Boolean(matchesId || matchesName);
    });
    if (!target) return;
    pendingFocusRef.current = null;
    setSelectedVersion(target.__panelKey);
    if (pending.openEditor !== false) {
      setEditingCharacter(target);
    }
    window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-panel-key="${target.__panelKey.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
      );
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [visibleCharacters]);

  const refreshPanel = useCallback(() => {
    store.dispatch(touchCharacters());
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget?.id || deleting) return;
    try {
      setDeleting(true);
      await backendApi.post(`/api/user/world/delete/worldrole?id=${deleteTarget.id}`);
      toast.success(t("deleteSuccess"));
      setDeleteTarget(null);
      refreshPanel();
    } catch (error) {
      console.error("[CharactersPanel] 删除角色失败:", error);
      toast.error(t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget?.id, deleting, refreshPanel]);

  return (
    <>
      <PanelLayout
        title={t("title")}
        onClose={onClose}
        footer={
          <div className="flex gap-2">
            <Button
              variant="outline"
              color="muted"
              size="lg"
              className="shrink-0"
              onClick={() => setImportOpen(true)}
            >
              <IconDownload className="size-3.5" />
              {tc("import")}
            </Button>
            <Button
              className="flex-1"
              size="lg"
              variant="solid"
              onClick={() => setQuickCreateOpen(true)}
            >
              <IconCirclePlus className="size-3.5" />
              {t("addCharacter")}
            </Button>
          </div>
        }
      >
        <div className="pb-4">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="pl-9"
            />
          </div>
        </div>

        <CharacterList
          characters={visibleCharacters}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          selectedVersion={selectedVersion}
          imageStatuses={imageStatuses}
          onSelectVersion={(character) => {
            setSelectedVersion(character.__panelKey);
            setEditingCharacter(character);
          }}
          onFusion={setFusionCharacter}
          onDelete={setDeleteTarget}
          onLoadMore={() => void loadWorldCharacters(false, search.trim())}
          onRetryImage={async (character) => {
            if (!projectId || !character.id) return;
            try {
              await regenerateAssetImage(projectId, "role", character.id, worldId ?? undefined);
              refetchImageStatuses();
            } catch (err) {
              // Keep UI intact; polling will re-sync. Error surfaced via toast elsewhere.
              console.warn("[image-retry] failed:", err);
            }
          }}
        />
      </PanelLayout>

      <ImportEntityDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        entityType="role"
        worldId={worldId ?? ""}
        onSuccess={refreshPanel}
      />

      <QuickCreateCharacterDialog
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        worldId={worldId ?? ""}
        onCreated={(character) => {
          setSelectedVersion(character.__panelKey);
          setEditingCharacter(character);
          refreshPanel();
        }}
      />

      <CharacterEditDialog
        open={Boolean(editingCharacter)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setEditingCharacter(null);
          }
        }}
        worldId={worldId ?? ""}
        character={editingCharacter}
        onSaved={() => {
          setEditingCharacter(null);
          refreshPanel();
        }}
        onDeleted={() => {
          setEditingCharacter(null);
          refreshPanel();
        }}
      />

      <CharacterFusionDialog
        open={Boolean(fusionCharacter)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setFusionCharacter(null);
          }
        }}
        character={fusionCharacter}
        worldId={worldId ?? ""}
        existingRoles={visibleCharacters}
        onSaved={() => {
          setFusionCharacter(null);
          refreshPanel();
        }}
      />

      <DeleteCharacterAlert
        open={Boolean(deleteTarget)}
        name={deleteTarget?.name}
        deleting={deleting}
        onOpenChange={(nextOpen: boolean) => !nextOpen && setDeleteTarget(null)}
        onDelete={() => void handleDelete()}
        tDelete={tc("delete")}
        tCancel={tc("cancel")}
        tUnnamed={t("unnamedCharacter")}
      />
    </>
  );
}
