"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { IconPlus, IconDots, IconLoader2, IconLayoutGrid, IconFolder } from "@tabler/icons-react";
import { CreationComposer } from "@/components/workspace/creation-composer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useWorldsWithProducts,
  type V1World,
  type V1WorldProduct,
  type WorldGroup,
} from "@/src/hooks/use-worlds";

const OSS_BASE = process.env.NEXT_PUBLIC_OSS_BASE_URL ?? "";

function ossUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${OSS_BASE}/${path}`;
}

// ─── Page ───────────────────────────────────────────────────

export default function ProjectsPage() {
  const locale = useLocale();
  const { groups, totalProducts, isLoading } = useWorldsWithProducts();
  const [creating, setCreating] = useState(false);
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("grouped");

  const handleCreateProject = async () => {
    if (creating) return;
    setCreating(true);
    // TODO: call API to create project
    setTimeout(() => setCreating(false), 1500);
  };

  return (
    <div className="flex flex-col gap-10 px-8 pb-24 pt-10">
      {/* Header */}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Create, edit and manage your AI animation projects.
        </p>
      </header>

      {/* Project Grid */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">My Projects</h2>
            <p className="text-sm text-muted-foreground">
              {totalProducts} project{totalProducts !== 1 ? "s" : ""}
            </p>
          </div>
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(v) => v && setViewMode(v as "flat" | "grouped")}
          >
            <ToggleGroupItem value="flat" aria-label="平铺展示">
              <IconLayoutGrid className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="grouped" aria-label="按世界分组">
              <IconFolder className="size-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {viewMode === "flat" ? (
          <FlatView
            groups={groups}
            loading={isLoading}
            creating={creating}
            locale={locale}
            onCreateProject={handleCreateProject}
          />
        ) : (
          <GroupedView
            groups={groups}
            loading={isLoading}
            creating={creating}
            locale={locale}
            onCreateProject={handleCreateProject}
          />
        )}
      </section>

      <CreationComposer />
    </div>
  );
}

// ─── Shared Props ───────────────────────────────────────────

type ViewProps = {
  groups: WorldGroup[];
  loading: boolean;
  creating: boolean;
  locale: string;
  onCreateProject: () => void;
};

// ─── Flat View ──────────────────────────────────────────────

function FlatView({ groups, loading, creating, locale, onCreateProject }: ViewProps) {
  const allProducts = groups.flatMap((g) =>
    g.products.map((p) => ({ product: p, world: g.world }))
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <CreateButton creating={creating} onClick={onCreateProject} />
      {loading && Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
      {!loading &&
        allProducts.map(({ product, world }) => (
          <ProductCard key={product.id} product={product} world={world} locale={locale} />
        ))}
      {!loading && allProducts.length === 0 && <EmptyState />}
    </div>
  );
}

// ─── Grouped View ───────────────────────────────────────────

function GroupedView({ groups, loading, creating, locale, onCreateProject }: ViewProps) {
  return (
    <div className="space-y-10">
      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                  {products.length} project{products.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} world={world} locale={locale} />
              ))}
            </div>
          </div>
        ))}

      {!loading && groups.length === 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <CreateButton creating={creating} onClick={onCreateProject} />
          <EmptyState />
        </div>
      )}

      {!loading && groups.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <CreateButton creating={creating} onClick={onCreateProject} />
        </div>
      )}
    </div>
  );
}

// ─── Product Card ────────────────────────────────────────────

function ProductCard({
  product,
  world,
  locale,
}: {
  product: V1WorldProduct;
  world: V1World;
  locale: string;
}) {
  const cover = ossUrl(product.imagePath);

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card transition-colors hover:border-border">
      <Link href={`/${locale}/projects/${product.id}?worldId=${product.worldId}`} target="_blank">
        <div className="relative h-40 w-full bg-muted">
          {cover ? (
            <img src={cover} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center bg-gradient-to-br from-muted-foreground/10 to-muted-foreground/5">
              <span className="text-3xl font-bold text-muted-foreground/20">
                {product.name.charAt(0)}
              </span>
            </div>
          )}
          <span className="absolute left-2 top-2 rounded-md bg-background/80 px-2 py-0.5 text-[10px] font-medium text-foreground backdrop-blur-sm">
            {world.name}
          </span>
        </div>
      </Link>
      <div className="flex items-start justify-between gap-2 p-3">
        <Link
          href={`/${locale}/projects/${product.id}?worldId=${product.worldId}`}
          target="_blank"
          className="min-w-0 flex-1"
        >
          <p className="truncate text-sm font-medium">{product.name}</p>
          {product.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{product.description}</p>
          )}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100">
              <IconDots className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Open</DropdownMenuItem>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuItem>Rename</DropdownMenuItem>
            <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─── Create Button ──────────────────────────────────────────

function CreateButton({ creating, onClick }: { creating: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={creating}
      className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-card transition-all hover:border-primary/40 hover:bg-muted/40 disabled:opacity-70"
    >
      {creating ? (
        <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <IconLoader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="flex size-10 items-center justify-center rounded-full bg-foreground text-background">
          <IconPlus className="size-5" />
        </div>
      )}
      <span className="text-sm font-medium">{creating ? "Creating..." : "New Project"}</span>
    </button>
  );
}

// ─── Empty State ────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
      <p className="text-sm text-muted-foreground">
        No projects yet. Create your first project to get started.
      </p>
    </div>
  );
}

// ─── Skeleton Card ──────────────────────────────────────────

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
