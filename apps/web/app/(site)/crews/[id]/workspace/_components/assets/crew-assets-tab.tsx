"use client";

import { isCrewCursorError } from "@/app/(site)/crews/_hooks/api";

import {
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IconAdjustmentsHorizontal,
  IconArrowLeft,
  IconArrowsMove,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconDatabase,
  IconDownload,
  IconEdit,
  IconEye,
  IconFile,
  IconFileText,
  IconLoader2,
  IconFolder,
  IconFolderPlus,
  IconHistory,
  IconLink,
  IconLock,
  IconLockOpen,
  IconLayoutGrid,
  IconList,
  IconMusic,
  IconPhoto,
  IconRefresh,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconUpload,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type CrewAssetKind,
  type CrewAssetPreviewItem,
} from "@/app/(site)/crews/[id]/workspace/_data/asset-center-types";
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
import {
  type CrewAssetFolderDTO,
  type CrewAssetNodeDTO,
  type CrewAssetPermission,
  type CrewAssetSort,
  type CrewAssetSource,
  useCreateCrewAssetFolder,
  useCrewAssetContext,
  useCrewAssetFolders,
  useCrewAssetLocation,
  useCrewAssetPermissionEvents,
  useCrewAssetPermissions,
  useCrewAssets,
  usePermanentlyDeleteCrewAsset,
  useRestoreCrewAsset,
  useSetCrewAssetFavorite,
  useSetCrewAssetPermissions,
  useSetCrewAssetStudioLink,
  useTrashCrewAsset,
  useUpdateCrewAsset,
} from "@/app/(site)/crews/[id]/workspace/_hooks/use-crew-assets";
import { LinkStudioMediaDialog } from "./link-studio-media-dialog";
import { useCrewMembers } from "@/app/(site)/crews/_hooks/use-crew";
import { useCrewTransfers } from "@/app/(site)/crews/[id]/workspace/_components/transfers/crew-transfer-center";

type AssetViewMode = "list" | "grid";
type Translation = ReturnType<typeof useTranslations>;
type FolderCrumb = { id: string; name: string };
type AssetAction = "rename" | "move";

interface CrewAssetsTabProps {
  crewId: string;
  crewName?: string;
  variant?: "embedded" | "workbench";
  initialAssetId?: string | null;
  onSelectedAssetChange?: (assetId: string | null) => void;
}

