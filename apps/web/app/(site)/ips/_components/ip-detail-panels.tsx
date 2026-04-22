"use client";

import {
  IconTrendingUp,
  IconMovie,
  IconCircleCheck,
  IconPlayerPlay,
  IconShare,
  IconHeart,
  IconBookmark,
  IconChevronRight,
  IconStar,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import type { IPDetail } from "./ip-mock";

// ─── Investment Panel ────────────────────────────────

export function InvestmentPanel({ ip }: { ip: IPDetail }) {
  const t = useTranslations("ip");
  const pct = ip.totalShares ? Math.round(((ip.sharesSold ?? 0) / ip.totalShares) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <IconTrendingUp className="size-5 text-primary" />
        <h3 className="text-sm font-bold text-foreground">{t("detailEquitySub")}</h3>
      </div>
      <div className="space-y-3">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{t("valuation")}</span>
          <span className="font-medium text-foreground">
            {"\u00A5"}
            {((ip.valuation ?? 0) / 10000).toFixed(0)}
            {t("tenThousand")}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{t("offering")}</span>
          <span className="font-medium text-foreground">{ip.sharesOffered}%</span>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted-foreground">{t("detailFundingProgress")}</span>
            <span className="font-medium text-primary">{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>
              {t("detailRaised")}{" "}
              {(((ip.sharesSold ?? 0) * (ip.pricePerShare ?? 0)) / 10000).toFixed(0)}
              {t("tenThousand")}
            </span>
            <span>
              {t("detailTarget")}{" "}
              {(((ip.valuation ?? 0) * (ip.sharesOffered ?? 0)) / 100 / 10000).toFixed(0)}
              {t("tenThousand")}
            </span>
          </div>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{t("detailPricePerShare")}</span>
          <span className="text-foreground">
            {"\u00A5"}
            {ip.pricePerShare}
          </span>
        </div>
        <a
          href={`/ips/${ip.id}/invest`}
          className="mt-2 block w-full rounded-lg bg-primary py-2.5 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t("subscribeNow")}
        </a>
      </div>
    </div>
  );
}

// ─── Producing Panel ─────────────────────────────────

export function ProducingPanel({ ip }: { ip: IPDetail }) {
  const t = useTranslations("ip");
  const completedCount = ip.episodeList.filter((_, i) => i < (ip.episodes ?? 0)).length;
  const progress = ip.targetEpisodes ? Math.round((completedCount / ip.targetEpisodes) * 100) : 0;

  return (
    <div className="rounded-xl border border-violet-400/20 bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <IconMovie className="size-5 text-violet-400" />
        <h3 className="text-sm font-bold text-foreground">{t("detailProductionProgress")}</h3>
      </div>
      <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-violet-400" style={{ width: `${progress}%` }} />
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        {completedCount}/{ip.targetEpisodes} {t("eps")}
      </p>
      <div className="mb-4 space-y-2">
        {ip.episodeList.map((ep) => (
          <div
            key={ep.number}
            className="flex items-center justify-between rounded-lg bg-secondary/50 p-2"
          >
            <span className="text-xs text-foreground">
              Ep.{ep.number} {ep.title}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {ep.number <= (ip.episodes ?? 0) ? t("detailCompleted") : t("detailInProd")}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">{t("detailInvestorEarlyAccess")}</p>
    </div>
  );
}

// ─── Released Panel ──────────────────────────────────

export function ReleasedPanel({ ip }: { ip: IPDetail }) {
  const t = useTranslations("ip");

  return (
    <div className="rounded-xl border border-green-400/20 bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <IconCircleCheck className="size-5 text-green-400" />
        <h3 className="text-sm font-bold text-foreground">{t("detailPurchaseWatch")}</h3>
      </div>

      {/* Bundle */}
      <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">{t("detailFullBundle")}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground line-through">
              {"\u00A5"}
              {ip.singleTotal}
            </span>
            <span className="text-base font-bold text-primary">
              {"\u00A5"}
              {ip.bundlePrice}
            </span>
          </div>
        </div>
        <p className="mb-2 text-[10px] text-muted-foreground">
          {t("detailBundleDesc", {
            count: ip.episodeList.length,
            save: ip.singleTotal - ip.bundlePrice,
          })}
        </p>
        <button
          type="button"
          className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t("detailBuyBundle")}
        </button>
      </div>

      {/* Episodes */}
      <div className="space-y-2">
        {ip.episodeList.map((ep) => (
          <div
            key={ep.number}
            className="flex items-center justify-between rounded-lg bg-secondary/50 p-2.5"
          >
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded bg-secondary text-[10px] font-bold text-muted-foreground">
                {String(ep.number).padStart(2, "0")}
              </div>
              <span className="text-xs text-foreground">{ep.title}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground">
                {"\u00A5"}
                {ep.price}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20"
              >
                <IconPlayerPlay className="size-3" />
                {t("detailPlay")}
              </button>
              <button
                type="button"
                className="rounded-md bg-secondary px-2.5 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-secondary/80"
              >
                {t("detailBuy")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Funding Sidebar ─────────────────────────────────

export function FundingSidebar({ ip }: { ip: IPDetail }) {
  const t = useTranslations("ip");

  return (
    <div className="sticky top-28 space-y-4">
      {/* Team list */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t("detailCreativeTeam")}</h3>
        <div className="space-y-3">
          {ip.team.map((member) => (
            <div key={member.name} className="flex items-center gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm">
                {member.avatar}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground">{member.name}</span>
                  <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                    {member.level}
                  </span>
                  {member.certified && <IconCircleCheck className="size-3 text-green-400" />}
                </div>
                <span className="text-[10px] text-muted-foreground">{member.role}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stage panel */}
      {ip.stage === "investment" && <InvestmentPanel ip={ip} />}
      {ip.stage === "producing" && <ProducingPanel ip={ip} />}
      {ip.stage === "released" && <ReleasedPanel ip={ip} />}

      {/* Share buttons */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t("share")}</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-secondary py-2 text-xs text-foreground transition-colors hover:bg-secondary/80"
          >
            <IconShare className="size-3.5" /> {t("share")}
          </button>
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-secondary py-2 text-xs text-foreground transition-colors hover:bg-secondary/80"
          >
            <IconHeart className="size-3.5" /> {t("detailLike")}
          </button>
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-secondary py-2 text-xs text-foreground transition-colors hover:bg-secondary/80"
          >
            <IconBookmark className="size-3.5" /> {t("detailSave")}
          </button>
        </div>
      </div>

      {/* Producer card */}
      <a
        href={`/creators/${ip.id}`}
        className="block rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30"
      >
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t("detailProducer")}</h3>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary text-lg">
            🎬
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-foreground">{ip.author}</span>
              <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                {ip.authorLevel}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">{t("detailViewProfile")}</span>
          </div>
          <IconChevronRight className="size-4 text-muted-foreground" />
        </div>
      </a>
    </div>
  );
}
