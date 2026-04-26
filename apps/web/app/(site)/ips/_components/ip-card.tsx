"use client";

import { IconEye, IconHeart, IconPlayerPlay, IconAward } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { STAGE_CONFIG, type IPItem } from "../_data/ip";

// ─── Sub-bars ────────────────────────────────────────

function InvestmentBar({ ip }: { ip: IPItem }) {
  const t = useTranslations("ip");
  const pct = ip.totalShares ? Math.round(((ip.sharesSold ?? 0) / ip.totalShares) * 100) : 0;
  const remaining = (ip.totalShares ?? 0) - (ip.sharesSold ?? 0);

  return (
    <div className="mt-3 border-t border-border/50 pt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t("valuation")}{" "}
          <span className="font-semibold text-foreground">
            {"\u00A5"}
            {((ip.valuation ?? 0) / 10000).toFixed(0)}
            {t("tenThousand")}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {t("offering")} <span className="font-semibold text-amber-400">{ip.sharesOffered}%</span>
        </span>
      </div>
      <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-amber-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {ip.sharesSold}/{ip.totalShares} {t("subscribed")}
        </span>
        {remaining > 0 ? (
          <span className="text-xs font-semibold text-amber-400">
            {t("remaining", { count: remaining })} · {"\u00A5"}
            {((ip.pricePerShare ?? 0) / 10000).toFixed(0)}
            {t("tenThousandPerShare")}
          </span>
        ) : (
          <span className="text-xs font-semibold text-green-400">
            {"\u2713"} {t("fullySubscribed")}
          </span>
        )}
      </div>
    </div>
  );
}

function PresaleBar({ ip }: { ip: IPItem }) {
  const t = useTranslations("ip");
  const pct = ip.presaleTarget
    ? Math.round(((ip.presaleCurrent ?? 0) / ip.presaleTarget) * 100)
    : 0;
  const isFull = (ip.presaleCurrent ?? 0) >= (ip.presaleTarget ?? 1);

  return (
    <div className="mt-3 border-t border-border/50 pt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t("presaleLabel")}{" "}
          <span className="font-semibold text-blue-400">
            {"\u00A5"}
            {ip.presalePrice}
          </span>
          <span className="ml-1 text-muted-foreground">
            ({t("fullPrice")} {"\u00A5"}
            {ip.fullPrice})
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {ip.presaleCurrent}/{ip.presaleTarget} {t("people")}
        </span>
      </div>
      <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isFull ? "bg-green-400" : "bg-blue-400"
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        {isFull ? (
          <span className="text-xs font-semibold text-green-400">
            {"\u2713"} {t("presaleReached")}
          </span>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">
              {t("needMore", { count: (ip.presaleTarget ?? 0) - (ip.presaleCurrent ?? 0) })}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("deadline")} {ip.presaleDeadline}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── IPCard ──────────────────────────────────────────

export function IPCard({ ip }: { ip: IPItem }) {
  const t = useTranslations("ip");
  const stage = STAGE_CONFIG[ip.stage];

  return (
    <a
      href={`/ips/${ip.id}`}
      className="group block overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-border/80"
    >
      {/* Cover */}
      <div className="relative h-44 overflow-hidden">
        <img
          src={ip.cover}
          alt={ip.title}
          className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* Badges top-left */}
        <div className="absolute left-3 top-3 flex gap-1.5">
          <span
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
              stage.badge
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                stage.dot,
                (ip.stage === "investment" || ip.stage === "presale") && "animate-pulse"
              )}
            />
            {t(stage.labelKey)}
          </span>
          {ip.featured && (
            <span className="flex items-center gap-1 rounded-full bg-amber-400/90 px-2 py-0.5 text-xs font-semibold text-black">
              <IconAward className="size-3" /> {t("featured")}
            </span>
          )}
        </div>

        {/* Trailer badge top-right */}
        {ip.trailer && (
          <div className="absolute right-3 top-3">
            <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
              <IconPlayerPlay className="size-3" /> {t("trailer")}
            </span>
          </div>
        )}

        {/* Title + progress at bottom */}
        <div className="absolute bottom-3 left-3 right-3">
          <h3 className="text-base font-bold leading-tight text-white transition-colors group-hover:text-accent">
            {ip.title}
          </h3>
          {ip.stage === "producing" && (
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-violet-400"
                  style={{ width: `${ip.progress}%` }}
                />
              </div>
              <span className="text-xs text-white/70">
                {ip.episodes}/{ip.targetEpisodes} {t("eps")}
              </span>
            </div>
          )}
          {ip.stage === "released" && (
            <span className="mt-0.5 block text-xs text-white/70">
              {t("allEps", { count: ip.episodes ?? 0 })} · {"\u00A5"}
              {ip.watchPrice} {t("toUnlock")}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{ip.desc}</p>
        <div className="mb-3 flex flex-wrap gap-1">
          {ip.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {ip.author[0]}
            </div>
            <span className="font-medium text-foreground">{ip.author}</span>
            <span className="font-semibold text-amber-400">{ip.authorLevel}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1">
              <IconEye className="size-3" />
              {(ip.views / 1000).toFixed(1)}k
            </span>
            <span className="flex items-center gap-1">
              <IconHeart className="size-3" />
              {ip.likes}
            </span>
          </div>
        </div>

        {ip.stage === "investment" && <InvestmentBar ip={ip} />}
        {ip.stage === "presale" && <PresaleBar ip={ip} />}
      </div>
    </a>
  );
}
