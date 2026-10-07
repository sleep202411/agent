"use client";

import Link from "next/link";
import { IconArrowBackUp } from "@tabler/icons-react";
import { encodeUserId } from "@repo/shared";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import type { PublicCourseDetailView } from "@/src/hooks/use-courses-public";
import { resolveCourseCoverUrl } from "@/src/services/courses-public";
import { CourseCertificate } from "./CourseCertificate";

interface PublicCourseDetailPanelProps {
  detail: PublicCourseDetailView;
  onVideoSelect: (videoId: number) => void;
}

function formatUpdateTime(updateTime: string, locale: string) {
  if (!updateTime) return "";
  const date = new Date(updateTime);
  if (Number.isNaN(date.getTime())) return updateTime;
  return date.toLocaleDateString(locale);
}

export function PublicCourseDetailPanel({ detail, onVideoSelect }: PublicCourseDetailPanelProps) {
  const t = useTranslations("courses");
  const locale = useLocale() as Locale;

  return (
    <aside className="flex w-full flex-col border-t border-[#171722] bg-[#07070c] px-5 py-5 text-white sm:px-6 lg:h-full lg:min-h-0 lg:w-[480px] lg:border-t-0 lg:border-l xl:w-[520px]">
      {/* Header stays compact so the playlist keeps most of the column height. */}
      <div className="shrink-0 border-b border-[#1d1d29] pb-4">
        <Link
          href={localizePath("/courses", locale)}
          className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-[#aeb6c8] transition-colors hover:text-white"
        >
          <IconArrowBackUp className="size-4" />
          <span>{t("backToCourses")}</span>
        </Link>
        <h1 className="line-clamp-2 text-lg font-bold leading-snug">{detail.title}</h1>
        {detail.description ? (
          <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-[#aeb6c8]">
            {detail.description}
          </p>
        ) : null}

        <CourseCertificate key={detail.courseId} courseId={detail.courseId} />
        {detail.instructors.length > 0 ? (
          <div className="mt-3 flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-[#6f7585]">{t("instructors")}</span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {detail.instructors.map((instructor) => {
                const name = instructor.nickName.trim() || t("unknownInstructor");
                return (
                  <Link
                    key={instructor.userId}
                    href={localizePath(`/creators/${encodeUserId(instructor.userId)}`, locale)}
                    className="inline-flex max-w-[46%] items-center gap-1.5 text-[12px] font-medium text-[#d5dbe8] transition-colors hover:text-white"
                  >
                    <UserAvatar
                      src={instructor.avatar}
                      seed={instructor.userId}
                      name={name}
                      size={22}
                      className="size-[22px] shrink-0"
                    />
                    <span className="truncate">{name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}

        {detail.updateTime ? (
          <p className="mt-2.5 text-[11px] text-[#6f7585]">
            {formatUpdateTime(detail.updateTime, locale)}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <h2 className="shrink-0 text-[15px] font-bold">
          {t("courseDirectory")}
          {detail.videos.length > 0 ? (
            <span className="ml-2 text-[13px] font-medium text-[#6f7585]">
              {detail.videos.length}
            </span>
          ) : null}
        </h2>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#2a2a39]">
          <div className="space-y-2 pb-2">
            {detail.videos.map((video, index) => {
              const active = video.id === detail.currentVideoId;
              const cover = resolveCourseCoverUrl(video.coverUrl) || detail.coverUrl;
              return (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => onVideoSelect(video.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border border-transparent bg-[#111119] p-2 text-left transition-colors hover:border-[#3a3a4d]",
                    active && "border-[#6f222d] bg-[#3b141d] text-[#ff5967]"
                  )}
                >
                  <span className="relative aspect-video w-[120px] shrink-0 overflow-hidden rounded-md bg-[#1c1c27]">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" className="size-full object-cover" />
                    ) : null}
                    <span
                      className={cn(
                        "absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded bg-black/75 text-[11px] font-bold text-white",
                        active && "bg-[#f0444c]"
                      )}
                    >
                      {index + 1}
                    </span>
                  </span>
                  <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-5">
                    {video.title.trim() || t("untitledLesson")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
