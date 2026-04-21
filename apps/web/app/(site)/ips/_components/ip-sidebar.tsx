"use client";

import { IconCurrencyDollar, IconChartBar, IconBolt } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { STAGE_CONFIG, type IPItem } from "./ip-mock";

interface IPSidebarProps {
  ips: IPItem[];
}

export function IPSidebar({ ips }: IPSidebarProps) {
  const t = useTranslations("ip");
  const trending = [...ips].sort((a, b) => b.views - a.views).slice(0, 5);

  return (
    <div className="hidden w-64 shrink-0 space-y-4 xl:block">
      {/* How to Participate */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <IconCurrencyDollar className="size-4 text-accent" />
          <span className="text-sm font-semibold">{t("howToParticipate")}</span>
        </div>
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
            <div className="mb-1 text-xs font-semibold text-amber-400">{t("investorSubTitle")}</div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("investorSubDesc")}</p>
          </div>
          <div className="rounded-lg border border-blue-400/20 bg-blue-400/5 p-3">
            <div className="mb-1 text-xs font-semibold text-blue-400">{t("audiencePreTitle")}</div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("audiencePreDesc")}</p>
          </div>
        </div>
      </div>

      {/* Trending */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <IconChartBar className="size-4 text-accent" />
          <span className="text-sm font-semibold">{t("trending")}</span>
        </div>
        <div className="space-y-2.5">
          {trending.map((ip, i) => {
            const stage = STAGE_CONFIG[ip.stage];
            return (
              <div key={ip.id} className="flex items-center gap-2.5">
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded text-xs font-black ${
                    i === 0 ? "bg-amber-400 text-black" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">{ip.title}</div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs ${stage.badge.split(" ")[0]}`}>
                      {t(stage.labelKey)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {(ip.views / 1000).toFixed(1)}k
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* I Have an IP */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <IconBolt className="size-4 text-accent" />
          <span className="text-sm font-semibold">{t("iHaveIP")}</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t("iHaveIPDesc")}</p>
        <a
          href="/ips/create"
          className="block w-full rounded-lg border border-accent/30 bg-accent/10 py-2 text-center text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
        >
          {t("publishNow")}
        </a>
      </div>
    </div>
  );
}
