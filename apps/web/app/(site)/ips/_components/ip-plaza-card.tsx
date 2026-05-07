"use client";

import Link from "next/link";
import { IconSparkles, IconPlayerPlay } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  ipImageUrl,
  userAvatarUrl,
  parseTagIds,
  resolveTagNames,
  avatarFallbackTone,
  type IPProject,
  type CategoryMap,
} from "../_hooks/use-ip";

/**
 * IP Plaza listing card. Sits inside a CSS-columns masonry container, so
 * it must use `break-inside-avoid` and `inline-block w-full`. Cover
 * images render at their natural aspect ratio so heights vary across the
 * grid.
 */

export function IPPlazaCard({
  project,
  categories,
  tagMap,
}: {
  project: IPProject;
  categories: CategoryMap;
  /** `id → name` map built from `useTagList()`. Optional so callers
   *  that don't render tags (e.g. compact card variants) can skip it;
   *  when missing, tags fall back to `#${id}` rather than the misleading
   *  raw "[11]" the legacy `splitTags` shim produced. */
  tagMap?: Map<number, string>;
}) {
  const t = useTranslations("ip");

  const cover = ipImageUrl(project.bannerLink);
  const avatar = userAvatarUrl(project.ownerAvatar);
  const cat = categories[String(project.typeId)] ?? "";
  const tags = resolveTagNames(parseTagIds(project.tag), tagMap ?? new Map()).slice(0, 3);
  const ownerName = (project.ownerName || "").trim() || "Anonymous";
  const initial = ownerName.slice(0, 1).toUpperCase();
  const fallbackTone = avatarFallbackTone(project.ownerId ?? project.id);

  return (
    <Link
      href={`/ips/${project.id}`}
      className="group mb-6 inline-block w-full break-inside-avoid overflow-hidden rounded-2xl bg-card align-top transition-all hover:shadow-lg hover:shadow-black/20"
    >
      {/* Cover. Forced to 16:9 so the layout reserves the slot before
          the image arrives — without a fixed aspect ratio, cards in the
          CSS-columns masonry shift downward as each image loads, which
          looks broken on slow networks. 16:9 matches the source banner
          ratio + the For You rail above, so cropping is minimal. */}
      <div className="relative aspect-video w-full overflow-hidden bg-secondary">
        {cover ? (
          <img
            src={cover}
            alt={project.name}
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <IconSparkles className="size-8 text-muted-foreground/20" />
          </div>
        )}

        {/* Bottom dim for legibility */}
        <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/15 to-transparent" />

        {/* Top-right: trailer */}
        {project.videoLink && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            <IconPlayerPlay className="size-3" />
            {t("trailer")}
          </span>
        )}

        {/* Title overlay */}
        <div className="absolute inset-x-3 bottom-2.5">
          <h3 className="line-clamp-2 text-sm font-bold leading-tight text-white transition-colors group-hover:text-primary">
            {project.name}
          </h3>
          {cat && <div className="mt-0.5 text-[10px] font-medium text-white/60">{cat}</div>}
        </div>
      </div>

      {/* Body */}
      <div className="space-y-3.5 px-5 py-4">
        {/* Description */}
        {project.description && (
          <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {project.description}
          </p>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Owner row */}
        <div className="flex items-center gap-2 text-xs">
          {avatar ? (
            <img src={avatar} alt="" className="size-6 shrink-0 rounded-full object-cover" />
          ) : (
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                fallbackTone
              )}
            >
              {initial}
            </span>
          )}
          <span className="truncate font-medium text-foreground">{ownerName}</span>
        </div>
      </div>
    </Link>
  );
}
