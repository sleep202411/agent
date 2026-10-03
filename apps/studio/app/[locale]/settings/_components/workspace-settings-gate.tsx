"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useWorkspace } from "@/app/_components/workspace-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, Panel } from "./settings-ui";

/** Workspace-dependent settings must recover before mounting scoped controls. */
export function WorkspaceSettingsGate({ title, children }: { title: string; children: ReactNode }) {
  const { activeWorkspace, loading, error, fetching, refresh } = useWorkspace();
  const t = useTranslations("settings");
  const common = useTranslations("common");
  if (!loading && activeWorkspace && !error) return children;
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader title={title} />
      {loading ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : (
        <Panel>
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
          >
            <span>{error?.message || t("workspaceUnavailable")}</span>
            <Button variant="secondary" size="sm" disabled={fetching} onClick={() => refresh()}>
              {common("retry")}
            </Button>
          </div>
        </Panel>
      )}
    </main>
  );
}
