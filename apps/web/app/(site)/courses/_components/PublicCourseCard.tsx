"use client";

import Image from "next/image";
import Link from "next/link";
import { encodeUserId } from "@repo/shared";
import { UserAvatar } from "@/components/user-avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import {
  useAssignedCourseCertificate,
  type PublicCourseCardModel,
} from "@/src/hooks/use-courses-public";
import { resolveCourseCoverUrl, type PublicCertificate } from "@/src/services/courses-public";
import { CertificateBadge } from "./CertificateBadge";

export interface PublicCourseCardProps {
  course: PublicCourseCardModel;
  progress: number;
  variant: "grid" | "list";
}

const MAX_VISIBLE_INSTRUCTORS = 2;

/** Dark tooltip surface matching course cards (overrides default inverted white). */
const instructorTooltipClassName =
  "max-w-[240px] border border-[#343445] bg-[#1c1c27] text-[#e8ecf4] shadow-xl";
const instructorTooltipArrowClassName = "bg-[#1c1c27] fill-[#1c1c27]";

function CourseProgress({ progress }: { progress: number }) {
  const safeProgress = Math.min(Math.max(Math.round(progress), 0), 100);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[#2a2a39]">
        <div
          className="h-full rounded-full bg-[#ff2d35] transition-[width] duration-300"
          style={{ width: `${safeProgress}%` }}
        />
      </div>
      <span className="shrink-0 tabular-nums text-[11px] font-medium text-[#7f8799]">
        {safeProgress}%
      </span>
    </div>
  );
}

