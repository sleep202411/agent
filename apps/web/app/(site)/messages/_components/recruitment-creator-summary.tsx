"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { IconArrowUpRight, IconRosetteDiscountCheck, IconVideo } from "@tabler/icons-react";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { api } from "@/src/lib/api";
import { env } from "@/src/env";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { encodeUserId } from "@/src/lib/user-id-codec";
import { isCreatorQualification } from "@/src/services/creator-qualification";

type Profile = {
  info?: { nickName?: string; name?: string; avatar?: string | null; description?: string };
  level?: { id: number; type?: number; name?: string }[];
};
type Work = { id: number; title?: string; videoBanner?: string | null };

function assetUrl(path: string | null | undefined, base: string) {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Public creator data only; applicant identity must not follow the conversation peer. */
export function RecruitmentCreatorSummary({
  applicantId,
  viewerId,
  name,
  avatar,
}: {
  applicantId: string;
  viewerId: string;
  name: string;
  avatar?: string | null;
}) {
  const locale = useLocale();
  const t = useTranslations("crewCommunications");
  const href = `/${locale}/creators/${encodeUserId(applicantId)}`;
  const profile = useQuery({
    queryKey: ["recruitment-creator", viewerId, applicantId, locale],
    queryFn: ({ signal }) =>
      api.post<Profile>("/user/other/user/info", {
        params: { UserId: applicantId },
        raw: true,
        signal,
      }),
    retry: false,
    staleTime: 60_000,
  });
  const works = useQuery({
    queryKey: ["recruitment-creator-works", viewerId, applicantId, locale],
    queryFn: ({ signal }) =>
      api.postForm<Work[]>(
        "/vedio/query/user/personal",
        {
          userId: applicantId,
          page: "1",
          pageSize: "3",
        },
        { signal }
      ),
    retry: false,
    staleTime: 60_000,
  });
  const info = !profile.isError ? profile.data?.info : undefined;
  const displayName = info?.nickName?.trim() || info?.name?.trim() || name;
  const levels =
    !profile.isError && Array.isArray(profile.data?.level)
      ? profile.data.level.filter((level) => isCreatorQualification(level) && level.name?.trim())
      : [];
  const portfolio =
    !works.isError && Array.isArray(works.data) ? works.data.filter(Boolean).slice(0, 3) : [];
  return (
    <div className="space-y-5">
      <section className="space-y-3" aria-label={t("applicant")}>
        <p className="text-xs font-medium text-muted-foreground">{t("applicant")}</p>
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex min-w-0 items-center gap-3"
        >
          <UserAvatar
            name={displayName}
            src={assetUrl(info?.avatar, env.USER_BASE_URL || env.OSS_BASE_URL) || avatar}
            seed={applicantId}
            size={44}
          />
          <span className="min-w-0 flex-1 break-words text-sm font-semibold group-hover:text-primary">
            {displayName}
          </span>
          <IconArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
        {profile.isPending ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t("profileLoading")}
          </p>
        ) : profile.isError ? (
          <div role="alert" className="space-y-2 text-xs">
            <p className="break-words">{profile.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={profile.isFetching}
              onClick={() => void profile.refetch()}
            >
              {t("retryProfile")}
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">{t("qualifications")}</h3>
              {levels.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {levels.map((level) => (
                    <li
                      key={level.id}
                      className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 text-xs"
                    >
                      <IconRosetteDiscountCheck className="size-3.5 shrink-0" />
                      {level.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t("noQualifications")}</p>
              )}
            </div>
            {info?.description?.trim() && (
              <p className="line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground">
                {info.description}
              </p>
            )}
          </>
        )}
      </section>
      <section className="space-y-3 border-t border-border pt-4" aria-label={t("pastWork")}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">{t("pastWork")}</h3>
          <Link
            href={`${href}#creator-section-works`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("viewPortfolio")} ↗
          </Link>
        </div>
        {works.isPending ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t("worksLoading")}
          </p>
        ) : works.isError ? (
          <div role="alert" className="space-y-2 text-xs">
            <p className="break-words">{works.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={works.isFetching}
              onClick={() => void works.refetch()}
            >
              {t("retryWorks")}
            </Button>
          </div>
        ) : portfolio.length ? (
          <ul className="space-y-2">
            {portfolio.map((work) => (
              <li key={work.id}>
                <Link
                  href={`${href}#creator-section-works`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 rounded-md p-1 hover:bg-white/5"
                >
                  <span className="flex aspect-video w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/5">
                    {assetUrl(work.videoBanner, env.BANNER_BASE_URL) ? (
                      <img
                        src={assetUrl(work.videoBanner, env.BANNER_BASE_URL)}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <IconVideo className="size-5 text-muted-foreground" />
                    )}
                  </span>
                  <span className="line-clamp-2 break-words text-xs leading-relaxed">
                    {work.title?.trim() || t("untitledWork")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t("noPastWork")}</p>
        )}
      </section>
    </div>
  );
}
