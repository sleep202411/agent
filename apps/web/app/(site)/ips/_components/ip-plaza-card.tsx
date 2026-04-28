"use client";

import Link from "next/link";
import { IconSparkles, IconPlayerPlay, IconAward, IconEye, IconHeart } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { ipImageUrl, userAvatarUrl, type IPProject, type CategoryMap } from "../_hooks/use-ip";
import { STAGE_CONFIG } from "../_data/ip";
import {
  mockIPMeta,
  splitTags,
  avatarFallbackTone,
  compactNumber,
  type IPMockMeta,
} from "../_data/ip-mock";

/**
 * IP Plaza listing card. Renders the live `IPProject` payload plus a
 * deterministic mock meta layer (`mockIPMeta`) for fields the backend
 * doesn't expose yet — lifecycle stage, fundraising / pre-order numbers,
 * episode progress, FD level, view / like counts, featured flag.
 *
 * The card sits inside a CSS-columns masonry container, so it must use
 * `break-inside-avoid` and `inline-block w-full`. Cover images render at
 * their natural aspect ratio so heights vary across the grid.
 */

export function IPPlazaCard({
  project,
  categories,
}: {
  project: IPProject;
  categories: CategoryMap;
}) {
  const t = useTranslations("ip");
  const meta = mockIPMeta(project.id);
  const stageStyle = STAGE_CONFIG[meta.stage];

  const cover = ipImageUrl(project.bannerLink);
  const avatar = userAvatarUrl(project.ownerAvatar);
  const cat = categories[String(project.typeId)] ?? "";
  const tags = splitTags(project.tag);
  const ownerName = (project.ownerName || "").trim() || "Anonymous";
  const initial = ownerName.slice(0, 1).toUpperCase();
  const fallbackTone = avatarFallbackTone(project.ownerId ?? project.id);

  return (
    <Link
      href={`/ips/${project.id}`}
      className="group mb-6 inline-block w-full break-inside-avoid overflow-hidden rounded-2xl bg-card align-top transition-all hover:shadow-lg hover:shadow-black/20"
    >
      {/* Cover */}
      <div className="relative overflow-hidden">
        {cover ? (
          <img
            src={cover}
            alt={project.name}
            className="block w-full transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-secondary">
            <IconSparkles className="size-8 text-muted-foreground/20" />
          </div>
        )}

        {/* Bottom dim for legibility */}
        <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/15 to-transparent" />

        {/* Top-left: stage + featured */}
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          <span
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm",
              stageStyle.badge
            )}
          >
            <span className={cn("size-1.5 rounded-full", stageStyle.dot)} />
            {t(stageStyle.labelKey)}
          </span>
          {meta.featured && (
            <span className="flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 backdrop-blur-sm">
              <IconAward className="size-3" />
              {t("featured")}
            </span>
          )}
        </div>

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
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex min-w-0 items-center gap-2">
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
            <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 py-px text-[11px] font-bold text-primary">
              {meta.level}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2.5 text-muted-foreground">
            <span className="flex items-center gap-1">
              <IconEye className="size-3.5" />
              {compactNumber(meta.views)}
            </span>
            <span className="flex items-center gap-1">
              <IconHeart className="size-3.5" />
              {compactNumber(meta.likes)}
            </span>
          </div>
        </div>

        {/* Stage-specific footer */}
        <StageFooter meta={meta} />
      </div>
    </Link>
  );
}

// ─── Stage-specific footer ───────────────────────────

function StageFooter({ meta }: { meta: IPMockMeta }) {
  const t = useTranslations("ip");

  if (meta.stage === "investment") {
    const pct = Math.min(100, Math.round((meta.sharesSold / meta.totalShares) * 100));
    const fullySubscribed = meta.sharesSold >= meta.totalShares;
    const remaining = meta.totalShares - meta.sharesSold;
    return (
      <div className="border-t border-border pt-3.5 text-xs">
        <div className="mb-1 flex items-center justify-between text-muted-foreground">
          <span>
            {t("valuation")}{" "}
            <span className="font-semibold text-foreground">
              ¥{compactNumber(meta.valuation * 10000)}
            </span>
          </span>
          <span>
            {t("offering")}{" "}
            <span className="font-semibold text-amber-400">{meta.sharesOffered}%</span>
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/5">
          <div className="h-full bg-amber-400/80" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between text-muted-foreground">
          <span>
            {meta.sharesSold}/{meta.totalShares} {t("subscribed")}
          </span>
          <span className="font-medium text-amber-400">
            {fullySubscribed
              ? t("fullySubscribed")
              : `${t("remaining", { count: remaining })} · ¥${meta.pricePerShare}万/${t("offering").toLowerCase()}`}
          </span>
        </div>
      </div>
    );
  }

  if (meta.stage === "presale") {
    const pct = Math.min(100, Math.round((meta.presaleCurrent / meta.presaleTarget) * 100));
    const reached = meta.presaleCurrent >= meta.presaleTarget;
    const remaining = Math.max(0, meta.presaleTarget - meta.presaleCurrent);
    return (
      <div className="border-t border-border pt-3.5 text-xs">
        <div className="mb-1 flex items-center justify-between text-muted-foreground">
          <span>
            {t("presaleLabel")}{" "}
            <span className="font-semibold text-blue-400">¥{meta.presalePrice}</span>{" "}
            <span className="text-muted-foreground/70">
              ({t("fullPrice")} ¥{meta.fullPrice})
            </span>
          </span>
          <span>
            {meta.presaleCurrent}/{meta.presaleTarget} {t("people")}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/5">
          <div className="h-full bg-blue-400/80" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between text-muted-foreground">
          <span className="font-medium text-blue-400">
            {reached ? t("presaleReached") : t("needMore", { count: remaining })}
          </span>
          <span>
            {t("deadline")} {meta.presaleDeadline}
          </span>
        </div>
      </div>
    );
  }

  if (meta.stage === "producing") {
    const pct = Math.round((meta.episodes / meta.targetEpisodes) * 100);
    return (
      <div className="border-t border-border pt-3.5 text-xs">
        <div className="mb-1 flex items-center justify-between text-muted-foreground">
          <span className="font-medium text-violet-300">{t("stageProducing")}</span>
          <span className="font-semibold text-foreground">
            {meta.episodes}/{meta.targetEpisodes} {t("eps")}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/5">
          <div className="h-full bg-violet-400/80" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  // released
  return (
    <div className="border-t border-border pt-3.5 text-xs text-muted-foreground">
      <span className="font-medium text-emerald-300">
        {t("allEps", { count: meta.targetEpisodes })}
      </span>
      <span className="mx-1">·</span>
      <span className="font-semibold text-foreground">¥{meta.watchPrice}</span>{" "}
      <span>{t("toUnlock")}</span>
    </div>
  );
}
