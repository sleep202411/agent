"use client";

import Link from "next/link";
import { localizePath } from "@/src/i18n/locale-url";
import { useLocale } from "@/src/i18n/i18n";
import { IconCube, IconLink } from "@tabler/icons-react";
import { toast } from "sonner";

import { useCrewProductionOverview } from "@/app/(site)/crews/_hooks/use-production";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { CrewStudioWorkspacePicker } from "./crew-studio-workspace-picker";

export function CrewWorkbenchHeader({
  crewId,
  crewName,
  pageTitle,
  showProductionActions,
}: {
  crewId: string;
  crewName: string;
  pageTitle: string;
  showProductionActions: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("crewTaskProject");
  const tw = useTranslations("crewWorkbench");
  const overview = useCrewProductionOverview(crewId, showProductionActions);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t("projectLinkCopied"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projectLinkCopyFailed"));
    }
  };

  return (
    <header
      aria-label={tw("header")}
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.065] bg-[#0b0c0f] px-3 py-3 sm:flex-nowrap"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[#e52227]/10 text-[#ef4444]">
        <IconCube className="size-4" stroke={1.8} />
      </span>
      <div className="flex min-w-0 flex-1 basis-24 items-center gap-2 sm:basis-auto">
        <h1 className="truncate text-[13px] font-semibold text-[#e8e9ec]" title={crewName}>
          {crewName}
        </h1>
        <span aria-hidden="true" className="hidden text-[#454a53] sm:block">
          /
        </span>
        <span className="hidden shrink-0 text-xs text-[#858a95] sm:block">{pageTitle}</span>
      </div>
      <div className="ml-auto flex min-w-0 max-w-full shrink-0 items-center gap-2">
        {showProductionActions ? (
          <CrewStudioWorkspacePicker
            key={crewId}
            crewId={crewId}
            value={overview.data?.studioWorkspace ?? null}
            disabled={!overview.data?.capabilities.linkWorkspace}
          />
        ) : null}
        {showProductionActions && overview.data?.studioProject ? (
          <Link
            className="rounded-md px-2 py-2 text-xs text-[#858a95] hover:text-white"
            href={localizePath(
              `/fizzstudio/billing?${new URLSearchParams({ workspaceId: overview.data.studioProject.workspace.id, projectId: overview.data.studioProject.id })}`,
              locale === "zh-CN" || locale === "zh-HK" ? locale : "en-US"
            )}
          >
            {tw("projectUsage")}
          </Link>
        ) : null}
        <Button
          color="muted"
          variant="ghost"
          onClick={() => void copyLink()}
          className="rounded-md text-xs"
          icon={<IconLink className="size-3.5" />}
        >
          {t("copyProjectLink")}
        </Button>
      </div>
    </header>
  );
}