function InstructorChips({
  instructors,
  locale,
}: {
  instructors: PublicCourseCardModel["instructors"];
  locale: Locale;
}) {
  const t = useTranslations("courses");
  if (instructors.length === 0) {
    return <span className="text-[11px] text-[#5c6370]">—</span>;
  }

  const visible = instructors.slice(0, MAX_VISIBLE_INSTRUCTORS);
  const hidden = instructors.slice(MAX_VISIBLE_INSTRUCTORS);

  return (
    <TooltipProvider delayDuration={120}>
      <div className="flex min-w-0 flex-col gap-1.5 overflow-hidden">
        <span className="text-[11px] font-medium text-[#6f7585]">{t("instructors")}</span>
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          {visible.map((instructor) => {
            const name = instructor.nickName.trim() || t("unknownInstructor");
            const href = localizePath(`/creators/${encodeUserId(instructor.userId)}`, locale);
            return (
              <Tooltip key={instructor.userId}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    onClick={(event) => event.stopPropagation()}
                    className="flex min-w-0 max-w-[50%] items-center gap-1.5 rounded-md px-0.5 py-0.5 text-[12px] font-medium text-[#c8cfde] transition-colors hover:text-white"
                  >
                    <UserAvatar
                      src={instructor.avatar}
                      seed={instructor.userId}
                      name={name}
                      size={20}
                      className="size-5 shrink-0 ring-1 ring-[#3a3a4a]"
                    />
                    <span className="truncate leading-5">{name}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  sideOffset={8}
                  className={instructorTooltipClassName}
                  arrowClassName={instructorTooltipArrowClassName}
                >
                  <span className="flex items-center gap-2">
                    <UserAvatar
                      src={instructor.avatar}
                      seed={instructor.userId}
                      name={name}
                      size={22}
                      className="size-[22px] shrink-0"
                    />
                    <span className="text-xs font-medium leading-snug break-all">{name}</span>
                  </span>
                </TooltipContent>
              </Tooltip>
            );
          })}
          {hidden.length > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0 cursor-default text-[11px] font-medium text-[#8b92a3]">
                  +{hidden.length}
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={8}
                className={instructorTooltipClassName}
                arrowClassName={instructorTooltipArrowClassName}
              >
                <ul className="space-y-1.5">
                  {hidden.map((instructor) => {
                    const name = instructor.nickName.trim() || t("unknownInstructor");
                    return (
                      <li key={instructor.userId} className="flex items-center gap-2">
                        <UserAvatar
                          src={instructor.avatar}
                          seed={instructor.userId}
                          name={name}
                          size={18}
                          className="size-[18px] shrink-0"
                        />
                        <span className="text-xs font-medium leading-snug break-all">{name}</span>
                      </li>
                    );
                  })}
                </ul>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}

function priceLabel(course: PublicCourseCardModel, t: ReturnType<typeof useTranslations>) {
  return course.priceCredits != null
    ? t("priceCredits", { amount: course.priceCredits })
    : t("free");
}

function CoverCertificate({
  certificate,
  hasCover,
}: {
  certificate: PublicCertificate | null;
  hasCover: boolean;
}) {
  if (!certificate) return null;
  return (
    <>
      {hasCover ? null : (
        <CertificateBadge
          name={certificate.name}
          iconUrl={certificate.iconUrl}
          size="lg"
          className="pointer-events-none absolute inset-0 m-auto opacity-40"
        />
      )}
      <CertificateBadge
        name={certificate.name}
        iconUrl={certificate.iconUrl}
        size="lg"
        className="absolute right-1.5 top-1.5"
      />
    </>
  );
}

function CardBody({
  course,
  progress,
  locale,
}: {
  course: PublicCourseCardModel;
  progress: number;
  locale: Locale;
}) {
  const t = useTranslations("courses");

  return (
    <div className="flex flex-1 flex-col px-4 pt-3.5 pb-3.5">
      <h2 className="line-clamp-2 min-h-[3rem] text-[15px] leading-6 font-bold text-white">
        {course.title}
      </h2>
      <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-[13px] leading-5 text-[#9aa3b5]">
        {course.description || "\u00A0"}
      </p>

      <div className="mt-3 min-h-[1.5rem]">
        <InstructorChips instructors={course.instructors} locale={locale} />
      </div>

      <div className="mt-auto flex items-center gap-3 border-t border-[#242432] pt-3">
        <CourseProgress progress={progress} />
        <span className="shrink-0 bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-[13px] font-bold text-transparent">
          {priceLabel(course, t)}
        </span>
      </div>
      <span className="sr-only">{t("progress")}</span>
    </div>
  );
}

export function PublicCourseCard({ course, progress, variant }: PublicCourseCardProps) {
  const t = useTranslations("courses");
  const locale = useLocale() as Locale;
  const cover = resolveCourseCoverUrl(course.coverUrl);
  const courseHref = localizePath(`/courses/${course.id}`, locale);
  const label = priceLabel(course, t);
  const assigned = useAssignedCourseCertificate(course.certificateId != null ? course.id : null);
  const certificate =
    course.certificateId == null
      ? null
      : (assigned.data ?? {
          id: course.certificateId,
          name: t("skillCertificate"),
          imagePath: null,
          iconUrl: "",
        });

  if (variant === "list") {
    return (
      <Link
        href={courseHref}
        className="group grid grid-cols-[160px_minmax(0,1fr)] items-stretch gap-4 rounded-lg border border-[#242432] bg-[#111119] p-3 transition-colors hover:border-[#3a3a4d] max-sm:grid-cols-1"
      >
        <div className="relative aspect-[16/9] overflow-hidden rounded-md bg-[#1c1c27] sm:aspect-auto sm:min-h-[108px]">
          {cover ? (
            <Image
              src={cover}
              alt={course.title}
              fill
              unoptimized
              sizes="(max-width: 640px) 100vw, 160px"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : null}
          <CoverCertificate certificate={certificate} hasCover={Boolean(cover)} />
          {course.episodeCount != null ? (
            <span className="absolute left-2 top-2 rounded bg-black/75 px-2 py-1 text-xs font-bold text-white">
              {t("lessonCount", { count: course.episodeCount })}
            </span>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col py-0.5">
          <h2 className="line-clamp-2 text-[15px] leading-6 font-bold text-white">
            {course.title}
          </h2>
          <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-[#9aa3b5]">
            {course.description}
          </p>
          <div className="mt-2.5">
            <InstructorChips instructors={course.instructors} locale={locale} />
          </div>
          <div className="mt-auto flex items-center gap-3 pt-3">
            <CourseProgress progress={progress} />
            <span className="shrink-0 bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-[13px] font-bold text-transparent">
              {label}
            </span>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={courseHref}
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-[#242432] bg-[#111119] transition-colors hover:border-[#3a3a4d]"
    >
      <div className="relative aspect-[16/9] shrink-0 overflow-hidden bg-[#1c1c27]">
        {cover ? (
          <Image
            src={cover}
            alt={course.title}
            fill
            unoptimized
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}
        <CoverCertificate certificate={certificate} hasCover={Boolean(cover)} />
        {course.episodeCount != null ? (
          <span className="absolute left-2 top-2 rounded bg-black/75 px-2 py-1 text-xs font-bold text-white">
            {t("lessonCount", { count: course.episodeCount })}
          </span>
        ) : null}
      </div>

      <CardBody course={course} progress={progress} locale={locale} />
    </Link>
  );
}
