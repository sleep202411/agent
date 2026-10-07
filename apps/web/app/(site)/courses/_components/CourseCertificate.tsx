"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { useTranslations } from "@/src/i18n/i18n";

type CourseCertificateResponse = {
  courseId: string;
  certificate: { id: number; name: string } | null;
};

export function CourseCertificate({ courseId }: { courseId: string | number }) {
  const t = useTranslations("courses");
  const query = useQuery({
    queryKey: ["academy-course-certificate", String(courseId)],
    queryFn: ({ signal }) =>
      api.get<CourseCertificateResponse>(
        `/aurora/academy/course-certificates/${encodeURIComponent(String(courseId))}`,
        { signal }
      ),
    retry: false,
  });
  return (
    <div className="mt-3 text-[13px] text-[#aeb6c8]">
      <p className="font-medium text-white">{t("skillCertificate")}</p>
      {query.isPending ? (
        <p>{t("certificateLoading")}</p>
      ) : query.error ? (
        <div role="alert">
          <p>{query.error.message || t("certificateUnavailable")}</p>
          <button
            type="button"
            className="mt-1 underline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("certificateRetry")}
          </button>
        </div>
      ) : query.data?.certificate ? (
        <>
          <p>{query.data.certificate.name}</p>
          <p className="mt-1 text-xs">{t("certificateApproval")}</p>
        </>
      ) : (
        <p>{t("certificateUnassigned")}</p>
      )}
    </div>
  );
}
