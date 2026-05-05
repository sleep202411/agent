"use client";

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import type { OuterCourse } from "@/src/hooks/use-courses";

export interface CourseCardProps {
  course: OuterCourse;
  progress: number;
  variant: "grid" | "list";
}

const IMG_BASE = "https://banner.fizzspace.cn";

function courseImageUrl(picLink: string) {
  if (!picLink) return "";
  if (picLink.startsWith("http")) return picLink;
  return `${IMG_BASE}/${picLink}`;
}

function formatPrice(price: string | null) {
  if (!price || price === "free") return null;

  const numericPrice = Number(price);
  return Number.isFinite(numericPrice) ? `¥${numericPrice}` : price;
}

function CourseProgress({ progress, label }: { progress: number; label: string }) {
  const safeProgress = Math.min(Math.max(Math.round(progress), 0), 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] font-semibold text-[#7f8799]">
        <span>{label}</span>
        <span>{safeProgress}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#262631]">
        <div
          className="h-full rounded-full bg-[#ff2d35] shadow-[0_0_14px_rgba(255,45,53,0.45)] transition-[width] duration-300"
          style={{ width: `${safeProgress}%` }}
        />
      </div>
    </div>
  );
}

export function CourseCard({ course, progress, variant }: CourseCardProps) {
  const t = useTranslations("courses");
  const locale = useLocale() as Locale;
  const priceText = course.price === "free" ? t("free") : formatPrice(course.price);
  const isFree = course.price === "free";
  const cover = courseImageUrl(course.picLink);
  const courseHref = localizePath(`/courses/${course.index}`, locale);

  if (variant === "list") {
    return (
      <Link
        href={courseHref}
        className="group grid min-h-[158px] grid-cols-[180px_minmax(0,1fr)_90px] items-center gap-5 rounded-lg border border-[#242432] bg-[#111119] px-5 py-4 transition-colors hover:border-[#3a3a4d] max-sm:grid-cols-1 max-sm:items-start"
      >
        <div className="relative aspect-[16/9] overflow-hidden rounded-md bg-[#1c1c27]">
          {cover ? (
            <Image
              src={cover}
              alt={course.title}
              fill
              unoptimized
              sizes="(max-width: 640px) 100vw, 180px"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : null}
          <span className="absolute left-2 top-2 rounded bg-black/75 px-2 py-1 text-xs font-bold text-white">
            {t("lessonCount", { count: course.episodeCount })}
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="space-y-1">
            <h2 className="line-clamp-1 text-base font-bold text-white">{course.type}</h2>
            <p className="line-clamp-2 text-sm leading-6 text-[#b6bed1]">{course.info}</p>
          </div>
          <div className="max-w-md">
            <CourseProgress progress={progress} label={t("progress")} />
          </div>
        </div>

        <div className="flex justify-end max-sm:justify-start">
          {priceText ? (
            <span
              className={cn(
                "text-sm font-bold",
                isFree
                  ? "bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent"
                  : "text-[#ff3e51]"
              )}
            >
              {priceText}
            </span>
          ) : null}
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={courseHref}
      className="group block overflow-hidden rounded-lg border border-[#242432] bg-[#111119] transition-colors hover:border-[#3a3a4d]"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-[#1c1c27]">
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
        <span className="absolute left-2 top-2 rounded bg-black/75 px-2 py-1 text-xs font-bold text-white">
          {t("lessonCount", { count: course.episodeCount })}
        </span>
      </div>

      <div className="flex min-h-[190px] flex-col px-4 py-4">
        <h2 className="line-clamp-1 text-base font-bold text-white">{course.type}</h2>
        <p className="mt-2 line-clamp-2 min-h-11 text-sm leading-6 text-[#b6bed1]">{course.info}</p>
        <div className="mt-4">
          <CourseProgress progress={progress} label={t("progress")} />
        </div>
        <div className="mt-auto border-t border-[#282837] pt-3">
          <div className="flex items-center justify-end gap-3">
            {priceText ? (
              <span
                className={cn(
                  "shrink-0 text-sm font-bold",
                  isFree
                    ? "bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent"
                    : "text-[#ff3e51]"
                )}
              >
                {priceText}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}
