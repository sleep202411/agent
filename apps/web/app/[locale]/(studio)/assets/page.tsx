"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  IconPhoto,
  IconVideo,
  IconMusic,
  IconMicrophone,
  IconUser,
  IconBuildingCastle,
  IconHorseToy,
  IconUpload,
  IconSearch,
  IconLayoutGrid,
  IconList,
  IconDownload,
  IconDots,
  IconSend,
  IconX,
  IconChevronLeft,
  IconChevronRight,
  IconArrowUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconSparkles,
  IconEraser,
  IconEdit,
} from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// ─── Types ──────────────────────────────────────────────────

type AssetType = "all" | "character" | "scene" | "prop" | "image" | "video" | "audio";
type AssetSource = "all" | "generated" | "uploaded" | "project";

type Asset = {
  id: string;
  name: string;
  type: AssetType;
  source: AssetSource;
  thumbnailUrl: string | null;
  prompt: string | null;
  model: string | null;
  createdAt: string;
  author: string;
};

// ─── Config ─────────────────────────────────────────────────

const typeFilters: { key: AssetType; label: string; icon: React.ReactNode }[] = [
  { key: "all", label: "All", icon: null },
  { key: "character", label: "Characters", icon: <IconUser className="size-3.5" /> },
  { key: "scene", label: "Scenes", icon: <IconBuildingCastle className="size-3.5" /> },
  { key: "prop", label: "Props", icon: <IconHorseToy className="size-3.5" /> },
  { key: "image", label: "Images", icon: <IconPhoto className="size-3.5" /> },
  { key: "video", label: "Videos", icon: <IconVideo className="size-3.5" /> },
  { key: "audio", label: "Audio", icon: <IconMicrophone className="size-3.5" /> },
];

const sourceFilters: { key: AssetSource; label: string }[] = [
  { key: "all", label: "All Sources" },
  { key: "generated", label: "AI Generated" },
  { key: "uploaded", label: "Uploaded" },
  { key: "project", label: "From Project" },
];

// ─── Mock Data ──────────────────────────────────────────────

const mockAssets: Asset[] = [
  {
    id: "1",
    name: "Hero Character",
    type: "character",
    source: "generated",
    thumbnailUrl: null,
    prompt: "A heroic young warrior with silver armor, anime style, detailed face",
    model: "Flux Pro",
    createdAt: "2026-03-21",
    author: "Isaac",
  },
  {
    id: "2",
    name: "City Night Scene",
    type: "scene",
    source: "generated",
    thumbnailUrl: null,
    prompt: "Cyberpunk city at night, neon lights, rain, cinematic",
    model: "Flux Pro",
    createdAt: "2026-03-21",
    author: "Isaac",
  },
  {
    id: "3",
    name: "Magic Sword",
    type: "prop",
    source: "generated",
    thumbnailUrl: null,
    prompt: "Legendary glowing sword, blue flame, fantasy style",
    model: "Flux Pro",
    createdAt: "2026-03-20",
    author: "Isaac",
  },
  {
    id: "4",
    name: "Opening Shot",
    type: "image",
    source: "generated",
    thumbnailUrl: null,
    prompt: "Wide shot of a futuristic city skyline at sunset",
    model: "Flux Pro",
    createdAt: "2026-03-20",
    author: "Isaac",
  },
  {
    id: "5",
    name: "Chase Sequence",
    type: "video",
    source: "generated",
    thumbnailUrl: null,
    prompt: "Two characters running through narrow alleyways",
    model: "Wan2.6",
    createdAt: "2026-03-19",
    author: "Isaac",
  },
  {
    id: "6",
    name: "Background Music",
    type: "audio",
    source: "uploaded",
    thumbnailUrl: null,
    prompt: null,
    model: null,
    createdAt: "2026-03-19",
    author: "Isaac",
  },
  {
    id: "7",
    name: "Villain Character",
    type: "character",
    source: "generated",
    thumbnailUrl: null,
    prompt: "Dark sorcerer with a hood, glowing red eyes, menacing",
    model: "Flux Pro",
    createdAt: "2026-03-18",
    author: "Isaac",
  },
  {
    id: "8",
    name: "Forest Scene",
    type: "scene",
    source: "uploaded",
    thumbnailUrl: null,
    prompt: null,
    model: null,
    createdAt: "2026-03-18",
    author: "Isaac",
  },
  {
    id: "9",
    name: "Reference Photo",
    type: "image",
    source: "uploaded",
    thumbnailUrl: null,
    prompt: null,
    model: null,
    createdAt: "2026-03-17",
    author: "Isaac",
  },
  {
    id: "10",
    name: "Dialogue Audio",
    type: "audio",
    source: "project",
    thumbnailUrl: null,
    prompt: null,
    model: null,
    createdAt: "2026-03-17",
    author: "Isaac",
  },
];

// ─── Page ───────────────────────────────────────────────────

