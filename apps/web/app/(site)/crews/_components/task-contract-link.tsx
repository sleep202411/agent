"use client";
import Link from "next/link";
import { IconFileText, IconArrowUpRight } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";

/** The Asset Center rechecks file access before previewing or downloading. */
export function TaskContractLink({ crewId, assetId }: { crewId: string; assetId?: string | null }) {
  const locale = useLocale(),
    t = useTranslations("crewTasks");
  if (!assetId) return null;
  return (
    <Link
      className="inline-flex items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
      href={`/${locale}/crews/${encodeURIComponent(crewId)}/workspace?tab=assets&asset=${encodeURIComponent(assetId)}`}
    >
      <IconFileText className="size-4" />
      {t("viewContract")}
      <IconArrowUpRight className="size-4" />
    </Link>
  );
}
