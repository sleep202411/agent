"use client";

import { useState } from "react";
import Link from "next/link";
import { IconArrowRight, IconPlus } from "@tabler/icons-react";
import { env } from "@/src/env";
import { useTranslations } from "@/src/i18n/i18n";
import { localizePath, getCurrentLocale } from "@/src/i18n/locale-url";
import { useMyProducts, type MyProduct } from "../_hooks/use-my-products";
import { CreateWorldDialog } from "./create-world-dialog";

const OSS_BASE = env.OSS_BASE_URL;

function ossUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${OSS_BASE}/${path}`;
}

/**
 * Studio home — recent projects strip (top 8 from
 * `/api/user/world/list/myproduct`). Provides a fast preview into the
 * user's library without dragging in the full /projects page chrome
 * (own/created tabs, flat/grouped toggle, world grouping). The "View
 * all →" link in the header takes the user to the dedicated list.
 *
 * Includes a `+` create card as the first grid slot — the same
 * `CreateWorldDialog` ProjectsSection uses, kept here so the home page
 * doesn't lose the explicit "create with file upload + manual fields"
 * affordance just because we slimmed the preview down. The studio
 * composer above is the AI-led creation path; this card is the
 * file-led / form-led one.
 */
export function RecentProjectsPreview() {
  const tw = useTranslations("workspace");
  // Fetch 4 — the Create card takes one slot so the strip caps at 5
  // visible cards total. Bumping `viewAll` is the path to the rest.
  const { products, totalCount, isLoading } = useMyProducts({ pageSize: 4 });
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold">{tw("recentProjects")}</h2>
          <p className="text-sm text-muted-foreground">
            {tw("projectCount", { count: totalCount })}
          </p>
        </div>
        <Link
          href={localizePath("/art-studio/projects", getCurrentLocale())}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {tw("viewAll")}
          <IconArrowRight className="size-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        <CreateButton onClick={() => setCreateDialogOpen(true)} />
        {isLoading && Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        {!isLoading && products.map((p) => <ProductCard key={p.id} product={p} />)}
        {!isLoading && products.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            {tw("noProjectsYetHint")}
          </p>
        )}
      </div>

      <CreateWorldDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </section>
  );
}

function ProductCard({ product }: { product: MyProduct }) {
  const tw = useTranslations("workspace");
  const cover = ossUrl(product.imagePath);
  const description = product.description?.trim() || tw("noDescription");
  return (
    <Link
      href={localizePath(`/projects/${product.id}?worldId=${product.worldId}`, getCurrentLocale())}
      className="group flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card transition-colors hover:border-border"
    >
      <div className="relative aspect-video w-full bg-muted">
        <img src={cover ?? "/default-cover.jpg"} alt="" className="size-full object-cover" />
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium">{product.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
      </div>
    </Link>
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
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-muted/30 py-8">
        <div className="flex size-10 items-center justify-center rounded-full bg-foreground text-background">
          <IconPlus className="size-5" />
        </div>
        <span className="text-sm font-medium">{tw("createWorld")}</span>
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="aspect-video w-full animate-pulse bg-muted" />
      <div className="space-y-2 p-3">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-3 w-32 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