export default function AssetsPage() {
  const [activeType, setActiveType] = useState<AssetType>("all");
  const [activeSource, setActiveSource] = useState<AssetSource>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  const filtered = mockAssets.filter((a) => {
    if (activeType !== "all" && a.type !== activeType) return false;
    if (activeSource !== "all" && a.source !== activeSource) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const selectedIndex = selectedAsset ? filtered.findIndex((a) => a.id === selectedAsset.id) : -1;

  const handlePrev = () => {
    if (selectedIndex > 0) setSelectedAsset(filtered[selectedIndex - 1]!);
  };
  const handleNext = () => {
    if (selectedIndex < filtered.length - 1) setSelectedAsset(filtered[selectedIndex + 1]!);
  };

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-4">
          <h1 className="text-2xl font-bold tracking-tight">Assets</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your characters, scenes, props and media files.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 px-8 pb-4">
          <div className="flex items-center gap-1">
            {typeFilters.map((f) => (
              <button
                key={f.key}
                onClick={() => setActiveType(f.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  activeType === f.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {f.icon}
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search assets..."
                className="h-8 w-48 pl-8 text-xs"
              />
            </div>
            <Button variant="outline" color="muted" size="sm">
              <IconUpload className="size-3.5" />
              Upload
            </Button>
            <div className="flex rounded-lg border border-border">
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "flex size-8 items-center justify-center rounded-l-lg transition-colors",
                  viewMode === "grid" ? "bg-accent text-foreground" : "text-muted-foreground"
                )}
              >
                <IconLayoutGrid className="size-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "flex size-8 items-center justify-center rounded-r-lg transition-colors",
                  viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground"
                )}
              >
                <IconList className="size-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Asset Grid / List */}
        <div className="flex-1 overflow-auto px-8 pb-8">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-sm text-muted-foreground">No assets found.</p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filtered.map((asset) => (
                <AssetCard key={asset.id} asset={asset} onClick={() => setSelectedAsset(asset)} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filtered.map((asset) => (
                <AssetListItem
                  key={asset.id}
                  asset={asset}
                  onClick={() => setSelectedAsset(asset)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar — Filters */}
      {!selectedAsset && (
        <aside className="hidden lg:flex w-60 shrink-0 flex-col border-l border-border/70 p-4 gap-6 overflow-auto">
          <div>
            <h3 className="text-sm font-semibold mb-2">Source</h3>
            <div className="flex flex-col gap-1">
              {sourceFilters.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setActiveSource(f.key)}
                  className={cn(
                    "rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    activeSource === f.key
                      ? "bg-accent text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-2">Ownership</h3>
            <div className="flex flex-col gap-1">
              {["Personal", "Team", "Project"].map((item) => (
                <button
                  key={item}
                  className="rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}

      {/* Asset Detail Panel */}
      {selectedAsset && (
        <AssetDetailPanel
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onPrev={selectedIndex > 0 ? handlePrev : undefined}
          onNext={selectedIndex < filtered.length - 1 ? handleNext : undefined}
        />
      )}
    </div>
  );
}

// ─── Asset Card ─────────────────────────────────────────────

const typeIconMap: Record<string, (cls: string) => React.ReactNode> = {
  character: (cls) => <IconUser className={cls} />,
  scene: (cls) => <IconBuildingCastle className={cls} />,
  prop: (cls) => <IconHorseToy className={cls} />,
  image: (cls) => <IconPhoto className={cls} />,
  video: (cls) => <IconVideo className={cls} />,
  audio: (cls) => <IconMusic className={cls} />,
};

function AssetCard({ asset, onClick }: { asset: Asset; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="group cursor-pointer overflow-hidden rounded-xl border border-border/70 bg-card transition-colors hover:border-border"
    >
      <div className="aspect-square bg-muted flex items-center justify-center text-muted-foreground/30">
        {asset.thumbnailUrl ? (
          <img src={asset.thumbnailUrl} alt="" className="size-full object-cover" />
        ) : (
          typeIconMap[asset.type]?.("size-8") || <IconPhoto className="size-8" />
        )}
      </div>
      <div className="p-2.5">
        <p className="truncate text-xs font-medium">{asset.name}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 capitalize">
          {asset.type} · {asset.source}
        </p>
      </div>
    </div>
  );
}

// ─── Asset List Item ────────────────────────────────────────

function AssetListItem({ asset, onClick }: { asset: Asset; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50 cursor-pointer"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {typeIconMap[asset.type]?.("size-4") || <IconPhoto className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{asset.name}</p>
        <p className="text-xs text-muted-foreground capitalize">
          {asset.type} · {asset.source}
        </p>
      </div>
      <span className="text-xs text-muted-foreground">{asset.createdAt}</span>
    </div>
  );
}

// ─── Asset Detail Panel ─────────────────────────────────────

function AssetDetailPanel({
  asset,
  onClose,
  onPrev,
  onNext,
}: {
  asset: Asset;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"details" | "comments">("details");

  return (
    <div className="fixed inset-0 z-50 flex bg-background/80 backdrop-blur-sm">
      {/* Left: Preview */}
      <div className="relative flex flex-1 items-center justify-center p-8">
        {/* Nav arrows */}
        {onPrev && (
          <button
            onClick={onPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 flex size-10 items-center justify-center rounded-full bg-card/80 text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconChevronLeft className="size-5" />
          </button>
        )}
        {onNext && (
          <button
            onClick={onNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 flex size-10 items-center justify-center rounded-full bg-card/80 text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconChevronRight className="size-5" />
          </button>
        )}

        {/* Preview */}
        <div className="max-h-[80vh] max-w-[80%] overflow-hidden rounded-xl bg-muted">
          {asset.thumbnailUrl ? (
            <img src={asset.thumbnailUrl} alt="" className="size-full object-contain" />
          ) : (
            <div className="flex size-96 items-center justify-center text-muted-foreground/20">
              {typeIconMap[asset.type]?.("size-24") || <IconPhoto className="size-24" />}
            </div>
          )}
        </div>
      </div>

      {/* Right: Detail Sidebar */}
      <aside className="flex w-96 shrink-0 flex-col border-l border-border/70 bg-background overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/70">
          <Button variant="outline" color="muted" size="sm">
            <IconDownload className="size-3.5" />
            Download
          </Button>
          <div className="flex items-center gap-1">
            <Button variant="ghost" color="muted" size="icon-sm">
              <IconDots className="size-4" />
            </Button>
            <Button variant="ghost" color="muted" size="icon-sm">
              <IconSend className="size-4" />
            </Button>
            <Button variant="ghost" color="muted" size="icon-sm" onClick={onClose}>
              <IconX className="size-4" />
            </Button>
          </div>
        </div>

        {/* Author */}
        <div className="flex items-center gap-2 px-4 py-3">
          <Avatar size="sm">
            <AvatarFallback>{asset.author.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium">
              by <span className="font-semibold">{asset.author}</span>
            </p>
            <p className="text-xs text-muted-foreground">Created {asset.createdAt}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border/70 px-4">
          <button
            onClick={() => setActiveTab("details")}
            className={cn(
              "flex-1 py-2.5 text-center text-sm font-medium border-b-2 transition-colors",
              activeTab === "details"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground"
            )}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab("comments")}
            className={cn(
              "flex-1 py-2.5 text-center text-sm font-medium border-b-2 transition-colors",
              activeTab === "comments"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground"
            )}
          >
            Comments (0)
          </button>
        </div>

        {activeTab === "details" ? (
          <div className="flex-1 overflow-auto">
            {/* Prompt */}
            {asset.prompt && (
              <div className="px-4 py-4 border-b border-border/70">
                <p className="text-sm text-muted-foreground leading-relaxed">{asset.prompt}</p>
                {asset.model && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{asset.model}</span>
                  </p>
                )}
              </div>
            )}

            {/* Located */}
            <div className="px-4 py-4 border-b border-border/70">
              <p className="text-xs text-muted-foreground mb-2">Located</p>
              <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
                <span className="text-sm">Default Folder</span>
              </div>
            </div>

            {/* Creation Actions */}
            {asset.source === "generated" && (
              <div className="px-4 py-4 border-b border-border/70">
                <p className="text-sm font-semibold mb-3">Creation Actions</p>
                <div className="space-y-3">
                  <ActionRow label="Upscale">
                    <ActionButton>Subtle</ActionButton>
                    <ActionButton>Creative</ActionButton>
                  </ActionRow>
                  <ActionRow label="Remove Bg">
                    <ActionButton>Remove Background</ActionButton>
                  </ActionRow>
                  <ActionRow label="Variate">
                    <ActionButton>Subtle</ActionButton>
                    <ActionButton>Strong</ActionButton>
                  </ActionRow>
                  <ActionRow label="Pan">
                    <ActionButton icon>
                      <IconArrowUp className="size-3.5" />
                    </ActionButton>
                    <ActionButton icon>
                      <IconArrowDown className="size-3.5" />
                    </ActionButton>
                    <ActionButton icon>
                      <IconArrowLeft className="size-3.5" />
                    </ActionButton>
                    <ActionButton icon>
                      <IconArrowRight className="size-3.5" />
                    </ActionButton>
                  </ActionRow>
                  <ActionRow label="Edit">
                    <ActionButton>Edit</ActionButton>
                  </ActionRow>
                </div>
              </div>
            )}

            {/* Animate */}
            {(asset.type === "image" || asset.type === "character" || asset.type === "scene") &&
              asset.source === "generated" && (
                <div className="px-4 py-4">
                  <p className="text-sm font-semibold mb-3">Animate Image</p>
                  <ActionRow label="Motion">
                    <ActionButton>Low</ActionButton>
                    <ActionButton>High</ActionButton>
                  </ActionRow>
                </div>
              )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

// ─── Action Components ──────────────────────────────────────

function ActionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

function ActionButton({ children, icon = false }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <button
      className={cn(
        "rounded-lg border border-border bg-card text-sm font-medium transition-colors hover:bg-accent",
        icon ? "flex size-9 items-center justify-center" : "px-4 py-2"
      )}
    >
      {children}
    </button>
  );
}
