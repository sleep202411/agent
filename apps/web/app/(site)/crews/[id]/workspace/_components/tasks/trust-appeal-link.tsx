"use client";
import Link from "next/link";
import { useCrewPermissions } from "@/app/(site)/crews/_hooks/use-crew-permissions";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
export function TrustAppealLink({ crewId }: { crewId: string }) {
  const permissions = useCrewPermissions(crewId),
    locale = useLocale(),
    t = useTranslations("trustAppeals");
  return permissions.can("tasks.manage") ? (
    <Link
      className="shrink-0 px-2 text-xs underline"
      href={`/${locale}/crews/${crewId}/trust-appeals`}
    >
      {t("queue")}
    </Link>
  ) : null;
}