export function CrewAssetsTab({
  crewId,
  crewName,
  variant = "embedded",
  initialAssetId = null,
  onSelectedAssetChange,
}: CrewAssetsTabProps) {
  const t = useTranslations("crewAssets");
  const { enqueueAssetFiles } = useCrewTransfers();
  const workbench = variant === "workbench";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeSource, setActiveSource] = useState<CrewAssetSource>("all");
  const [viewMode, setViewMode] = useState<AssetViewMode>("list");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | CrewAssetKind>("all");
  const [sort, setSort] = useState<CrewAssetSort>("modified");
  const [folderPath, setFolderPath] = useState<FolderCrumb[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const currentSelection = useRef(selectedAssetId);
  useLayoutEffect(() => {
    currentSelection.current = selectedAssetId;
  }, [selectedAssetId]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const bulkPending = useRef(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const folderCreatePending = useRef(false);
  const [savingFolder, setSavingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [assetAction, setAssetAction] = useState<AssetAction | null>(null);
  const [assetActionTargets, setAssetActionTargets] = useState<CrewAssetPreviewItem[]>([]);
  const [assetActionBusy, setAssetActionBusy] = useState(false);
  const assetActionPending = useRef(false);
  const draggedAssets = useRef<{ crewId: string; targets: CrewAssetPreviewItem[] } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  useLayoutEffect(() => {
    draggedAssets.current = null;
    return () => {
      draggedAssets.current = null;
    };
  }, [crewId, activeSource]);
  const [assetActionErrors, setAssetActionErrors] = useState<string[]>([]);
  const [actionName, setActionName] = useState("");
  const [renameVersion, setRenameVersion] = useState("");
  const [destinationId, setDestinationId] = useState<string>("");
  const [confirmPermanentDeleteOpen, setConfirmPermanentDeleteOpen] = useState(false);
  const [studioDialogOpen, setStudioDialogOpen] = useState(false);
  const [bindNodeId, setBindNodeId] = useState<string | null>(null);

  const activeFolderId = folderPath.at(-1)?.id ?? null;
  const contextQuery = useCrewAssetContext(crewId);
  const initialAsset = useCrewAssetLocation(crewId, initialAssetId, Boolean(initialAssetId));
  const activeFolder = useCrewAssetLocation(
    crewId,
    activeFolderId,
    activeSource === "all" && Boolean(activeFolderId)
  );
  const assetQuery = useCrewAssets(
    crewId,
    {
      parentId: activeSource === "all" ? (activeFolderId ?? undefined) : undefined,
      source: activeSource,
      query: query.trim() || undefined,
      kind: typeFilter === "folder" ? "folder" : typeFilter === "all" ? undefined : "file",
      sort,
    },
    true
  );
  const folderQuery = useCrewAssetFolders(crewId);
  const createFolder = useCreateCrewAssetFolder(crewId);
  const updateAsset = useUpdateCrewAsset(crewId);
  const trashAsset = useTrashCrewAsset(crewId);
  const restoreAsset = useRestoreCrewAsset(crewId);
  const permanentlyDeleteAsset = usePermanentlyDeleteCrewAsset(crewId);
  const setFavorite = useSetCrewAssetFavorite(crewId);
  const setStudioLink = useSetCrewAssetStudioLink(crewId);
  const capabilities = contextQuery.data?.capabilities;
  const containerPermission: CrewAssetPermission | null =
    activeFolderId == null
      ? contextQuery.data?.role === "admin"
        ? "manage"
        : contextQuery.data
          ? "edit"
          : null
      : (activeFolder.data?.node.effectivePermission ?? null);
  const canCreateFolder =
    capabilities?.createFolder === true && hasAssetPermission(containerPermission, "upload");
  const canUpload =
    capabilities?.upload === true &&
    contextQuery.data?.storageAvailable === true &&
    hasAssetPermission(containerPermission, "upload");

  useEffect(() => {
    if (!initialAsset.data) return;
    const timeout = window.setTimeout(() => {
      setActiveSource("all");
      const { node, path } = initialAsset.data;
      const folder = node.kind === "folder";
      setFolderPath(folder ? [...path, { id: node.id, name: node.name }] : path);
      setSelectedAssetId(folder ? "" : node.id);
      setInspectorOpen(!folder);
      setCheckedIds(new Set());
      setQuery("");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initialAsset.data]);

  const updateViewMode = (next: AssetViewMode) => {
    setViewMode(next);
  };

  const contributorIds = useMemo(
    () => (assetQuery.data?.items ?? []).map((item) => item.updatedByUserId),
    [assetQuery.data?.items]
  );
  const contributorDisplays = useUserDisplays(contributorIds);
  const sourceItems = useMemo(
    () =>
      (assetQuery.data?.items ?? []).map((item) =>
        mapAssetNode(item, displayNameOf(item.updatedByUserId, contributorDisplays))
      ),
    [assetQuery.data?.items, contributorDisplays]
  );

  const filteredItems = useMemo(
    () =>
      typeFilter === "all" || typeFilter === "folder"
        ? sourceItems
        : sourceItems.filter((item) => item.kind === typeFilter),
    [sourceItems, typeFilter]
  );

  const selectedAsset = sourceItems.find((item) => item.id === selectedAssetId) ?? undefined;
  const checkedAssetId = checkedIds.size === 1 ? [...checkedIds][0] : undefined;
  /** Single-target actions (rename). Cleared when multi-checked. */
  const actionableAsset =
    checkedIds.size > 1
      ? undefined
      : sourceItems.find((item) => item.id === (checkedAssetId ?? selectedAssetId));
  const checkedAssets = sourceItems.filter((item) => checkedIds.has(item.id));
  const movableChecked = checkedAssets.filter(
    (item) => !item.contractLocked && hasAssetPermission(item.effectivePermission, "edit")
  );
  const canOrganizeSingle =
    capabilities?.organize === true &&
    Boolean(
      actionableAsset &&
      !actionableAsset.contractLocked &&
      hasAssetPermission(actionableAsset.effectivePermission, "edit")
    );
  const canMoveChecked =
    capabilities?.organize === true && activeSource !== "trash" && movableChecked.length > 0;
  const canShowMove = canOrganizeSingle || canMoveChecked;
  const canTrash =
    capabilities?.trash === true &&
    checkedAssets.length > 0 &&
    checkedAssets.every(
      (item) => !item.contractLocked && hasAssetPermission(item.effectivePermission, "edit")
    );
  const canRestore =
    capabilities?.restore === true &&
    checkedAssets.length > 0 &&
    checkedAssets.every((item) => hasAssetPermission(item.effectivePermission, "edit"));
  const canDeleteForever =
    checkedAssets.length > 0 &&
    checkedAssets.every(
      (item) => !item.contractLocked && hasAssetPermission(item.effectivePermission, "manage")
    );

  const changeSource = (source: CrewAssetSource) => {
    setActiveSource(source);
    setFolderPath([]);
    setCheckedIds(new Set());
    setQuery("");
    setSelectedAssetId("");
    setInspectorOpen(false);
    onSelectedAssetChange?.(null);
    setCreatingFolder(false);
  };

  const toggleChecked = (id: string) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setCheckedIds((current) =>
      current.size === filteredItems.length
        ? new Set()
        : new Set(filteredItems.map((item) => item.id))
    );
  };

  const toggleFavorite = (id: string) => {
    const item = sourceItems.find((candidate) => candidate.id === id);
    if (!item) return;
    setFavorite.mutate(
      { nodeId: id, favorite: !item.favorite },
      { onError: (error) => toast.error(describeError(error, t("operationFailed"))) }
    );
  };

  const selectAsset = (item: CrewAssetPreviewItem) => {
    setSelectedAssetId(item.id);
    setInspectorOpen(true);
    onSelectedAssetChange?.(item.id);
  };

  const openFolder = (item: CrewAssetPreviewItem) => {
    if (item.kind !== "folder" || activeSource !== "all") return;
    setFolderPath((current) => [...current, { id: item.id, name: item.name }]);
    setCheckedIds(new Set());
    setSelectedAssetId("");
    setInspectorOpen(false);
    onSelectedAssetChange?.(null);
    setCreatingFolder(false);
  };

  const openFolderAt = (index: number) => {
    setFolderPath((current) => current.slice(0, index + 1));
    setCheckedIds(new Set());
    setSelectedAssetId("");
    setInspectorOpen(false);
    onSelectedAssetChange?.(null);
    setCreatingFolder(false);
  };

  const openRoot = () => {
    setFolderPath([]);
    setCheckedIds(new Set());
    setSelectedAssetId("");
    setInspectorOpen(false);
    onSelectedAssetChange?.(null);
    setCreatingFolder(false);
  };

  const settleCheckedActions = async (ids: string[], action: (id: string) => Promise<unknown>) => {
    const results = await Promise.allSettled(ids.map(action));
    const succeeded = new Set(ids.filter((_, index) => results[index].status === "fulfilled"));
    setCheckedIds((current) => new Set([...current].filter((id) => !succeeded.has(id))));
    if (succeeded.has(currentSelection.current)) {
      setSelectedAssetId("");
      setInspectorOpen(false);
      onSelectedAssetChange?.(null);
    }
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  };

  const deleteChecked = async () => {
    if (checkedIds.size === 0 || bulkPending.current) return;
    if (activeSource === "trash" ? !canDeleteForever : !canTrash) return;
    const ids = [...checkedIds];
    bulkPending.current = true;
    setBulkBusy(true);
    try {
      if (activeSource === "trash") {
        await settleCheckedActions(ids, (id) => permanentlyDeleteAsset.mutateAsync(id));
        toast.success(t("deletedForever", { count: ids.length }));
      } else {
        await settleCheckedActions(ids, (id) => trashAsset.mutateAsync(id));
        toast.success(t("movedToTrash", { count: ids.length }));
      }
    } catch (error) {
      toast.error(describeError(error, t("operationFailed")));
    } finally {
      bulkPending.current = false;
      setBulkBusy(false);
    }
  };

  const restoreChecked = async () => {
    if (checkedIds.size === 0 || !canRestore || bulkPending.current) return;
    const ids = [...checkedIds];
    bulkPending.current = true;
    setBulkBusy(true);
    try {
      await settleCheckedActions(ids, (id) => restoreAsset.mutateAsync(id));
      toast.success(t("restored", { count: ids.length }));
    } catch (error) {
      toast.error(describeError(error, t("operationFailed")));
    } finally {
      bulkPending.current = false;
      setBulkBusy(false);
    }
  };

  const addFolder = async () => {
    if (!canCreateFolder || folderCreatePending.current) return;
    const name = newFolderName.trim();
    if (!name) return;
    folderCreatePending.current = true;
    setSavingFolder(true);
    try {
      await createFolder.mutateAsync({ name, parentId: activeFolderId });
      setCreatingFolder(false);
      setNewFolderName("");
      toast.success(t("folderCreated"));
    } catch (error) {
      toast.error(describeError(error, t("operationFailed")));
    } finally {
      folderCreatePending.current = false;
      setSavingFolder(false);
    }
  };

  const addUploadedFiles = (files: FileList | null) => {
    if (!files?.length) return;
    if (!canUpload) {
      toast.error(t("storageUnavailableUpload"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    enqueueAssetFiles(Array.from(files), activeFolderId);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const downloadChecked = () => {
    const downloadable = sourceItems.filter((item) => checkedIds.has(item.id) && item.mediaUrl);
    downloadable.forEach((item) => {
      const link = document.createElement("a");
      link.href = item.mediaUrl!;
      link.download = item.name;
      link.rel = "noopener";
      link.click();
    });
  };

  const openAssetAction = (action: AssetAction, targetIds?: string[]) => {
    if (action === "rename") {
      if (!actionableAsset) return;
      setAssetActionTargets([actionableAsset]);
      setAssetAction("rename");
      setActionName(actionableAsset.name);
      setRenameVersion(actionableAsset.updatedAt);
      setDestinationId(actionableAsset.parentId ?? "");
      return;
    }

    const ids =
      targetIds && targetIds.length > 0 ? targetIds : actionableAsset ? [actionableAsset.id] : [];
    if (ids.length === 0) return;
    const primary = sourceItems.find((item) => item.id === ids[0]);
    setAssetActionTargets(sourceItems.filter((item) => ids.includes(item.id)));
    setAssetActionErrors([]);
    setAssetAction("move");
    setActionName(primary?.name ?? "");
    setDestinationId(primary?.parentId ?? "");
  };

  const settleAssetActionSelection = (completedIds: string[], failedIds: string[] = []) => {
    const completed = new Set(completedIds);
    setCheckedIds(
      (current) => new Set([...current].filter((id) => !completed.has(id)).concat(failedIds))
    );
    if (completed.has(currentSelection.current)) {
      setSelectedAssetId("");
      setInspectorOpen(false);
      onSelectedAssetChange?.(null);
    }
  };

  const submitAssetAction = async (drop?: {
    targets: CrewAssetPreviewItem[];
    parentId: string;
  }) => {
    const action = drop ? "move" : assetAction;
    const targets = drop?.targets ?? assetActionTargets;
    if (!action || targets.length === 0 || assetActionPending.current) return;
    if (!drop && action === "move" && (folderQuery.isPending || folderQuery.isError)) return;
    assetActionPending.current = true;
    setAssetActionBusy(true);
    setAssetActionErrors([]);
    try {
      if (action === "rename") {
        const target = targets[0];
        if (!target) return;
        const name = actionName.trim();
        if (!name) return;
        await updateAsset.mutateAsync({
          nodeId: target.id,
          expectedUpdatedAt: renameVersion,
          name,
        });
        toast.success(t("renamed"));
      } else {
        const parentId = drop?.parentId ?? (destinationId || null);
        const results = await Promise.allSettled(
          targets.map((target) =>
            updateAsset.mutateAsync({
              nodeId: target.id,
              expectedUpdatedAt: target.updatedAt,
              parentId,
            })
          )
        );
        const failures = results.flatMap((result, index) =>
          result.status === "rejected" ? [{ target: targets[index]!, error: result.reason }] : []
        );
        const movedCount = results.length - failures.length;
        if (movedCount) toast.success(t("moved", { count: movedCount }));
        if (failures.length) {
          setAssetAction("move");
          setDestinationId(parentId ?? "");
          setAssetActionErrors(
            failures.map(
              ({ target, error }) => `${target.name}: ${describeError(error, t("operationFailed"))}`
            )
          );
          toast.error(
            failures
              .map(
                ({ target, error }) =>
                  `${target.name}: ${describeError(error, t("operationFailed"))}`
              )
              .join("\n")
          );
          setAssetActionTargets(failures.map(({ target }) => target));
          settleAssetActionSelection(
            targets
              .filter((_, index) => results[index]?.status === "fulfilled")
              .map((target) => target.id),
            failures.map(({ target }) => target.id)
          );
          return;
        }
      }
      setAssetAction(null);
      setAssetActionTargets([]);
      settleAssetActionSelection(targets.map((target) => target.id));
    } catch (error) {
      toast.error(describeError(error, t("operationFailed")));
    } finally {
      assetActionPending.current = false;
      setAssetActionBusy(false);
    }
  };

  const assetDragProps = (item: CrewAssetPreviewItem): HTMLAttributes<HTMLElement> => {
    const dragEnabled =
      capabilities?.organize === true && activeSource !== "trash" && !assetActionBusy && !bulkBusy;
    const editable =
      dragEnabled && !item.contractLocked && hasAssetPermission(item.effectivePermission, "edit");
    const canDrop = () => {
      const drag = draggedAssets.current;
      return (
        dragEnabled &&
        hasAssetPermission(item.effectivePermission, "upload") &&
        !assetActionPending.current &&
        item.kind === "folder" &&
        drag?.crewId === crewId &&
        drag.targets.length > 0 &&
        drag.targets.every((target) => {
          const current = sourceItems.find((source) => source.id === target.id);
          return (
            current &&
            !current.contractLocked &&
            current.id !== item.id &&
            current.parentId !== item.id &&
            hasAssetPermission(current.effectivePermission, "edit")
          );
        })
      );
    };
    return {
      draggable: editable && item.kind !== "folder",
      onDragStart: (event) => {
        draggedAssets.current = null;
        const targets = checkedIds.has(item.id) ? checkedAssets : [item];
        if (
          !editable ||
          assetActionPending.current ||
          targets.length === 0 ||
          targets.some(
            (target) =>
              target.contractLocked ||
              target.kind === "folder" ||
              !hasAssetPermission(target.effectivePermission, "edit")
          )
        ) {
          event.preventDefault();
          return;
        }
        draggedAssets.current = { crewId, targets };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-fizzdragon-crew-assets", crewId);
      },
      onDragOver: (event) => {
        if (!canDrop()) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTargetId(item.id);
      },
      onDragLeave: (event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        setDropTargetId((current) => (current === item.id ? null : current));
      },
      onDrop: (event) => {
        if (!canDrop()) return;
        event.preventDefault();
        event.stopPropagation();
        const targets = draggedAssets.current!.targets;
        draggedAssets.current = null;
        setDropTargetId(null);
        void submitAssetAction({ targets, parentId: item.id });
      },
      onDragEnd: () => {
        draggedAssets.current = null;
        setDropTargetId(null);
      },
    };
  };

  return (
    <>
      <section
        data-pane="assets"
        aria-label={t("title")}
        className={cn(
          "overflow-hidden bg-[#0b0d10]",
          workbench ? "h-full min-h-0" : "min-h-[720px] rounded-2xl border border-border/70"
        )}
      >
        <div
          className={cn(
            "grid grid-cols-1",
            workbench
              ? "h-full min-h-0 lg:grid-cols-[218px_minmax(0,1fr)]"
              : "min-h-[720px] lg:grid-cols-[176px_minmax(0,1fr)]",
            inspectorOpen &&
              (workbench
                ? "lg:grid-cols-[218px_minmax(0,1fr)_350px]"
                : "lg:grid-cols-[176px_minmax(0,1fr)_340px]")
          )}
        >
          <AssetSourceRail
            crewName={crewName}
            workbench={workbench}
            activeSource={activeSource}
            folderPath={folderPath}
            context={contextQuery.data}
            contextLoading={contextQuery.isLoading}
            t={t}
            onSelectSource={changeSource}
            onOpenRoot={openRoot}
            folders={folderQuery.data ?? []}
            foldersLoading={folderQuery.isPending}
            foldersError={
              folderQuery.isError ? describeError(folderQuery.error, t("operationFailed")) : null
            }
            onOpenFolder={(path) => {
              setActiveSource("all");
              setFolderPath(path);
              setCheckedIds(new Set());
              setSelectedAssetId("");
              setInspectorOpen(false);
              setCreatingFolder(false);
              onSelectedAssetChange?.(null);
            }}
          />

          <div className="flex min-h-0 min-w-0 flex-col border-l border-border/60">
            <header className="shrink-0 border-b border-border/60 px-4 py-3">
              {contextQuery.data?.storageUsage ? (
                <div
                  className="mb-3 space-y-1 text-[11px] text-muted-foreground"
                  aria-live="polite"
                >
                  <p>
                    {t("storageUsed", {
                      used: (contextQuery.data.storageUsage.usedBytes / 1e9).toFixed(2),
                      total: (contextQuery.data.storageUsage.totalBytes / 1e9).toFixed(2),
                    })}
                  </p>
                  <p>
                    {t("storageRemaining", {
                      remaining: (contextQuery.data.storageUsage.remainingBytes / 1e9).toFixed(2),
                    })}
                  </p>
                  {contextQuery.data.storageUsage.reservedBytes > 0 ? (
                    <p>
                      {t("storageReserved", {
                        reserved: (contextQuery.data.storageUsage.reservedBytes / 1e9).toFixed(2),
                      })}
                    </p>
                  ) : null}
                  {contextQuery.data.storageUsage.unknownSizeCount > 0 ? (
                    <p>{t("storageUnverified")}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                {activeSource === "all" ? (
                  <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    {folderPath.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => openFolderAt(folderPath.length - 2)}
                        className="mr-1 grid size-6 shrink-0 place-items-center rounded-md hover:bg-secondary hover:text-foreground"
                        aria-label={t("back")}
                      >
                        <IconArrowLeft className="size-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={openRoot}
                      className={cn(
                        "truncate hover:text-foreground",
                        folderPath.length === 0 && "font-semibold text-foreground"
                      )}
                    >
                      {t("folderCrewAssets")}
                    </button>
                    {folderPath.map((folder, index) => (
                      <span key={folder.id} className="contents">
                        <IconChevronRight className="size-3 shrink-0" />
                        <button
                          type="button"
                          onClick={() => openFolderAt(index)}
                          className={cn(
                            "max-w-36 truncate hover:text-foreground",
                            index === folderPath.length - 1 && "font-semibold text-foreground"
                          )}
                        >
                          {folder.name}
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <h1 className="truncate text-[13px] font-semibold text-foreground">
                    {t(activeSource)}
                  </h1>
                )}
                {activeSource !== "trash" ? (
                  <div className="flex items-center gap-2">
                    {canCreateFolder ? (
                      <button
                        type="button"
                        onClick={() => setCreatingFolder(true)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                      >
                        <IconFolderPlus className="size-3.5" />
                        {t("newFolder")}
                      </button>
                    ) : null}
                    {canUpload ? (
                      <button
                        type="button"
                        onClick={() => {
                          setBindNodeId(null);
                          setStudioDialogOpen(true);
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/40"
                      >
                        <IconLink className="size-3.5" />
                        {t("linkStudioAssets")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!canUpload}
                      title={!canUpload ? t("storageUnavailableUpload") : undefined}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
                    >
                      <IconUpload className="size-3.5" />
                      {t("upload")}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => addUploadedFiles(event.target.files)}
                    />
                  </div>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="relative min-w-[190px] flex-1">
                  <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setCheckedIds(new Set());
                    }}
                    placeholder={t("searchPlaceholder")}
                    className="h-8 w-full rounded-lg border border-border/70 bg-background/60 pl-8 pr-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60"
                  />
                </label>
                <ToolbarSelect
                  ariaLabel={t("typeFilter")}
                  value={typeFilter}
                  onChange={(value) => {
                    setTypeFilter(value as "all" | CrewAssetKind);
                    setCheckedIds(new Set());
                  }}
                  options={[
                    ["all", t("allTypes")],
                    ["folder", t("typeFolder")],
                    ["pdf", t("typePdf")],
                    ["image", t("typeImage")],
                    ["video", t("typeVideo")],
                    ["audio", t("typeAudio")],
                    ["design", t("typeDesign")],
                    ["doc", t("typeDocument")],
                  ]}
                />
                <ToolbarSelect
                  ariaLabel={t("sortLabel")}
                  value={sort}
                  onChange={(value) => setSort(value as typeof sort)}
                  icon={<IconAdjustmentsHorizontal className="size-3.5" />}
                  options={[
                    ["modified", t("sortModified")],
                    ["name", t("sortName")],
                    ["size", t("sortSize")],
                  ]}
                />
                {actionableAsset?.contractLocked && (
                  <span className="text-xs text-muted-foreground">{t("contractReadOnly")}</span>
                )}
                {activeSource !== "trash" && canShowMove ? (
                  <>
                    {canOrganizeSingle ? (
                      <button
                        type="button"
                        onClick={() => openAssetAction("rename")}
                        className="grid size-8 place-items-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
                        aria-label={t("rename")}
                        title={t("rename")}
                      >
                        <IconEdit className="size-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        openAssetAction(
                          "move",
                          movableChecked.length > 0
                            ? movableChecked.map((item) => item.id)
                            : undefined
                        )
                      }
                      className="grid size-8 place-items-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
                      aria-label={t("move")}
                      title={t("move")}
                    >
                      <IconArrowsMove className="size-3.5" />
                    </button>
                  </>
                ) : null}
                <div
                  className="flex h-8 items-center rounded-lg border border-border/70 bg-background/60 p-0.5"
                  aria-label={t("viewMode")}
                >
                  <ViewModeButton
                    active={viewMode === "list"}
                    label={t("listView")}
                    onClick={() => updateViewMode("list")}
                  >
                    <IconList className="size-3.5" />
                  </ViewModeButton>
                  <ViewModeButton
                    active={viewMode === "grid"}
                    label={t("gridView")}
                    onClick={() => updateViewMode("grid")}
                  >
                    <IconLayoutGrid className="size-3.5" />
                  </ViewModeButton>
                </div>
                {selectedAsset ? (
                  <button
                    type="button"
                    onClick={() => setInspectorOpen((open) => !open)}
                    aria-pressed={inspectorOpen}
                    className={cn(
                      "grid size-8 place-items-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground",
                      inspectorOpen && "border-primary/40 bg-primary/10 text-primary"
                    )}
                    aria-label={t("togglePreview")}
                    title={inspectorOpen ? t("closePreview") : t("openPreview")}
                  >
                    <IconEye className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </header>

            {checkedIds.size > 0 ? (
              <div className="flex min-h-10 flex-wrap items-center gap-1.5 border-b border-border/60 bg-secondary/20 px-4 py-1.5 text-xs">
                <span className="mr-2 font-semibold text-foreground">
                  {t("selectedCount", { count: checkedIds.size })}
                </span>
                <BulkAction
                  icon={<IconDownload />}
                  label={t("download")}
                  onClick={downloadChecked}
                />
                {canMoveChecked ? (
                  <BulkAction
                    icon={<IconArrowsMove />}
                    label={t("move")}
                    onClick={() =>
                      openAssetAction(
                        "move",
                        movableChecked.map((item) => item.id)
                      )
                    }
                  />
                ) : null}
                {activeSource === "trash" && canRestore ? (
                  <BulkAction
                    icon={<IconRefresh />}
                    label={t("restore")}
                    disabled={bulkBusy}
                    onClick={() => void restoreChecked()}
                  />
                ) : null}
                {activeSource === "trash" ? (
                  canDeleteForever ? (
                    <BulkAction
                      icon={<IconTrash />}
                      label={t("deleteForever")}
                      disabled={bulkBusy}
                      destructive
                      onClick={() => setConfirmPermanentDeleteOpen(true)}
                    />
                  ) : null
                ) : canTrash ? (
                  <BulkAction
                    icon={<IconTrash />}
                    label={t("delete")}
                    disabled={bulkBusy}
                    destructive
                    onClick={() => void deleteChecked()}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => setCheckedIds(new Set())}
                  className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label={t("clearSelection")}
                >
                  <IconX className="size-3.5" />
                </button>
              </div>
            ) : null}

            <div
              className={cn(
                "relative overflow-auto",
                workbench ? "min-h-0 flex-1" : "min-h-[610px]"
              )}
              onScroll={(event) => {
                const target = event.currentTarget;
                if (
                  assetQuery.hasNextPage &&
                  !assetQuery.isFetching &&
                  !assetQuery.isError &&
                  target.scrollHeight - target.scrollTop - target.clientHeight < 240
                ) {
                  void assetQuery.fetchNextPage();
                }
              }}
            >
              {capabilities?.organize && activeSource !== "trash" ? (
                <p className="px-4 py-2 text-xs text-muted-foreground">{t("dragMoveHint")}</p>
              ) : null}
              {assetQuery.isLoading ? (
                <AssetLoadingState t={t} />
              ) : assetQuery.isError && !assetQuery.data ? (
                <AssetErrorState
                  error={assetQuery.error}
                  t={t}
                  pending={assetQuery.isFetching}
                  onRetry={() => void assetQuery.refetch()}
                />
              ) : viewMode === "list" ? (
                <AssetList
                  assetDragProps={assetDragProps}
                  dropTargetId={dropTargetId}
                  items={filteredItems}
                  checkedIds={checkedIds}
                  selectedAssetId={selectedAssetId}
                  creatingFolder={creatingFolder}
                  savingFolder={savingFolder}
                  newFolderName={newFolderName}
                  t={t}
                  onNewFolderNameChange={setNewFolderName}
                  onCancelNewFolder={() => {
                    setCreatingFolder(false);
                    setNewFolderName("");
                  }}
                  onSaveNewFolder={addFolder}
                  onSelect={selectAsset}
                  onOpenFolder={openFolder}
                  onToggleChecked={toggleChecked}
                  onToggleAll={toggleAll}
                  onToggleFavorite={toggleFavorite}
                />
              ) : (
                <AssetGrid
                  assetDragProps={assetDragProps}
                  dropTargetId={dropTargetId}
                  items={filteredItems}
                  checkedIds={checkedIds}
                  selectedAssetId={selectedAssetId}
                  t={t}
                  onSelect={selectAsset}
                  onOpenFolder={openFolder}
                  onToggleChecked={toggleChecked}
                  onToggleFavorite={toggleFavorite}
                />
              )}
              {assetQuery.isError && assetQuery.data && (
                <AssetErrorState
                  compact
                  pending={assetQuery.isFetching}
                  error={assetQuery.error}
                  t={t}
                  onRetry={() =>
                    void (assetQuery.isFetchNextPageError &&
                    !isCrewCursorError(assetQuery.error, "CREW_ASSET_CURSOR_INVALID")
                      ? assetQuery.fetchNextPage()
                      : assetQuery.refetch())
                  }
                />
              )}
            </div>

            <footer className="flex shrink-0 items-center justify-between border-t border-border/60 px-4 py-3 text-[11px] text-muted-foreground">
              <span>{t("itemCount", { count: filteredItems.length })}</span>
              {assetQuery.hasNextPage && !assetQuery.isError ? (
                <button
                  type="button"
                  disabled={assetQuery.isFetching}
                  onClick={() => void assetQuery.fetchNextPage()}
                  className="font-semibold text-foreground hover:text-primary disabled:opacity-50"
                >
                  {assetQuery.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
                </button>
              ) : (
                <span>
                  {assetQuery.isError
                    ? t("loadFailed")
                    : assetQuery.isFetching && !assetQuery.isLoading
                      ? t("syncing")
                      : t("syncComplete")}
                </span>
              )}
            </footer>
          </div>

          {inspectorOpen && selectedAsset ? (
            <AssetInspector
              crewId={crewId}
              asset={selectedAsset}
              t={t}
              onClose={() => {
                setInspectorOpen(false);
                onSelectedAssetChange?.(null);
              }}
              onToggleFavorite={() => toggleFavorite(selectedAsset.id)}
              onBindStudio={
                selectedAsset.kind !== "folder" &&
                hasAssetPermission(selectedAsset.effectivePermission, "manage")
                  ? () => {
                      setBindNodeId(selectedAsset.id);
                      setStudioDialogOpen(true);
                    }
                  : undefined
              }
              onUnlinkStudio={
                selectedAsset.linkedStudio &&
                hasAssetPermission(selectedAsset.effectivePermission, "manage")
                  ? () => {
                      setStudioLink.mutate(
                        { nodeId: selectedAsset.id, mediaAssetId: null },
                        {
                          onSuccess: () => toast.success(t("bindStudioSaved")),
                          onError: (error) =>
                            toast.error(describeError(error, t("operationFailed"))),
                        }
                      );
                    }
                  : undefined
              }
            />
          ) : null}
        </div>
      </section>
      <AssetActionDialog
        action={assetAction}
        assets={assetActionTargets}
        name={actionName}
        destinationId={destinationId}
        folders={(folderQuery.data ?? []).filter((folder) =>
          hasAssetPermission(folder.effectivePermission, "upload")
        )}
        foldersLoading={folderQuery.isPending}
        foldersError={
          folderQuery.isError ? describeError(folderQuery.error, t("operationFailed")) : null
        }
        foldersFetching={folderQuery.isFetching}
        onRetryFolders={() => void folderQuery.refetch()}
        pending={assetActionBusy}
        errors={assetActionErrors}
        t={t}
        onNameChange={setActionName}
        onDestinationChange={setDestinationId}
        onClose={() => {
          if (assetActionBusy) return;
          setAssetActionErrors([]);
          setAssetAction(null);
          setAssetActionTargets([]);
        }}
        onSubmit={() => void submitAssetAction()}
      />
      <LinkStudioMediaDialog
        open={studioDialogOpen}
        onOpenChange={(open) => {
          setStudioDialogOpen(open);
          if (!open) setBindNodeId(null);
        }}
        crewId={crewId}
        parentId={activeFolderId}
        bindNodeId={bindNodeId}
      />
      <AlertDialog open={confirmPermanentDeleteOpen} onOpenChange={setConfirmPermanentDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteForeverTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteForeverDescription", { count: checkedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy}
              variant="solid"
              color="destructive"
              onClick={() => {
                setConfirmPermanentDeleteOpen(false);
                void deleteChecked();
              }}
            >
              {t("deleteForever")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AssetSourceRail({
  crewName,
  workbench,
  activeSource,
  folderPath,
  context,
  contextLoading,
  t,
  onSelectSource,
  onOpenRoot,
  folders,
  foldersLoading,
  foldersError,
  onOpenFolder,
}: {
  crewName?: string;
  workbench: boolean;
  activeSource: CrewAssetSource;
  folderPath: FolderCrumb[];
  context?: {
    provider: "s3_compatible" | "aliyun_oss";
    storageAvailable: boolean;
    storageUsage?: {
      usedBytes: number;
      totalBytes: number;
      remainingBytes: number;
      reservedBytes: number;
      unknownSizeCount: number;
    };
  };
  contextLoading: boolean;
  t: Translation;
  onSelectSource: (source: CrewAssetSource) => void;
  onOpenRoot: () => void;
  folders: CrewAssetFolderDTO[];
  foldersLoading: boolean;
  foldersError: string | null;
  onOpenFolder: (path: FolderCrumb[]) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rootOpen, setRootOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const renderFolders = (parentId: string | null, path: FolderCrumb[] = []): ReactNode =>
    folders
      .filter(
        (folder) =>
          (folder.parentId === parentId ||
            (parentId === null && !folders.some((parent) => parent.id === folder.parentId))) &&
          !path.some((ancestor) => ancestor.id === folder.id)
      )
      .map((folder) => {
        const nextPath = [...path, { id: folder.id, name: folder.name }];
        const hasChildren = folders.some((child) => child.parentId === folder.id);
        const isOpen =
          !collapsed.has(folder.id) &&
          (expanded.has(folder.id) || folderPath.some((crumb) => crumb.id === folder.id));
        return (
          <div key={folder.id}>
            <div
              className={cn(
                "flex items-center rounded-lg text-xs",
                activeSource === "all" && folderPath.at(-1)?.id === folder.id
                  ? "bg-primary/12 text-primary"
                  : "text-muted-foreground"
              )}
              style={{ paddingLeft: path.length * 12 + 12 }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={folder.name}
                  aria-expanded={isOpen}
                  className="p-1"
                  onClick={() => {
                    setExpanded((current) => new Set(current).add(folder.id));
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (isOpen) next.add(folder.id);
                      else next.delete(folder.id);
                      return next;
                    });
                  }}
                >
                  <IconChevronDown
                    className={cn("size-3 transition-transform", !isOpen && "-rotate-90")}
                  />
                </button>
              ) : (
                <span className="w-5" />
              )}
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
                onClick={() => onOpenFolder(nextPath)}
              >
                <IconFolder className="size-3.5 shrink-0" />
                <span className="truncate">{folder.name}</span>
              </button>
            </div>
            {isOpen ? renderFolders(folder.id, nextPath) : null}
          </div>
        );
      });
  return (
    <aside className="hidden min-h-0 min-w-0 flex-col bg-[#0a0c0f] lg:flex">
      {workbench ? (
        <header className="flex h-[58px] shrink-0 items-center border-b border-border/60 px-4">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground">
              {crewName ?? t("title")}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{t("title")}</p>
          </div>
        </header>
      ) : null}
      <div className="space-y-0.5 border-b border-border/60 p-3">
        <SourceButton
          icon={<IconFolder />}
          label={t("allFiles")}
          active={activeSource === "all"}
          onClick={() => onSelectSource("all")}
        />
        <SourceButton
          icon={<IconClock />}
          label={t("recent")}
          active={activeSource === "recent"}
          onClick={() => onSelectSource("recent")}
        />
        <SourceButton
          icon={<IconStar />}
          label={t("favorites")}
          active={activeSource === "favorites"}
          onClick={() => onSelectSource("favorites")}
        />
        <SourceButton
          icon={<IconTrash />}
          label={t("trash")}
          active={activeSource === "trash"}
          onClick={() => onSelectSource("trash")}
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <button
          type="button"
          onClick={() => {
            setRootOpen((value) => !value);
            onOpenRoot();
          }}
          aria-expanded={rootOpen}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
            activeSource === "all" && folderPath.length === 0
              ? "bg-primary/12 font-semibold text-primary"
              : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
          )}
        >
          <IconChevronDown className="size-3" />
          <IconFolder className="size-3.5" />
          <span className="truncate">{t("folderCrewAssets")}</span>
        </button>
        {foldersError ? (
          <p role="alert" className="p-2 text-xs text-destructive">
            {foldersError}
          </p>
        ) : null}
        {foldersLoading ? (
          <IconLoader2 className="m-2 size-4 animate-spin" />
        ) : rootOpen ? (
          renderFolders(null)
        ) : null}
      </div>
      <div className="border-t border-border/60 p-3">
        <div className="flex items-center gap-2">
          <IconDatabase className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-[11px] text-foreground">
              {context
                ? t(context.provider === "aliyun_oss" ? "providerOss" : "providerR2")
                : t("storageManaged")}
            </p>
            <p
              className={cn(
                "mt-0.5 text-[10px]",
                context?.storageAvailable ? "text-emerald-400" : "text-muted-foreground"
              )}
            >
              {contextLoading
                ? t("storageChecking")
                : context?.storageAvailable
                  ? t("storageAvailable")
                  : t("storageUnavailable")}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SourceButton({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
        active
          ? "bg-secondary/60 font-semibold text-foreground"
          : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
      )}
    >
      <span className="[&>svg]:size-3.5">{icon}</span>
      {label}
    </button>
  );
}

function AssetList({
  assetDragProps,
  dropTargetId,
  items,
  checkedIds,
  selectedAssetId,
  creatingFolder,
  savingFolder,
  newFolderName,
  t,
  onNewFolderNameChange,
  onCancelNewFolder,
  onSaveNewFolder,
  onSelect,
  onOpenFolder,
  onToggleChecked,
  onToggleAll,
  onToggleFavorite,
}: {
  assetDragProps: (item: CrewAssetPreviewItem) => HTMLAttributes<HTMLElement>;
  dropTargetId: string | null;
  items: CrewAssetPreviewItem[];
  checkedIds: Set<string>;
  selectedAssetId: string;
  creatingFolder: boolean;
  savingFolder: boolean;
  newFolderName: string;
  t: Translation;
  onNewFolderNameChange: (value: string) => void;
  onCancelNewFolder: () => void;
  onSaveNewFolder: () => void;
  onSelect: (item: CrewAssetPreviewItem) => void;
  onOpenFolder: (item: CrewAssetPreviewItem) => void;
  onToggleChecked: (id: string) => void;
  onToggleAll: () => void;
  onToggleFavorite: (id: string) => void;
}) {
  const allChecked = items.length > 0 && checkedIds.size === items.length;
  const gridColumns =
    "grid-cols-[36px_minmax(180px,1.7fr)_64px_88px_116px_56px] xl:grid-cols-[36px_minmax(260px,1.8fr)_100px_minmax(130px,1fr)_144px_90px_64px]";

  return (
    <div className="min-w-[540px] xl:min-w-[760px]">
      <div
        className={cn(
          "grid items-center border-b border-border/60 px-2 text-[11px] text-muted-foreground",
          gridColumns
        )}
      >
        <div className="grid h-10 place-items-center">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={onToggleAll}
            aria-label={t("selectAll")}
            className="size-3.5 accent-primary"
          />
        </div>
        <span>{t("columnName")}</span>
        <span>{t("columnType")}</span>
        <span>{t("columnContributor")}</span>
        <span>{t("columnModified")}</span>
        <span className="hidden xl:block">{t("columnSize")}</span>
        <span />
      </div>

      {creatingFolder ? (
        <form
          className={cn(
            "grid items-center border-b border-primary/30 bg-primary/5 px-2",
            gridColumns
          )}
          onSubmit={(event) => {
            event.preventDefault();
            onSaveNewFolder();
          }}
        >
          <span />
          <div className="flex items-center gap-2 py-2">
            <IconFolder className="size-5 shrink-0 fill-amber-300/15 text-amber-300/80" />
            <input
              autoFocus
              disabled={savingFolder}
              value={newFolderName}
              onChange={(event) => onNewFolderNameChange(event.target.value)}
              placeholder={t("folderNamePlaceholder")}
              className="h-7 min-w-0 flex-1 rounded-md border border-primary/40 bg-background px-2 text-xs outline-none"
            />
          </div>
          <span className="text-[11px] text-muted-foreground">{t("typeFolder")}</span>
          <span />
          <span />
          <span className="hidden xl:block" />
          <div className="flex items-center justify-end gap-1">
            <button
              type="submit"
              disabled={savingFolder || !newFolderName.trim()}
              className="rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground"
            >
              {t("save")}
            </button>
            <button
              type="button"
              disabled={savingFolder}
              onClick={onCancelNewFolder}
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-secondary"
              aria-label={t("cancel")}
            >
              <IconX className="size-3" />
            </button>
          </div>
        </form>
      ) : null}

      {items.map((item) => {
        const selected = selectedAssetId === item.id;
        const checked = checkedIds.has(item.id);
        return (
          <div
            key={item.id}
            {...assetDragProps(item)}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(item)}
            onDoubleClick={() => onOpenFolder(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (item.kind === "folder") onOpenFolder(item);
                else onSelect(item);
              }
              if (event.key === " ") {
                event.preventDefault();
                onSelect(item);
              }
            }}
            className={cn(
              dropTargetId === item.id && "bg-primary/15 ring-2 ring-inset ring-primary",
              "group grid min-h-11 cursor-pointer items-center border-b border-border/45 px-2 text-xs outline-none transition-colors",
              gridColumns,
              selected
                ? "border-l-2 border-l-primary bg-primary/8"
                : "border-l-2 border-l-transparent hover:bg-secondary/25 focus:bg-secondary/25"
            )}
          >
            <div
              className="grid h-full place-items-center"
              onClick={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleChecked(item.id)}
                aria-label={t("selectItem", { name: displayName(item, t) })}
                className="size-3.5 accent-primary"
              />
            </div>
            <div className="flex min-w-0 items-center gap-2 py-2">
              <AssetThumbnail item={item} compact />
              <span className="truncate font-medium text-foreground">{displayName(item, t)}</span>
              {item.linkedStudio ? (
                <span className="shrink-0 rounded bg-primary/12 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                  {t("linkedStudio")}
                </span>
              ) : null}
            </div>
            <span className="truncate text-[11px] text-muted-foreground">
              {t(item.typeLabelKey)}
            </span>
            <div className="flex min-w-0 items-center gap-1.5">
              <UserAvatar
                seed={item.contributorSeed}
                name={item.contributor}
                size={20}
                className="shrink-0"
              />
              <span className="truncate text-[11px] text-muted-foreground">{item.contributor}</span>
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {item.modifiedAt}
            </span>
            <span className="hidden text-[11px] tabular-nums text-muted-foreground xl:block">
              {item.size}
            </span>
            <div
              className="flex items-center justify-end gap-0.5"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => onToggleFavorite(item.id)}
                className={cn(
                  "grid size-7 place-items-center rounded-md transition-colors hover:bg-secondary",
                  item.favorite ? "text-primary" : "text-muted-foreground"
                )}
                aria-label={item.favorite ? t("removeFavorite") : t("addFavorite")}
              >
                {item.favorite ? (
                  <IconStarFilled className="size-3.5" />
                ) : (
                  <IconStar className="size-3.5" />
                )}
              </button>
            </div>
          </div>
        );
      })}

      {items.length === 0 ? <AssetEmptyState t={t} /> : null}
    </div>
  );
}

function AssetGrid({
  assetDragProps,
  dropTargetId,
  items,
  checkedIds,
  selectedAssetId,
  t,
  onSelect,
  onOpenFolder,
  onToggleChecked,
  onToggleFavorite,
}: {
  assetDragProps: (item: CrewAssetPreviewItem) => HTMLAttributes<HTMLElement>;
  dropTargetId: string | null;
  items: CrewAssetPreviewItem[];
  checkedIds: Set<string>;
  selectedAssetId: string;
  t: Translation;
  onSelect: (item: CrewAssetPreviewItem) => void;
  onOpenFolder: (item: CrewAssetPreviewItem) => void;
  onToggleChecked: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}) {
  if (items.length === 0) return <AssetEmptyState t={t} />;

  return (
    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 2xl:grid-cols-4">
      {items.map((item) => {
        const selected = selectedAssetId === item.id;
        const checked = checkedIds.has(item.id);
        return (
          <article
            key={item.id}
            {...assetDragProps(item)}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(item)}
            onDoubleClick={() => onOpenFolder(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (item.kind === "folder") onOpenFolder(item);
                else onSelect(item);
              }
              if (event.key === " ") {
                event.preventDefault();
                onSelect(item);
              }
            }}
            className={cn(
              dropTargetId === item.id && "bg-primary/15 ring-2 ring-inset ring-primary",
              "group relative cursor-pointer overflow-hidden rounded-xl border bg-card/35 outline-none transition-all",
              selected
                ? "border-primary ring-1 ring-primary/30"
                : "border-border/60 hover:border-border hover:bg-card/60"
            )}
          >
            <div
              className="absolute left-2 top-2 z-10"
              onClick={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleChecked(item.id)}
                aria-label={t("selectItem", { name: displayName(item, t) })}
                className={cn(
                  "size-4 accent-primary transition-opacity",
                  checked ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
              />
            </div>
            <div className="aspect-[4/3] bg-secondary/25">
              <AssetThumbnail item={item} />
            </div>
            <div className="p-3">
              <div className="flex min-w-0 items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-xs font-semibold text-foreground">
                    {displayName(item, t)}
                  </h3>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {t(item.typeLabelKey)} · {item.modifiedAt}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(item.id);
                  }}
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-md",
                    item.favorite ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                  aria-label={item.favorite ? t("removeFavorite") : t("addFavorite")}
                >
                  {item.favorite ? (
                    <IconStarFilled className="size-3.5" />
                  ) : (
                    <IconStar className="size-3.5" />
                  )}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AssetThumbnail({
  item,
  compact = false,
}: {
  item: CrewAssetPreviewItem;
  compact?: boolean;
}) {
  if (item.kind === "folder") {
    return (
      <div
        className={cn(
          "grid shrink-0 place-items-center text-amber-300/80",
          compact ? "size-6" : "size-full"
        )}
      >
        <IconFolder
          className={cn("fill-amber-300/15", compact ? "size-5" : "size-16")}
          stroke={1.5}
        />
      </div>
    );
  }

  if (item.thumbnail) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.thumbnail}
        alt=""
        className={cn(
          "shrink-0 object-cover",
          compact ? "size-7 rounded" : "size-full",
          item.kind === "pdf" && !compact && "object-contain p-2"
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center text-muted-foreground",
        compact ? "size-7 rounded bg-secondary/60" : "size-full"
      )}
    >
      <KindIcon kind={item.kind} className={compact ? "size-4" : "size-10"} />
    </div>
  );
}

function AssetInspector({
  crewId,
  asset,
  t,
  onClose,
  onToggleFavorite,
  onBindStudio,
  onUnlinkStudio,
}: {
  crewId: string;
  asset: CrewAssetPreviewItem;
  t: Translation;
  onClose: () => void;
  onToggleFavorite: () => void;
  onBindStudio?: () => void;
  onUnlinkStudio?: () => void;
}) {
  return (
    <aside
      aria-label={t("previewPanelLabel")}
      className="hidden min-w-0 flex-col border-l border-border/60 bg-[#0a0c0f] lg:flex"
    >
      <div className="flex h-12 items-center gap-2 border-b border-border/60 px-3">
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {displayName(asset, t)}
        </h2>
        <button
          type="button"
          onClick={onToggleFavorite}
          className={cn(
            "grid size-7 place-items-center rounded-md",
            asset.favorite ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
          aria-label={asset.favorite ? t("removeFavorite") : t("addFavorite")}
        >
          {asset.favorite ? <IconStarFilled className="size-4" /> : <IconStar className="size-4" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label={t("closePreview")}
        >
          <IconX className="size-4" />
        </button>
      </div>

      <div className="border-b border-border/60 bg-black/20">
        <div className="flex aspect-[16/10] items-center justify-center overflow-hidden p-3">
          {asset.kind === "image" && asset.mediaUrl ? (
            <div className="relative flex size-full items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.mediaUrl}
                alt={displayName(asset, t)}
                className="max-h-full max-w-full rounded-sm object-contain"
              />
            </div>
          ) : asset.kind === "video" && asset.mediaUrl ? (
            <video
              src={asset.mediaUrl}
              controls
              preload="metadata"
              className="max-h-full max-w-full rounded-sm"
            />
          ) : asset.kind === "audio" && asset.mediaUrl ? (
            <div className="flex w-full flex-col items-center gap-5 px-4">
              <div className="grid size-20 place-items-center rounded-2xl bg-secondary/50 text-muted-foreground">
                <IconMusic className="size-9" />
              </div>
              <audio src={asset.mediaUrl} controls preload="metadata" className="w-full" />
            </div>
          ) : asset.kind === "pdf" && asset.mediaUrl ? (
            <iframe
              src={asset.mediaUrl}
              title={displayName(asset, t)}
              className="size-full rounded-sm bg-white"
            />
          ) : (
            <div className="grid size-24 place-items-center rounded-2xl bg-secondary/40 text-muted-foreground">
              <KindIcon kind={asset.kind} className="size-10" />
            </div>
          )}
        </div>
        <div className="flex h-10 items-center justify-between border-t border-border/50 px-3">
          <span className="rounded-md bg-secondary/70 px-2 py-1 text-[10px] text-foreground">
            {t(asset.typeLabelKey)}
          </span>
          {asset.mediaUrl ? (
            <a
              href={asset.mediaUrl}
              download={asset.name}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <IconDownload className="size-3.5" />
              {t("download")}
            </a>
          ) : null}
        </div>
      </div>

      <div className="border-b border-border/60">
        <div className="relative flex h-11 items-center justify-center text-[11px] font-semibold text-foreground after:absolute after:inset-x-5 after:bottom-0 after:h-0.5 after:bg-primary">
          {t("tabInfo")}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        <InfoPanel asset={asset} t={t} />
        {asset.kind !== "folder" && (onBindStudio || onUnlinkStudio || asset.linkedStudio) ? (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-foreground">{t("linkedStudio")}</p>
            <p className="text-[10px] leading-4 text-muted-foreground">
              {asset.linkedStudio ? t("linkedStudio") : t("linkStudioSelect")}
            </p>
            <div className="flex flex-wrap gap-2">
              {onBindStudio ? (
                <button
                  type="button"
                  onClick={onBindStudio}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-secondary px-2 text-[10px] font-semibold text-foreground"
                >
                  <IconLink className="size-3.5" />
                  {t("linkExisting")}
                </button>
              ) : null}
              {onUnlinkStudio ? (
                <button
                  type="button"
                  onClick={onUnlinkStudio}
                  className="inline-flex h-7 items-center rounded-md px-2 text-[10px] font-semibold text-muted-foreground hover:bg-secondary"
                >
                  {t("unlinkStudio")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <PermissionSummary key={asset.id} crewId={crewId} asset={asset} t={t} />
      </div>
    </aside>
  );
}

function PermissionSummary({
  crewId,
  asset,
  t,
}: {
  crewId: string;
  asset: CrewAssetPreviewItem;
  t: Translation;
}) {
  const permissions = useCrewAssetPermissions(crewId, asset.id);
  const permissionEvents = useCrewAssetPermissionEvents(
    crewId,
    asset.id,
    permissions.data?.canManage === true
  );
  const setPermissions = useSetCrewAssetPermissions(crewId);
  const members = useCrewMembers(crewId);
  const membersIncomplete = members.isPending || members.isError || members.hasNextPage;
  const memberIds = (members.data ?? []).map((member) => member.userId);
  const actorIds = (permissionEvents.data ?? []).map((event) => event.actorUserId);
  const displays = useUserDisplays([...new Set([...memberIds, ...actorIds])]);
  const [editing, setEditing] = useState(false);
  const savePending = useRef(false);
  const [restricted, setRestricted] = useState(false);
  const [editPermissionVersion, setEditPermissionVersion] = useState<number | null>(null);
  const [draftGrants, setDraftGrants] = useState<
    Array<{ userId: string; permission: CrewAssetPermission }>
  >([]);

  const beginEdit = () => {
    if (!permissions.data?.canManage) return;
    setRestricted(permissions.data.accessMode === "restricted");
    setEditPermissionVersion(permissions.data.permissionVersion);
    setDraftGrants(
      permissions.data.grants.map((grant) => ({
        userId: grant.userId,
        permission: grant.permission,
      }))
    );
    setEditing(true);
  };

  const save = async () => {
    const current = permissions.data;
    if (
      !current?.canManage ||
      editPermissionVersion === null ||
      (restricted && membersIncomplete) ||
      savePending.current
    )
      return;
    savePending.current = true;
    try {
      await setPermissions.mutateAsync({
        nodeId: asset.id,
        accessMode: restricted ? "restricted" : "inherit",
        expectedVersion: editPermissionVersion,
        grants: restricted ? draftGrants : [],
      });
      setEditing(false);
      toast.success(t("permissionsSaved"));
    } catch (error) {
      toast.error(describeError(error, t("operationFailed")));
    } finally {
      savePending.current = false;
    }
  };

  const updateGrant = (userId: string, permission: CrewAssetPermission | "none") => {
    setDraftGrants((current) => {
      const without = current.filter((grant) => grant.userId !== userId);
      return permission === "none" ? without : [...without, { userId, permission }];
    });
  };

  if (permissions.isLoading) {
    return (
      <div className="border-t border-border/60 pt-4 text-[10px] text-muted-foreground">
        {t("permissionsLoading")}
      </div>
    );
  }
  if (permissions.isError || !permissions.data) {
    return (
      <div role="alert" className="border-t border-border/60 pt-4 text-[10px] text-destructive">
        <p>{describeError(permissions.error, t("permissionsLoadFailed"))}</p>
        <button
          type="button"
          disabled={permissions.isFetching}
          onClick={() => void permissions.refetch()}
          className="mt-2 text-[10px] font-semibold text-primary hover:underline disabled:opacity-50"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  const data = permissions.data;
  return (
    <div className="border-t border-border/60 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">{t("inheritanceTitle")}</h3>
        {data.canManage && !editing ? (
          <button
            type="button"
            onClick={beginEdit}
            className="text-[10px] font-semibold text-primary hover:underline"
          >
            {t("manageAccess")}
          </button>
        ) : null}
      </div>
      <div className="mt-3 rounded-xl bg-secondary/25 p-3">
        <div className="flex items-start gap-2">
          {data.accessMode === "restricted" ? (
            <IconLock className="mt-0.5 size-4 shrink-0 text-primary" />
          ) : (
            <IconLockOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div>
            <p className="text-[11px] font-medium text-foreground">
              {t(data.accessMode === "restricted" ? "restrictedAccess" : "inheritedAccess")}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              {t(
                data.accessMode === "restricted"
                  ? "restrictedAccessDescription"
                  : "crewAccessDescription"
              )}
            </p>
          </div>
        </div>
      </div>
      {editing ? (
        <div className="mt-3 space-y-3">
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/60 p-2.5">
            <input
              type="checkbox"
              disabled={setPermissions.isPending}
              checked={restricted}
              onChange={(event) => setRestricted(event.target.checked)}
              className="mt-0.5 size-3.5 accent-primary"
            />
            <span>
              <span className="block text-[11px] font-medium text-foreground">
                {t("restrictAccess")}
              </span>
              <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                {t("restrictAccessHint")}
              </span>
            </span>
          </label>
          {restricted ? (
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {members.isError ? (
                <div role="alert" className="text-[10px] text-destructive">
                  <p>{describeError(members.error, t("loadFailed"))}</p>
                  <button
                    type="button"
                    disabled={members.isFetching}
                    onClick={() => void members.refetch()}
                    className="mt-2 font-semibold text-primary hover:underline disabled:opacity-50"
                  >
                    {t("retry")}
                  </button>
                </div>
              ) : membersIncomplete ? (
                <p role="status" className="text-[10px] text-muted-foreground">
                  {t("loading")}
                </p>
              ) : null}
              {(members.data ?? []).map((member) => {
                const permission =
                  draftGrants.find((grant) => grant.userId === member.userId)?.permission ?? "none";
                return (
                  <div
                    key={member.userId}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary/25"
                  >
                    <UserAvatar
                      seed={`crew-asset-permission-${member.userId}`}
                      name={displayNameOf(member.userId, displays)}
                      size={24}
                    />
                    <span className="min-w-0 flex-1 truncate text-[10px] text-foreground">
                      {displayNameOf(member.userId, displays)}
                    </span>
                    <NativeSelect
                      disabled={setPermissions.isPending}
                      value={permission}
                      onChange={(nextValue) =>
                        updateGrant(member.userId, nextValue as CrewAssetPermission | "none")
                      }
                      size="sm"
                      className="h-7 w-28 border-border/70 bg-background px-1.5 text-[10px] text-foreground"
                      aria-label={t("memberPermission", {
                        name: displayNameOf(member.userId, displays),
                      })}
                    >
                      <option value="none">{t("noAccess")}</option>
                      <option value="view">{t("permissionView")}</option>
                      <option value="upload">{t("permissionUpload")}</option>
                      <option value="edit">{t("permissionEdit")}</option>
                      <option value="manage">{t("permissionManage")}</option>
                    </NativeSelect>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={setPermissions.isPending}
              onClick={() => setEditing(false)}
              className="h-7 rounded-md px-2 text-[10px] font-semibold text-muted-foreground hover:bg-secondary"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              disabled={setPermissions.isPending || (restricted && membersIncomplete)}
              onClick={() => void save()}
              className="h-7 rounded-md bg-primary px-2.5 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {setPermissions.isPending ? t("savingPermissions") : t("savePermissions")}
            </button>
          </div>
        </div>
      ) : data.accessMode === "restricted" ? (
        <div className="mt-3 space-y-1.5">
          {data.grants.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">{t("ownerOnlyAccess")}</p>
          ) : (
            data.grants.map((grant) => (
              <div key={grant.id} className="flex items-center gap-2 py-1">
                <UserAvatar
                  seed={`crew-asset-permission-${grant.userId}`}
                  name={displayNameOf(grant.userId, displays)}
                  size={22}
                />
                <span className="min-w-0 flex-1 truncate text-[10px] text-foreground">
                  {displayNameOf(grant.userId, displays)}
                </span>
                <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  {t(`permission${capitalizePermission(grant.permission)}`)}
                </span>
              </div>
            ))
          )}
        </div>
      ) : (
        <p className="mt-3 text-[10px] leading-4 text-muted-foreground">{t("inheritanceHint")}</p>
      )}
      {data.canManage && (permissionEvents.data?.length ?? 0) > 0 ? (
        <div className="mt-4 border-t border-border/50 pt-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
            <IconHistory className="size-3.5" />
            {t("accessHistory")}
          </div>
          <div className="mt-2 space-y-2">
            {permissionEvents.data?.slice(0, 5).map((event) => (
              <div key={event.id} className="text-[10px] leading-4 text-muted-foreground">
                <p>
                  {t("accessChanged", {
                    actor: displayNameOf(event.actorUserId, displays),
                    before: t(
                      event.previousMode === "restricted" ? "restrictedAccess" : "inheritedAccess"
                    ),
                    after: t(
                      event.nextMode === "restricted" ? "restrictedAccess" : "inheritedAccess"
                    ),
                  })}
                </p>
                <time className="text-[9px] text-muted-foreground/70">
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(event.createdAt))}
                </time>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InfoPanel({ asset, t }: { asset: CrewAssetPreviewItem; t: Translation }) {
  const rows = [
    [t("infoType"), t(asset.typeLabelKey)],
    [t("infoSize"), asset.size],
    [t("infoContributor"), asset.contributor],
    [t("infoModified"), asset.modifiedAt],
    [t("infoContentType"), asset.contentType ?? "—"],
  ];
  return (
    <div className="space-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[88px_1fr] gap-3 py-2 text-[11px]">
          <span className="text-muted-foreground">{label}</span>
          <span className="truncate text-foreground">{value}</span>
        </div>
      ))}
    </div>
  );
}

function AssetActionDialog({
  action,
  assets,
  name,
  destinationId,
  folders,
  foldersLoading,
  foldersError,
  foldersFetching,
  onRetryFolders,
  pending,
  errors,
  t,
  onNameChange,
  onDestinationChange,
  onClose,
  onSubmit,
}: {
  action: AssetAction | null;
  assets: CrewAssetPreviewItem[];
  name: string;
  destinationId: string;
  folders: CrewAssetFolderDTO[];
  foldersLoading: boolean;
  foldersError: string | null;
  foldersFetching: boolean;
  onRetryFolders: () => void;
  pending: boolean;
  errors: string[];
  t: Translation;
  onNameChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const common = useTranslations("common");
  const moveBlocked = action === "move" && (foldersLoading || Boolean(foldersError));
  const moveCount = assets.length;
  const excludedFolderIds = useMemo(
    () => assets.filter((asset) => asset.kind === "folder").map((asset) => asset.id),
    [assets]
  );
  const options = useMemo(
    () => buildFolderOptions(folders, excludedFolderIds),
    [excludedFolderIds, folders]
  );
  return (
    <Dialog open={action !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {action === "move"
                ? t("moveTitle", { count: Math.max(moveCount, 1) })
                : t("renameTitle")}
            </DialogTitle>
            <DialogDescription>
              {action === "move"
                ? t("moveDescription", { count: Math.max(moveCount, 1) })
                : t("renameDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {action === "move" && foldersLoading && <p role="status">{common("loading")}</p>}
            {action === "move" && foldersError && (
              <div role="alert" className="mb-3 space-y-2 text-sm text-destructive">
                <p>{foldersError}</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || foldersFetching}
                  onClick={onRetryFolders}
                >
                  {common("retry")}
                </Button>
              </div>
            )}
            {errors.length ? (
              <ul role="alert" className="mb-3 max-h-40 overflow-auto text-xs text-destructive">
                {errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            ) : null}
            {action === "rename" ? (
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium text-foreground">
                  {t("columnName")}
                </span>
                <input
                  autoFocus
                  aria-label={t("columnName")}
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary/60"
                />
              </label>
            ) : (
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium text-foreground">
                  {t("destination")}
                </span>
                <NativeSelect
                  disabled={pending || moveBlocked}
                  aria-label={t("destination")}
                  value={destinationId}
                  onChange={onDestinationChange}
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary/60"
                >
                  <option value="">{t("folderCrewAssets")}</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              color="muted"
              disabled={pending}
              onClick={onClose}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant="solid"
              color="primary"
              loading={pending}
              disabled={pending || moveBlocked || (action === "rename" && !name.trim())}
            >
              {action === "move" ? t("move") : t("rename")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToolbarSelect({
  ariaLabel,
  value,
  options,
  icon,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: [string, string][];
  icon?: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative flex h-8 items-center rounded-lg text-xs text-muted-foreground">
      {icon ? (
        <span className="pointer-events-none absolute left-2 z-10 [&>svg]:size-3.5">{icon}</span>
      ) : null}
      <NativeSelect
        aria-label={ariaLabel}
        value={value}
        onChange={onChange}
        className={cn(
          "h-8 w-auto border-border/70 bg-background/60 py-0 text-[11px] text-muted-foreground focus-visible:border-primary/60",
          icon && "pl-7"
        )}
      >
        {options.map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue} className="bg-card text-foreground">
            {label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function buildFolderOptions(
  folders: CrewAssetFolderDTO[],
  excludedFolderIds: string[] = []
): Array<{ id: string; label: string }> {
  const blocked = new Set<string>(excludedFolderIds);
  if (blocked.size > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders) {
        if (folder.parentId && blocked.has(folder.parentId) && !blocked.has(folder.id)) {
          blocked.add(folder.id);
          changed = true;
        }
      }
    }
  }
  const byParent = new Map<string | null, CrewAssetFolderDTO[]>();
  for (const folder of folders) {
    if (blocked.has(folder.id)) continue;
    const parent = folder.parentId && !blocked.has(folder.parentId) ? folder.parentId : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(folder);
    byParent.set(parent, siblings);
  }
  const result: Array<{ id: string; label: string }> = [];
  const visit = (parentId: string | null, prefix: string) => {
    for (const folder of byParent.get(parentId) ?? []) {
      const label = prefix ? `${prefix} / ${folder.name}` : folder.name;
      result.push({ id: folder.id, label });
      visit(folder.id, label);
    }
  };
  visit(null, "");
  return result;
}

function ViewModeButton({
  active,
  label,
  children,
  onClick,
}: {
  active: boolean;
  label: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "grid size-7 place-items-center rounded-md transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function BulkAction({
  icon,
  label,
  destructive = false,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] transition-colors disabled:opacity-50 [&>svg]:size-3.5",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function AssetEmptyState({ t }: { t: Translation }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-secondary/60 text-muted-foreground">
        <IconSearch className="size-5" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{t("emptyTitle")}</h3>
      <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{t("emptyBody")}</p>
    </div>
  );
}

function AssetLoadingState({ t }: { t: Translation }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-xs text-muted-foreground"
    >
      <div className="size-6 animate-spin rounded-full border-2 border-secondary border-t-primary" />
      <span>{t("loading")}</span>
    </div>
  );
}

function AssetErrorState({
  error,
  t,
  onRetry,
  compact = false,
  pending = false,
}: {
  compact?: boolean;
  pending?: boolean;
  error: unknown;
  t: Translation;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        compact ? "py-6" : "min-h-[420px]"
      )}
    >
      <div className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <IconFile className="size-5" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{t("loadFailed")}</h3>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
        {describeError(error, t("operationFailed"))}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={onRetry}
        className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
      >
        <IconRefresh className="size-3.5" />
        {t("retry")}
      </button>
    </div>
  );
}

function KindIcon({ kind, className }: { kind: CrewAssetKind; className?: string }) {
  if (kind === "folder") return <IconFolder className={className} />;
  if (kind === "image" || kind === "design") return <IconPhoto className={className} />;
  if (kind === "video") return <IconVideo className={className} />;
  if (kind === "audio") return <IconMusic className={className} />;
  if (kind === "pdf" || kind === "doc") return <IconFileText className={className} />;
  return <IconFile className={className} />;
}

function displayName(item: CrewAssetPreviewItem, t: Translation): string {
  return item.kind === "folder" && item.name.startsWith("folder") ? t(item.name) : item.name;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function mapAssetNode(node: CrewAssetNodeDTO, contributor: string): CrewAssetPreviewItem {
  const kind = kindFromMedia(node);
  const mediaUrl = node.media?.previewUrl;
  return {
    id: node.id,
    parentId: node.parentId,
    kind,
    name: node.name,
    typeLabelKey: typeLabelKeyFor(kind),
    contributor,
    contributorSeed: `crew-asset-user-${node.updatedByUserId}`,
    updatedAt: node.updatedAt,
    modifiedAt: formatTimestamp(node.updatedAt),
    size:
      node.kind === "folder" || node.media?.sizeBytes == null
        ? "—"
        : formatBytes(node.media.sizeBytes),
    thumbnail: kind === "image" ? mediaUrl : undefined,
    mediaUrl,
    contentType: node.media?.contentType,
    favorite: node.favorite,
    linkedStudio: node.linkedStudio ?? null,
    accessMode: node.accessMode,
    permissionVersion: node.permissionVersion,
    effectivePermission: node.effectivePermission,
    contractLocked: node.contractLocked,
  };
}

function capitalizePermission(permission: CrewAssetPermission) {
  return `${permission.slice(0, 1).toUpperCase()}${permission.slice(1)}`;
}

const ASSET_PERMISSION_RANK: Record<CrewAssetPermission, number> = {
  view: 10,
  upload: 30,
  edit: 50,
  manage: 100,
};

function hasAssetPermission(
  actual: CrewAssetPermission | null | undefined,
  required: CrewAssetPermission
) {
  return actual != null && ASSET_PERMISSION_RANK[actual] >= ASSET_PERMISSION_RANK[required];
}

function kindFromMedia(node: CrewAssetNodeDTO): CrewAssetKind {
  if (node.kind === "folder") return "folder";
  const contentType = node.media?.contentType.toLowerCase() ?? "";
  if (contentType === "application/pdf") return "pdf";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (
    contentType === "application/vnd.adobe.photoshop" ||
    contentType === "application/postscript"
  ) {
    return "design";
  }
  return "doc";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function typeLabelKeyFor(kind: CrewAssetKind): string {
  const keys: Record<CrewAssetKind, string> = {
    folder: "typeFolder",
    pdf: "typePdf",
    image: "typeImage",
    video: "typeVideo",
    audio: "typeAudio",
    design: "typeDesign",
    doc: "typeDocument",
  };
  return keys[kind];
}
