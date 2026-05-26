"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconBook2,
  IconChecks,
  IconFolder,
  IconLoader2,
  IconPhoto,
  IconTrash,
  IconUpload,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { AssetRecordSource, AssetRecordType, AssetRecord } from "@/src/types/workspace";
import { PanelLayout } from "../panel-layout";
import { AssetList, groupAssets } from "./asset-list";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { touchAssets, selectCurrentInstance } from "@/src/store/slices/projectSlice";
import {
  type AssetListItem,
  PAGE_SIZE,
  SOURCE_API,
  SOURCE_I18N_KEYS,
  SOURCE_VALUES,
  TYPE_TAB_I18N_KEYS,
  TYPE_TAB_VALUES,
  getAssetKey,
  getAssetUrl,
  getUploadType,
  inferAssetType,
  isImageType,
  isVideoType,
} from "./asset-utils";

const TYPE_TAB_ICONS: Record<AssetRecordType, React.ReactNode> = {
  img: <IconPhoto className="size-3.5" />,
  video: <IconVideo className="size-3.5" />,
  audio: <IconBook2 className="size-3.5" />,
};

export function AssetsPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("asset");
  const tc = useTranslations("common");
  const assetsVersion = useAppSelector((s) => selectCurrentInstance(s).assetsVersion);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<AssetRecordType>("img");
  const [source, setSource] = useState<AssetRecordSource>("all");
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [previewAsset, setPreviewAsset] = useState<AssetListItem | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(() => new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const groups = useMemo(() => groupAssets(assets), [assets]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  }, []);

  const toggleSelected = useCallback((asset: AssetListItem) => {
    if (asset.uploading) return;
    const key = getAssetKey(asset);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleAssetClick = useCallback(
    (asset: AssetListItem) => {
      if (selectionMode) {
        toggleSelected(asset);
        return;
      }
      setPreviewAsset(asset);
    },
    [selectionMode, toggleSelected]
  );

  // Reset selection whenever the filter set changes — the displayed list does
  // and selectedKeys could otherwise point at items the user no longer sees.
  useEffect(() => {
    if (selectionMode) exitSelectionMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, source]);

  const handleConfirmDelete = useCallback(async () => {
    if (selectedKeys.size === 0) return;
    const targets = assets.filter(
      (a) => selectedKeys.has(getAssetKey(a)) && !a.uploading && a.id != null
    );
    if (targets.length === 0) return;
    const targetKeys = new Set(targets.map(getAssetKey));
    const ids = targets.map((a) => a.id);
    setConfirmDeleteOpen(false);
    setDeletingKeys((prev) => new Set([...prev, ...targetKeys]));

    try {
      await backendApi.post("/api/ai/record/batch/delete", { data: ids });
      setAssets((current) => current.filter((a) => !targetKeys.has(getAssetKey(a))));
      setSelectedKeys(new Set());
      touchAssets();
      toast.success(t("deleted", { count: targets.length }));
      setSelectionMode(false);
    } catch (error) {
      console.error("[AssetsPanel] batch delete failed:", error);
      toast.error(t("deleteFailed"));
    } finally {
      setDeletingKeys((prev) => {
        const next = new Set(prev);
        for (const k of targetKeys) next.delete(k);
        return next;
      });
    }
  }, [selectedKeys, assets, touchAssets, t]);

  const loadAssets = useCallback(
    async (options?: { reset?: boolean }) => {
      if (loadingRef.current) return;
      const nextPage = options?.reset ? 1 : pageRef.current;
      if (!options?.reset && !hasMoreRef.current) return;

      loadingRef.current = true;
      setLoading(true);
      try {
        const data = await backendApi.post<Paginated<AssetRecord>>(SOURCE_API[source], {
          data: { page: nextPage, pageSize: PAGE_SIZE, type, sort: 1 },
        });
        const list = (data?.list ?? []) as AssetListItem[];
        const totalCount = Number(data?.totalCount ?? 0);
        const nextHasMore = nextPage * PAGE_SIZE < totalCount;

        setAssets((current) => {
          if (options?.reset) return list;
          const existingKeys = new Set(current.map((item) => getAssetKey(item)));
          const merged = [...current];
          for (const item of list) {
            if (!existingKeys.has(getAssetKey(item))) merged.push(item);
          }
          return merged;
        });
        hasMoreRef.current = nextHasMore;
        pageRef.current = nextPage + 1;
        setHasMore(nextHasMore);
      } catch (error) {
        console.error("[AssetsPanel] load failed:", error);
        toast.error(t("loadFailed"));
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [source, type, t]
  );

  useEffect(() => {
    pageRef.current = 1;
    hasMoreRef.current = true;
    setHasMore(true);
    void loadAssets({ reset: true });
  }, [assetsVersion, loadAssets, source, type]);

  const uploadFiles = useCallback(
    async (incomingFiles: File[]) => {
      if (incomingFiles.length === 0) return;

      const tempItems: AssetListItem[] = incomingFiles.map((file, index) => ({
        id: `uploading-${Date.now()}-${index}`,
        tempKey: `uploading-${Date.now()}-${index}`,
        name: file.name,
        type: inferAssetType(file, type),
        createTime: new Date().toISOString(),
        path: URL.createObjectURL(file),
        uploading: true,
      }));

      setAssets((current) => [...tempItems, ...current]);

      for (let i = 0; i < incomingFiles.length; i += 1) {
        const file = incomingFiles[i];
        const tempItem = tempItems[i];
        try {
          const uploaded = await uploadWorkspaceFile(file, {
            uploadType: getUploadType(type),
            sourceType: "LOCAL",
          });
          setAssets((current) =>
            current.map((a) =>
              getAssetKey(a) === getAssetKey(tempItem)
                ? {
                    ...a,
                    id: uploaded.path,
                    path: uploaded.path,
                    url: uploaded.path,
                    type: inferAssetType(file, type),
                    createTime: new Date().toISOString(),
                    uploading: false,
                  }
                : a
            )
          );
        } catch (error) {
          console.error("[AssetsPanel] upload failed:", error);
          setAssets((current) => current.filter((a) => getAssetKey(a) !== getAssetKey(tempItem)));
          toast.error(t("uploadFailedName", { name: file.name }));
        }
      }

      touchAssets();
      toast.success(t("uploaded", { count: incomingFiles.length }));
    },
    [touchAssets, type, t]
  );

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length > 0) await uploadFiles(files);
      event.target.value = "";
    },
    [uploadFiles]
  );

  const previewUrl = previewAsset ? getAssetUrl(previewAsset) : "";

  const selectedCount = selectedKeys.size;

  return (
    <>
      <PanelLayout
        title={t("title")}
        onClose={onClose}
        footer={
          selectionMode ? (
            <div className="flex w-full items-center gap-2">
              <Button className="flex-1" size="lg" variant="outline" onClick={exitSelectionMode}>
                <IconX className="size-3.5" />
                {tc("cancel")}
              </Button>
              <Button
                className="flex-1"
                size="lg"
                color="destructive"
                variant="solid"
                disabled={selectedCount === 0}
                onClick={() => setConfirmDeleteOpen(true)}
              >
                <IconTrash className="size-3.5" />
                {tc("delete")}
              </Button>
            </div>
          ) : (
            <Button
              className="w-full"
              size="lg"
              variant="solid"
              onClick={() => fileInputRef.current?.click()}
            >
              <IconUpload className="size-3.5" />
              {t("uploadAsset")}
            </Button>
          )
        }
      >
        <div
          className="relative -m-4 flex h-[calc(100%+2rem)] flex-col"
          onDragEnter={(e) => {
            e.preventDefault();
            dragDepthRef.current += 1;
            setIsDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            e.preventDefault();
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setIsDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragDepthRef.current = 0;
            setIsDragging(false);
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length > 0) void uploadFiles(files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            accept={type === "img" ? "image/*" : type === "video" ? "video/*" : "audio/*"}
            onChange={handleFileChange}
          />

          {/* Filters / selection-mode header */}
          {selectionMode ? (
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="text-xs font-medium text-foreground">
                {t("selected", { count: selectedCount })}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={exitSelectionMode}
                className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
              >
                <IconX className="size-3" />
                {t("cancelSelect")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <ToggleGroup
                type="single"
                value={type}
                onValueChange={(v) => v && setType(v as AssetRecordType)}
                className="rounded-lg bg-muted/50 p-0.5"
              >
                {TYPE_TAB_VALUES.map((v) => (
                  <ToggleGroupItem
                    key={v}
                    value={v}
                    className="gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
                  >
                    {TYPE_TAB_ICONS[v]}
                    {t(TYPE_TAB_I18N_KEYS[v])}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              <ToggleGroup
                type="single"
                value={source}
                onValueChange={(v) => v && setSource(v as AssetRecordSource)}
                className="rounded-lg bg-muted/50 p-0.5"
              >
                {SOURCE_VALUES.map((v) => (
                  <ToggleGroupItem
                    key={v}
                    value={v}
                    className="rounded-md px-2.5 py-1 text-[11px] font-medium text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
                  >
                    {t(SOURCE_I18N_KEYS[v])}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectionMode(true)}
                disabled={assets.length === 0}
                className="ml-auto h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                aria-label={t("select")}
              >
                <IconChecks className="size-3.5" />
                {t("select")}
              </Button>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-auto px-4 pb-4">
            {loading && assets.length === 0 ? (
              <div className="flex h-40 items-center justify-center">
                <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : assets.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center text-center">
                <IconFolder className="size-8 text-muted-foreground/20" />
                <p className="mt-3 text-xs text-muted-foreground">{t("emptyTitle")}</p>
                <Button size="sm" className="mt-3" onClick={() => fileInputRef.current?.click()}>
                  <IconUpload className="size-3.5" />
                  {t("uploadFirst")}
                </Button>
              </div>
            ) : (
              <AssetList
                groups={groups}
                selectable={selectionMode}
                selectedIds={selectedKeys}
                deletingIds={deletingKeys}
                columns={3}
                hasMore={hasMore}
                loading={loading}
                onSelect={toggleSelected}
                onClick={handleAssetClick}
                onLoadMore={() => void loadAssets()}
              />
            )}
          </div>

          {/* Drag overlay */}
          {isDragging && (
            <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10">
              <div className="rounded-xl bg-background/90 px-6 py-5 text-center shadow-xl">
                <IconUpload className="mx-auto size-8 text-primary" />
                <div className="mt-3 text-sm font-semibold">{t("dropToUpload")}</div>
              </div>
            </div>
          )}
        </div>
      </PanelLayout>

      <MediaPreviewModal
        open={!!previewAsset}
        onOpenChange={(open) => !open && setPreviewAsset(null)}
        type={
          previewAsset
            ? isImageType(previewAsset.type)
              ? "image"
              : isVideoType(previewAsset.type)
                ? "video"
                : "audio"
            : "image"
        }
        src={previewUrl}
        name={String(previewAsset?.name ?? t("materialPreview"))}
        link={previewUrl}
        createdAt={previewAsset?.createTime ? String(previewAsset.createTime) : ""}
      />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDeleteDescription", { count: selectedCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleConfirmDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
