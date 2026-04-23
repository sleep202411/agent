"use client";

import { useState } from "react";
import Link from "next/link";
import { IconDots, IconFolder, IconLayoutGrid, IconLoader2, IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { env } from "@/src/env";
import { backendApi } from "@/src/lib/api";
import {
  useWorldsWithProducts,
  worldKeys,
  type V1World,
  type V1WorldProduct,
  type WorldGroup,
  type WorldListType,
} from "@/src/hooks/use-worlds";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { CreateWorldDialog } from "./create-world-dialog";
import { ProjectEditorDialog } from "@/app/projects/_components/project-editor-dialog";
import type { ProjectOptionItem } from "@/src/types/workspace";

const OSS_BASE = env.OSS_BASE_URL;

function ossUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${OSS_BASE}/${path}`;
}

export function ProjectsSection() {
  const tw = useTranslations("workspace");
  const [listType, setListType] = useState<WorldListType>("own");
  const { groups, totalProducts, isLoading } = useWorldsWithProducts(listType);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");

  const handleCreateWorld = () => setDialogOpen(true);

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-end gap-6">
          <div>
            <h2 className="text-lg font-semibold">{tw("myProjects")}</h2>
            <p className="text-sm text-muted-foreground">
              {tw("projectCount", { count: totalProducts })}
            </p>
          </div>
          {/* Mirrors the creatorCenter tabs in the legacy app: "own"
              = /ownproject (worlds I participate in, incl. joined),
              "created" = /myworld (worlds I created). */}
          <div className="flex items-center gap-1 pb-1" role="tablist">
            <TabButton
              active={listType === "own"}
              onClick={() => setListType("own")}
              label={tw("worldsParticipating")}
            />
            <TabButton
              active={listType === "created"}
              onClick={() => setListType("created")}
              label={tw("worldsCreated")}
            />
          </div>
        </div>
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => v && setViewMode(v as "flat" | "grouped")}
        >
          <ToggleGroupItem value="flat" aria-label={tw("flatView")}>
            <IconLayoutGrid className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="grouped" aria-label={tw("groupedView")}>
            <IconFolder className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {viewMode === "flat" ? (
        <FlatView groups={groups} loading={isLoading} onCreateWorld={handleCreateWorld} />
      ) : (
        <GroupedView groups={groups} loading={isLoading} onCreateWorld={handleCreateWorld} />
      )}

      <CreateWorldDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </section>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground/70 hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

type ViewProps = {
  groups: WorldGroup[];
  loading: boolean;
  onCreateWorld: () => void;
};

function FlatView({ groups, loading, onCreateWorld }: ViewProps) {
  const allProducts = groups.flatMap((g) =>
    g.products.map((p) => ({
      product: p,
      world: g.world,
      isLastInWorld: g.products.length === 1,
    }))
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      <CreateButton onClick={onCreateWorld} />
      {loading && Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
      {!loading &&
        allProducts.map(({ product, world, isLastInWorld }) => (
          <ProductCard
            key={product.id}
            product={product}
            world={world}
            isLastInWorld={isLastInWorld}
          />
        ))}
      {!loading && allProducts.length === 0 && <EmptyState />}
    </div>
  );
}

function GroupedView({ groups, loading, onCreateWorld }: ViewProps) {
  const tw = useTranslations("workspace");
  return (
    <div className="space-y-10">
      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!loading &&
        groups.map(({ world, products }) => (
          <div key={world.id}>
            <div className="mb-1 flex items-center gap-3">
              {world.bannerLink && (
                <img
                  src={ossUrl(world.bannerLink)!}
                  alt=""
                  className="size-8 rounded-full object-cover"
                />
              )}
              <div>
                <h2 className="text-lg font-semibold">{world.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {tw("projectCount", { count: products.length })}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  world={world}
                  isLastInWorld={products.length === 1}
                />
              ))}
            </div>
          </div>
        ))}

      {!loading && groups.length === 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          <CreateButton onClick={onCreateWorld} />
          <EmptyState />
        </div>
      )}

      {!loading && groups.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          <CreateButton onClick={onCreateWorld} />
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product,
  world,
  isLastInWorld,
}: {
  product: V1WorldProduct;
  world: V1World;
  isLastInWorld: boolean;
}) {
  const tw = useTranslations("workspace");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const cover = ossUrl(product.imagePath);
  const description = product.description?.trim() || tw("noDescription");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectOptionItem | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);

  // Opens the same ProjectEditorDialog used on the project detail page.
  // The V1WorldProduct list item here only carries {id, name, imagePath,
  // description, worldId}, but the dialog's form needs the richer
  // ProjectDetail (type, episode, chapterLength, stylePainting,
  // aspectRatioType) — otherwise required fields appear empty and the
  // validator blocks save. Fetch the full detail first.
  const handleEdit = async () => {
    if (loadingEdit) return;
    setLoadingEdit(true);
    try {
      const detail = await backendApi.post<ProjectOptionItem>(
        `/api/user/project/detail/${product.id}`
      );
      setEditingProject(detail);
      setEditorOpen(true);
    } catch (err) {
      console.error("[ProductCard] load project detail failed", err);
      toast.error(err instanceof Error ? err.message : tw("projectLoadFailed"));
    } finally {
      setLoadingEdit(false);
    }
  };

  const handleLinkClick = (e: React.MouseEvent) => {
    // 嵌入到 parent iframe 时，改走 postMessage 让 parent 在自己那边跳
    if (typeof window !== "undefined" && window.self !== window.top) {
      e.preventDefault();
      window.parent.postMessage(
        { type: "openProject", projectId: product.id, worldId: product.worldId },
        "*"
      );
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      if (isLastInWorld) {
        // Java rejects worldproduct delete when it's the last one — the
        // contract is "delete the world itself, which cascades".
        await backendApi.post("/api/user/world/delete/world", {
          data: { id: product.worldId },
        });
      } else {
        // Non-last: delete only the project. Java expects `id` on the
        // query string (matches the legacy Vue client — body form returns
        // 未知異常).
        await backendApi.post(
          `/api/user/world/delete/worldproduct?id=${encodeURIComponent(product.id)}`
        );
      }
      toast.success(tw("projectDeleteSuccess"));
      setConfirmOpen(false);
      // Always refresh this world's product list. If we just deleted the
      // world itself, also invalidate the world list so the empty world
      // disappears from the UI too.
      void queryClient.invalidateQueries({ queryKey: worldKeys.products(product.worldId) });
      if (isLastInWorld) {
        void queryClient.invalidateQueries({ queryKey: worldKeys.all });
      }
    } catch (err) {
      console.error("[ProductCard] delete failed", err);
      toast.error(err instanceof Error ? err.message : tw("projectDeleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card transition-colors hover:border-border">
      <Link
        href={`/projects/${product.id}?worldId=${product.worldId}`}
        target="_blank"
        onClick={handleLinkClick}
      >
        <div className="relative aspect-[16/9] w-full bg-muted">
          <img src={cover ?? "/default-cover.png"} alt="" className="size-full object-cover" />
          <span className="absolute left-2 top-2 rounded-md bg-background/80 px-2 py-0.5 text-[10px] font-medium text-foreground backdrop-blur-sm">
            {world.name}
          </span>
        </div>
      </Link>
      <div className="flex items-start justify-between gap-2 p-3">
        <Link
          href={`/projects/${product.id}?worldId=${product.worldId}`}
          target="_blank"
          onClick={handleLinkClick}
          className="min-w-0 flex-1"
        >
          <p className="truncate text-sm font-medium">{product.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100">
              <IconDots className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link
                href={`/projects/${product.id}?worldId=${product.worldId}`}
                target="_blank"
                onClick={handleLinkClick}
              >
                {tw("projectMenuOpen")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={loadingEdit}
              onSelect={(e) => {
                e.preventDefault();
                void handleEdit();
              }}
            >
              {loadingEdit && <IconLoader2 className="mr-1.5 size-3.5 animate-spin" />}
              {tw("projectMenuEdit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={(e) => {
                e.preventDefault();
                setConfirmOpen(true);
              }}
            >
              {tw("projectMenuDelete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tw("projectDeleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {isLastInWorld
                ? tw("projectDeleteConfirmDescriptionLastInWorld", {
                    name: product.name,
                    worldName: world.name,
                  })
                : tw("projectDeleteConfirmDescription", { name: product.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <IconLoader2 className="mr-1.5 size-3.5 animate-spin" />}
              {tw("projectMenuDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProjectEditorDialog
        open={editorOpen}
        worldId={product.worldId}
        project={editingProject}
        onOpenChange={(next) => {
          setEditorOpen(next);
          if (!next) setEditingProject(null);
        }}
        onSaved={() => {
          // Refresh this world's product list so name / cover / description
          // updates appear without a page reload.
          void queryClient.invalidateQueries({ queryKey: worldKeys.products(product.worldId) });
        }}
      />
    </div>
  );
}

function CreateButton({ onClick }: { onClick: () => void }) {
  const tw = useTranslations("workspace");
  return (
    <button
      type="button"
      onClick={onClick}
      className="group overflow-hidden rounded-xl border border-dashed border-border/70 bg-card transition-all hover:border-primary/40 hover:bg-muted/40"
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-muted/30">
        <div className="flex size-10 items-center justify-center rounded-full bg-foreground text-background">
          <IconPlus className="size-5" />
        </div>
        <span className="text-sm font-medium">{tw("createWorld")}</span>
      </div>
    </button>
  );
}

function EmptyState() {
  const tw = useTranslations("workspace");
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
      <p className="text-sm text-muted-foreground">{tw("noProjectsYetHint")}</p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="h-40 w-full animate-pulse bg-muted" />
      <div className="space-y-2 p-3">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-3 w-32 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
