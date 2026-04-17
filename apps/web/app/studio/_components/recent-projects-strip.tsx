"use client";

import Link from "next/link";
import { IconArrowRight, IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { env } from "@/src/env";
import { useWorldsWithProducts, type V1World, type V1WorldProduct } from "@/src/hooks/use-worlds";

const OSS_BASE = env.OSS_BASE_URL;

function ossUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${OSS_BASE}/${path}`;
}

const RECENT_COUNT = 3;

export function RecentProjectsStrip() {
  const t = useTranslations("workspace");
  const { groups, isLoading } = useWorldsWithProducts();

  const recents = groups
    .flatMap((g) => g.products.map((p) => ({ product: p, world: g.world })))
    .slice(0, RECENT_COUNT);

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconSparkles className="size-5 text-primary" />
          <h2 className="text-lg font-semibold">{t("myProjects")}</h2>
        </div>
        <Link
          href="/studio/projects"
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("viewAll")}
          <IconArrowRight className="size-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && Array.from({ length: RECENT_COUNT }).map((_, i) => <SkeletonCard key={i} />)}
        {!isLoading &&
          recents.map(({ product, world }) => (
            <RecentCard key={product.id} product={product} world={world} />
          ))}
        {!isLoading && recents.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            {t("noProjectsYetHint")}
          </p>
        )}
      </div>
    </section>
  );
}

function RecentCard({ product, world }: { product: V1WorldProduct; world: V1World }) {
  const cover = ossUrl(product.imagePath);
  return (
    <Link
      href={`/projects/${product.id}?worldId=${product.worldId}`}
      target="_blank"
      className="group flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card transition-colors hover:border-border"
    >
      <div className="relative aspect-[4/3] w-full bg-muted">
        {cover ? (
          <img src={cover} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-muted-foreground/10 to-muted-foreground/5">
            <span className="text-5xl font-bold text-muted-foreground/25">
              {product.name.charAt(0)}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 p-4">
        <p className="truncate text-sm font-medium">{product.name}</p>
        <p className="truncate text-xs text-muted-foreground">{world.name}</p>
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="aspect-[4/3] w-full animate-pulse bg-muted" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
        <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
