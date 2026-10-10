"use client";

import { IconAward, IconRefresh } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { useAssignedCourseCertificate } from "@/src/hooks/use-courses-public";
import { CertificateBadge } from "./CertificateBadge";

export function CourseCertificate({ courseId }: { courseId: string | number }) {
  const t = useTranslations("courses");
  const id = Number(courseId);
  const query = useAssignedCourseCertificate(Number.isSafeInteger(id) && id > 0 ? id : null);
  const certificate = query.data ?? null;

  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center">
        {certificate ? (
          <CertificateBadge name={certificate.name} iconUrl={certificate.iconUrl} size="md" />
        ) : (
          <IconAward className="size-5 text-[#d4b06a]" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-[#6f7585]">{t("skillCertificate")}</p>
        {query.isPending ? (
          <p className="mt-0.5 text-[13px] text-[#8b93a7]">{t("certificateLoading")}</p>
        ) : query.error ? (
          <div role="alert" className="mt-0.5 space-y-1">
            <p className="text-[13px] text-[#ff8a8a]">
              {query.error.message || t("certificateUnavailable")}
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-[#aeb6c8] underline-offset-2 hover:text-white hover:underline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <IconRefresh className="size-3" />
              {t("certificateRetry")}
            </button>
          </div>
        ) : certificate ? (
          <>
            <p className="mt-0.5 truncate text-[13px] font-medium text-white">{certificate.name}</p>
            <p className="mt-1 text-[11px] leading-4 text-[#6f7585]">{t("certificateApproval")}</p>
          </>
        ) : (
          <p className="mt-0.5 text-[13px] text-[#8b93a7]">{t("certificateUnassigned")}</p>
        )}
      </div>
    </div>
  );
}
