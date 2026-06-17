"use client";

import { useTranslations } from "next-intl";
import { IconChartBar } from "@tabler/icons-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/app/_components/workspace-context";
import { EmptyState, PageHeader, Panel, StatCard, TeamBadge } from "../_components/settings-ui";

/**
 * Usage Analytics — layout/IA modeled on imagine.art's Overview→Analytics, but
 * team-scoped usage has no backend yet, so every metric renders an honest empty
 * state (no fabricated numbers/charts). Wire to a real team usage feed later.
 */
export default function AnalyticsSettingsPage() {
  const t = useTranslations("settings");
  const { activeWorkspace: ws, loading } = useWorkspace();

  const notWired = {
    title: t("noUsageDataYet"),
    body: t("usageAnalyticsComingSoon"),
  };

  if (loading || !ws) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
      <PageHeader
        title={t("usageAnalytics")}
        badge={<TeamBadge label={ws.type === "personal" ? t("personal") : t("team")} />}
        subtitle={t("usageAnalyticsSubtitle")}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={t("totalJobs")} value="—" />
        <StatCard label={t("creditsIn")} value="—" />
        <StatCard label={t("creditsOut")} value="—" />
      </div>

      <Panel
        title={t("creditsUsage")}
        icon={<IconChartBar className="size-4 text-muted-foreground" />}
      >
        <EmptyState icon={<IconChartBar className="size-5" />} {...notWired} />
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title={t("modelsUsage")}>
          <EmptyState icon={<IconChartBar className="size-5" />} {...notWired} />
        </Panel>
        <Panel title={t("creditsSummary")}>
          <EmptyState icon={<IconChartBar className="size-5" />} {...notWired} />
        </Panel>
      </div>

      <Panel title={t("generations")}>
        <div className="grid grid-cols-[1.2fr_1fr_1fr_0.8fr_0.6fr] gap-2 px-1 pb-2 text-xs font-medium text-muted-foreground uppercase">
          <span>{t("colCompleted")}</span>
          <span>{t("colModel")}</span>
          <span>{t("colFeature")}</span>
          <span>{t("colStatus")}</span>
          <span className="text-right">{t("colCredits")}</span>
        </div>
        <div className="h-px bg-border" />
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">
          {t("noGenerationsYet")}
        </p>
      </Panel>
    </main>
  );
}
