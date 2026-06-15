"use client";

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
  const { activeWorkspace: ws, loading } = useWorkspace();

  const notWired = {
    title: "No usage data yet",
    body: "Team usage analytics will appear here once the team usage feed is wired up.",
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
        title="Usage Analytics"
        badge={<TeamBadge label={ws.type === "personal" ? "Personal" : "Team"} />}
        subtitle="A summary of credits usage for this workspace."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Total jobs" value="—" />
        <StatCard label="Credits in" value="—" />
        <StatCard label="Credits out" value="—" />
      </div>

      <Panel title="Credits usage" icon={<IconChartBar className="size-4 text-muted-foreground" />}>
        <EmptyState icon={<IconChartBar className="size-5" />} {...notWired} />
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Models usage">
          <EmptyState icon={<IconChartBar className="size-5" />} {...notWired} />
        </Panel>
        <Panel title="Credits summary">
          <EmptyState icon={<IconChartBar className="size-5" />} {...notWired} />
        </Panel>
      </div>

      <Panel title="Generations">
        <div className="grid grid-cols-[1.2fr_1fr_1fr_0.8fr_0.6fr] gap-2 px-1 pb-2 text-xs font-medium text-muted-foreground uppercase">
          <span>Completed</span>
          <span>Model</span>
          <span>Feature</span>
          <span>Status</span>
          <span className="text-right">Credits</span>
        </div>
        <div className="h-px bg-border" />
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">No generations yet.</p>
      </Panel>
    </main>
  );
}
