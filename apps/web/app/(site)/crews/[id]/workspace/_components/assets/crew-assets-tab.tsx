"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconArrowsMove,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconCopy,
  IconDatabase,
  IconDownload,
  IconDots,
  IconEye,
  IconFile,
  IconFileText,
  IconFolder,
  IconFolderPlus,
  IconLayoutGrid,
  IconList,
  IconMaximize,
  IconMusic,
  IconPhoto,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconUpload,
  IconVideo,
  IconX,
  IconZoomIn,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { useTranslations } from "@/src/i18n/i18n";
import {
  CREW_ASSET_FOLDER_TREE,
  CREW_ASSET_PERMISSION_GROUPS,
  CREW_ASSET_PREVIEW_ITEMS,
  type CrewAssetFolderNode,
  type CrewAssetKind,
  type CrewAssetPreviewItem,
} from "@/app/(site)/crews/[id]/workspace/_data/asset-center-preview";

type AssetViewMode = "list" | "grid";
type InspectorTab = "info" | "versions" | "comments" | "permissions";
type Translation = ReturnType<typeof useTranslations>;

const DEFAULT_ASSET_ID = "storyboard-v03";

interface CrewAssetsTabProps {
  crewId: string;
}

export function CrewAssetsTab({ crewId }: CrewAssetsTabProps) {
  const t = useTranslations("crewAssets");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<CrewAssetPreviewItem[]>(CREW_ASSET_PREVIEW_ITEMS);
  const [viewMode, setViewMode] = useState<AssetViewMode>("list");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | CrewAssetKind>("all");
  const [sort, setSort] = useState<"modified" | "name" | "size">("modified");
  const [activeFolderId, setActiveFolderId] = useState("script-storyboard");
  const [expandedFolderIds, setExpandedFolderIds] = useState(
    () => new Set(["crew-assets", "episode-01"])
  );
  const [selectedAssetId, setSelectedAssetId] = useState(DEFAULT_ASSET_ID);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("permissions");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const updateViewMode = (next: AssetViewMode) => {
    setViewMode(next);
  };

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return [...items]
      .filter((item) => typeFilter === "all" || item.kind === typeFilter)
      .filter((item) => {
        const displayName = item.kind === "folder" ? t(item.name) : item.name;
        return (
          !normalized ||
          displayName.toLocaleLowerCase().includes(normalized) ||
          t(item.taskLabelKey).toLocaleLowerCase().includes(normalized) ||
          item.contributor.toLocaleLowerCase().includes(normalized)
        );
      })
      .sort((a, b) => {
        if (a.kind === "folder" && b.kind !== "folder") return -1;
        if (a.kind !== "folder" && b.kind === "folder") return 1;
        if (sort === "name") return displayName(a, t).localeCompare(displayName(b, t));
        if (sort === "size") return a.size.localeCompare(b.size, undefined, { numeric: true });
        return b.modifiedAt.localeCompare(a.modifiedAt);
      });
  }, [items, query, sort, t, typeFilter]);

  const selectedAsset =
    items.find((item) => item.id === selectedAssetId) ??
    items.find((item) => item.kind !== "folder") ??
    items[0];

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
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, favorite: !item.favorite } : item))
    );
  };

  const selectAsset = (item: CrewAssetPreviewItem) => {
    setSelectedAssetId(item.id);
    setInspectorOpen(true);
  };

  const deleteChecked = () => {
    if (checkedIds.size === 0) return;
    setItems((current) => current.filter((item) => !checkedIds.has(item.id)));
    if (checkedIds.has(selectedAssetId)) {
      const fallback = items.find((item) => !checkedIds.has(item.id) && item.kind !== "folder");
      if (fallback) setSelectedAssetId(fallback.id);
    }
    toast.success(t("deleted", { count: checkedIds.size }));
    setCheckedIds(new Set());
  };

  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    setItems((current) => [
      {
        id: `folder-local-${Date.now()}`,
        kind: "folder",
        name,
        typeLabelKey: "typeFolder",
        taskLabelKey: "taskStoryboard",
        contributor: t("currentUser"),
        contributorSeed: `crew-assets-${crewId}-current-user`,
        modifiedAt: formatNow(),
        size: "—",
      },
      ...current,
    ]);
    setCreatingFolder(false);
    setNewFolderName("");
    toast.success(t("folderCreated"));
  };

  const addUploadedFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const additions = Array.from(files).map<CrewAssetPreviewItem>((file, index) => {
      const kind = kindFromFile(file);
      return {
        id: `upload-${Date.now()}-${index}`,
        kind,
        name: file.name,
        typeLabelKey: typeLabelKeyFor(kind),
        taskLabelKey: "taskStoryboard",
        contributor: t("currentUser"),
        contributorSeed: `crew-assets-${crewId}-current-user`,
        modifiedAt: formatNow(),
        size: formatBytes(file.size),
        version: "v1",
      };
    });
    setItems((current) => [...additions, ...current]);
    selectAsset(additions[0]!);
    toast.success(t("uploaded", { count: additions.length }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <section
      aria-label={t("title")}
      className="min-h-[720px] overflow-hidden rounded-2xl border border-border/70 bg-[#0b0d10]"
    >
      <div
        className={cn(
          "grid min-h-[720px] grid-cols-1 lg:grid-cols-[176px_minmax(0,1fr)]",
          inspectorOpen && "lg:grid-cols-[176px_minmax(0,1fr)_340px]"
        )}
      >
        <AssetSourceRail
          activeFolderId={activeFolderId}
          expandedFolderIds={expandedFolderIds}
          t={t}
          onSelectFolder={setActiveFolderId}
          onToggleFolder={(id) =>
            setExpandedFolderIds((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
        />

        <div className="min-w-0 border-l border-border/60">
          <header className="border-b border-border/60 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <span>{t("folderCrewAssets")}</span>
                <IconChevronRight className="size-3" />
                <span>{t("folderEpisode01")}</span>
                <IconChevronRight className="size-3" />
                <span className="truncate font-semibold text-foreground">
                  {t("folderScriptStoryboard")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCreatingFolder(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <IconFolderPlus className="size-3.5" />
                  {t("newFolder")}
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
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
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="relative min-w-[190px] flex-1">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="h-8 w-full rounded-lg border border-border/70 bg-background/60 pl-8 pr-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60"
                />
              </label>
              <ToolbarSelect
                ariaLabel={t("typeFilter")}
                value={typeFilter}
                onChange={(value) => setTypeFilter(value as "all" | CrewAssetKind)}
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
              <BulkAction icon={<IconDownload />} label={t("download")} />
              <BulkAction icon={<IconArrowsMove />} label={t("move")} />
              <BulkAction icon={<IconCopy />} label={t("copy")} />
              <BulkAction
                icon={<IconTrash />}
                label={t("delete")}
                destructive
                onClick={deleteChecked}
              />
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

          <div className="min-h-[610px] overflow-x-auto">
            {viewMode === "list" ? (
              <AssetList
                items={filteredItems}
                checkedIds={checkedIds}
                selectedAssetId={selectedAssetId}
                creatingFolder={creatingFolder}
                newFolderName={newFolderName}
                t={t}
                onNewFolderNameChange={setNewFolderName}
                onCancelNewFolder={() => {
                  setCreatingFolder(false);
                  setNewFolderName("");
                }}
                onSaveNewFolder={addFolder}
                onSelect={selectAsset}
                onToggleChecked={toggleChecked}
                onToggleAll={toggleAll}
                onToggleFavorite={toggleFavorite}
              />
            ) : (
              <AssetGrid
                items={filteredItems}
                checkedIds={checkedIds}
                selectedAssetId={selectedAssetId}
                t={t}
                onSelect={selectAsset}
                onToggleChecked={toggleChecked}
                onToggleFavorite={toggleFavorite}
              />
            )}
          </div>

          <footer className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-[11px] text-muted-foreground">
            <span>{t("itemCount", { count: filteredItems.length })}</span>
            <span>{t("syncComplete")}</span>
          </footer>
        </div>

        {inspectorOpen && selectedAsset ? (
          <AssetInspector
            asset={selectedAsset}
            activeTab={inspectorTab}
            t={t}
            onTabChange={setInspectorTab}
            onClose={() => setInspectorOpen(false)}
            onToggleFavorite={() => toggleFavorite(selectedAsset.id)}
          />
        ) : null}
      </div>
    </section>
  );
}

function AssetSourceRail({
  activeFolderId,
  expandedFolderIds,
  t,
  onSelectFolder,
  onToggleFolder,
}: {
  activeFolderId: string;
  expandedFolderIds: Set<string>;
  t: Translation;
  onSelectFolder: (id: string) => void;
  onToggleFolder: (id: string) => void;
}) {
  return (
    <aside className="hidden min-w-0 flex-col bg-[#0a0c0f] lg:flex">
      <div className="space-y-0.5 border-b border-border/60 p-3">
        <SourceButton icon={<IconFolder />} label={t("allFiles")} active />
        <SourceButton icon={<IconClock />} label={t("recent")} />
        <SourceButton icon={<IconStar />} label={t("favorites")} />
        <SourceButton icon={<IconTrash />} label={t("trash")} />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {CREW_ASSET_FOLDER_TREE.map((node) => (
          <FolderTreeNode
            key={node.id}
            node={node}
            depth={0}
            activeFolderId={activeFolderId}
            expandedFolderIds={expandedFolderIds}
            t={t}
            onSelectFolder={onSelectFolder}
            onToggleFolder={onToggleFolder}
          />
        ))}
      </div>
      <div className="border-t border-border/60 p-3">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <IconDatabase className="size-3" /> {t("storage")}
          </span>
          <span>12.6%</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full w-[12.6%] rounded-full bg-primary" />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">128.6 GB / 1 TB</p>
      </div>
    </aside>
  );
}

function SourceButton({
  icon,
  label,
  active = false,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
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

function FolderTreeNode({
  node,
  depth,
  activeFolderId,
  expandedFolderIds,
  t,
  onSelectFolder,
  onToggleFolder,
}: {
  node: CrewAssetFolderNode;
  depth: number;
  activeFolderId: string;
  expandedFolderIds: Set<string>;
  t: Translation;
  onSelectFolder: (id: string) => void;
  onToggleFolder: (id: string) => void;
}) {
  const hasChildren = Boolean(node.children?.length);
  const expanded = expandedFolderIds.has(node.id);
  const active = activeFolderId === node.id;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center rounded-lg text-xs transition-colors",
          active
            ? "bg-primary/12 font-semibold text-primary"
            : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggleFolder(node.id)}
          className="grid size-7 shrink-0 place-items-center"
          aria-label={expanded ? t("collapseFolder") : t("expandFolder")}
        >
          {hasChildren ? (
            expanded ? (
              <IconChevronDown className="size-3" />
            ) : (
              <IconChevronRight className="size-3" />
            )
          ) : (
            <span className="size-3" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onSelectFolder(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-2 pr-2 text-left"
        >
          <IconFolder className={cn("size-3.5 shrink-0", active && "fill-primary/15")} />
          <span className="truncate">{t(node.labelKey)}</span>
        </button>
      </div>
      {expanded
        ? node.children?.map((child) => (
            <FolderTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activeFolderId={activeFolderId}
              expandedFolderIds={expandedFolderIds}
              t={t}
              onSelectFolder={onSelectFolder}
              onToggleFolder={onToggleFolder}
            />
          ))
        : null}
    </div>
  );
}

function AssetList({
  items,
  checkedIds,
  selectedAssetId,
  creatingFolder,
  newFolderName,
  t,
  onNewFolderNameChange,
  onCancelNewFolder,
  onSaveNewFolder,
  onSelect,
  onToggleChecked,
  onToggleAll,
  onToggleFavorite,
}: {
  items: CrewAssetPreviewItem[];
  checkedIds: Set<string>;
  selectedAssetId: string;
  creatingFolder: boolean;
  newFolderName: string;
  t: Translation;
  onNewFolderNameChange: (value: string) => void;
  onCancelNewFolder: () => void;
  onSaveNewFolder: () => void;
  onSelect: (item: CrewAssetPreviewItem) => void;
  onToggleChecked: (id: string) => void;
  onToggleAll: () => void;
  onToggleFavorite: (id: string) => void;
}) {
  const allChecked = items.length > 0 && checkedIds.size === items.length;

  return (
    <div className="min-w-[720px]">
      <div className="grid grid-cols-[36px_minmax(220px,1.7fr)_80px_minmax(110px,1fr)_100px_132px_72px_64px] items-center border-b border-border/60 px-2 text-[11px] text-muted-foreground">
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
        <span>{t("columnTask")}</span>
        <span>{t("columnContributor")}</span>
        <span>{t("columnModified")}</span>
        <span>{t("columnSize")}</span>
        <span />
      </div>

      {creatingFolder ? (
        <form
          className="grid grid-cols-[36px_minmax(220px,1.7fr)_80px_minmax(110px,1fr)_100px_132px_72px_64px] items-center border-b border-primary/30 bg-primary/5 px-2"
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
              value={newFolderName}
              onChange={(event) => onNewFolderNameChange(event.target.value)}
              placeholder={t("folderNamePlaceholder")}
              className="h-7 min-w-0 flex-1 rounded-md border border-primary/40 bg-background px-2 text-xs outline-none"
            />
          </div>
          <span className="text-[11px] text-muted-foreground">{t("typeFolder")}</span>
          <span />
          <span />
          <span />
          <span />
          <div className="flex items-center justify-end gap-1">
            <button
              type="submit"
              className="rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground"
            >
              {t("save")}
            </button>
            <button
              type="button"
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
            role="button"
            tabIndex={0}
            onClick={() => onSelect(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSelect(item);
              }
              if (event.key === " ") {
                event.preventDefault();
                onSelect(item);
              }
            }}
            className={cn(
              "group grid min-h-11 cursor-pointer grid-cols-[36px_minmax(220px,1.7fr)_80px_minmax(110px,1fr)_100px_132px_72px_64px] items-center border-b border-border/45 px-2 text-xs outline-none transition-colors",
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
              {item.version ? (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  {item.version}
                </span>
              ) : null}
            </div>
            <span className="truncate text-[11px] text-muted-foreground">
              {t(item.typeLabelKey)}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {t(item.taskLabelKey)}
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
            <span className="text-[11px] tabular-nums text-muted-foreground">{item.size}</span>
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
              <button
                type="button"
                className="grid size-7 place-items-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                aria-label={t("moreActions")}
              >
                <IconDots className="size-3.5" />
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
  items,
  checkedIds,
  selectedAssetId,
  t,
  onSelect,
  onToggleChecked,
  onToggleFavorite,
}: {
  items: CrewAssetPreviewItem[];
  checkedIds: Set<string>;
  selectedAssetId: string;
  t: Translation;
  onSelect: (item: CrewAssetPreviewItem) => void;
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
            role="button"
            tabIndex={0}
            onClick={() => onSelect(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSelect(item);
              }
              if (event.key === " ") {
                event.preventDefault();
                onSelect(item);
              }
            }}
            className={cn(
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
                    {t(item.taskLabelKey)} · {item.modifiedAt}
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
  asset,
  activeTab,
  t,
  onTabChange,
  onClose,
  onToggleFavorite,
}: {
  asset: CrewAssetPreviewItem;
  activeTab: InspectorTab;
  t: Translation;
  onTabChange: (tab: InspectorTab) => void;
  onClose: () => void;
  onToggleFavorite: () => void;
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
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:text-foreground"
          aria-label={t("moreActions")}
        >
          <IconDots className="size-4" />
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
          {asset.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.thumbnail}
              alt={displayName(asset, t)}
              className="max-h-full max-w-full rounded-sm object-contain"
            />
          ) : (
            <div className="grid size-24 place-items-center rounded-2xl bg-secondary/40 text-muted-foreground">
              <KindIcon kind={asset.kind} className="size-10" />
            </div>
          )}
        </div>
        <div className="flex h-10 items-center justify-between border-t border-border/50 px-3 text-muted-foreground">
          <div className="flex items-center gap-1">
            <InspectorIconButton label={t("previewInfo")}>
              <IconFileText className="size-3.5" />
            </InspectorIconButton>
            <span className="rounded-md bg-secondary/70 px-2 py-1 text-[10px] text-foreground">
              {asset.kind === "pdf" ? "2 / 12" : "1 / 1"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <InspectorIconButton label={t("zoom")}>
              <IconZoomIn className="size-3.5" />
            </InspectorIconButton>
            <span className="px-1 text-[10px]">44%</span>
            <InspectorIconButton label={t("fullscreen")}>
              <IconMaximize className="size-3.5" />
            </InspectorIconButton>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 border-b border-border/60">
        {(
          [
            ["info", t("tabInfo")],
            ["versions", t("tabVersions")],
            ["comments", t("tabComments", { count: 3 })],
            ["permissions", t("tabPermissions")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            className={cn(
              "relative h-11 truncate px-1 text-[11px] transition-colors",
              activeTab === id
                ? "font-semibold text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === "permissions" ? <PermissionPanel t={t} /> : null}
        {activeTab === "info" ? <InfoPanel asset={asset} t={t} /> : null}
        {activeTab === "versions" ? <VersionsPanel asset={asset} t={t} /> : null}
        {activeTab === "comments" ? <CommentsPanel t={t} /> : null}
      </div>
    </aside>
  );
}

function PermissionPanel({ t }: { t: Translation }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">{t("inheritanceTitle")}</h3>
        <button type="button" className="text-[11px] font-semibold text-primary hover:underline">
          {t("manageAccess")}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
        <span>{t("crewMembers")}</span>
        <IconChevronRight className="size-3" />
        <span>{t("folderEpisode01")}</span>
        <IconChevronRight className="size-3" />
        <span className="font-semibold text-foreground">{t("folderScriptStoryboard")}</span>
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-border/60">
        <div className="grid grid-cols-[72px_1fr_auto] border-b border-border/50 bg-secondary/20 px-3 py-2 text-[10px] text-muted-foreground">
          <span>{t("columnRole")}</span>
          <span>{t("columnDescription")}</span>
          <span>{t("columnMembers")}</span>
        </div>
        {CREW_ASSET_PERMISSION_GROUPS.map((group) => (
          <div
            key={group.id}
            className="grid min-h-13 grid-cols-[72px_1fr_auto] items-center border-b border-border/45 px-3 last:border-b-0"
          >
            <span className="text-[11px] font-medium text-foreground">{t(group.labelKey)}</span>
            <span className="pr-2 text-[10px] leading-4 text-muted-foreground">
              {t(group.descriptionKey)}
            </span>
            <div className="flex items-center">
              <div className="flex -space-x-1.5">
                {group.members.slice(0, 4).map((name) => (
                  <UserAvatar
                    key={name}
                    seed={`crew-asset-permission-${name}`}
                    name={name}
                    size={22}
                    className="border border-[#0a0c0f]"
                  />
                ))}
              </div>
              <span className="ml-2 text-[10px] tabular-nums text-muted-foreground">
                {group.members.length}
              </span>
              <IconChevronDown className="ml-1 size-3 text-muted-foreground" />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[10px] leading-4 text-muted-foreground">{t("inheritanceHint")}</p>
    </div>
  );
}

function InfoPanel({ asset, t }: { asset: CrewAssetPreviewItem; t: Translation }) {
  const rows = [
    [t("infoType"), t(asset.typeLabelKey)],
    [t("infoSize"), asset.size],
    [t("infoVersion"), asset.version ?? "—"],
    [t("infoTask"), t(asset.taskLabelKey)],
    [t("infoContributor"), asset.contributor],
    [t("infoModified"), asset.modifiedAt],
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

function VersionsPanel({ asset, t }: { asset: CrewAssetPreviewItem; t: Translation }) {
  return (
    <div className="space-y-1">
      {["v3", "v2", "v1"].map((version, index) => (
        <button
          key={version}
          type="button"
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-secondary/40"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-secondary text-[10px] font-semibold">
            {version}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-medium text-foreground">
              {index === 0 ? t("currentVersion") : t("previousVersion")}
            </span>
            <span className="block text-[10px] text-muted-foreground">
              {asset.contributor} · 2026-07-{28 - index}
            </span>
          </span>
          {index === 0 ? (
            <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] text-primary">
              {t("current")}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function CommentsPanel({ t }: { t: Translation }) {
  const comments = [
    ["Lin Mo", "commentOne", "09:21"],
    ["Zhang Xiaobei", "commentTwo", "09:08"],
    ["Chen Hang", "commentThree", "Yesterday"],
  ] as const;
  return (
    <div className="space-y-4">
      {comments.map(([name, key, time]) => (
        <div key={key} className="flex gap-2.5">
          <UserAvatar seed={`crew-asset-comment-${name}`} name={name} size={28} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-foreground">{name}</span>
              <span className="text-[9px] text-muted-foreground">{time}</span>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{t(key)}</p>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="w-full rounded-lg border border-border/60 px-3 py-2 text-left text-[10px] text-muted-foreground hover:border-border"
      >
        {t("addComment")}
      </button>
    </div>
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
    <label className="relative flex h-8 items-center rounded-lg border border-border/70 bg-background/60 text-xs text-muted-foreground transition-colors focus-within:border-primary/60">
      {icon ? <span className="pointer-events-none ml-2 [&>svg]:size-3.5">{icon}</span> : null}
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full appearance-none bg-transparent py-0 pl-2 pr-7 text-[11px] outline-none"
      >
        {options.map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue} className="bg-card text-foreground">
            {label}
          </option>
        ))}
      </select>
      <IconChevronDown className="pointer-events-none absolute right-2 size-3" />
    </label>
  );
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
  onClick,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] transition-colors [&>svg]:size-3.5",
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

function InspectorIconButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-md transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
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

function formatNow(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
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

function kindFromFile(file: File): Exclude<CrewAssetKind, "folder"> {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type === "application/pdf") return "pdf";
  if (/\.(psd|ai|sketch)$/i.test(file.name)) return "design";
  return "doc";
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
