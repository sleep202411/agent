/**
 * Courses module domain types (admin-ui).
 *
 * Mirrors Java `/api/admin/courses`: metadata + per-locale title/description/cover;
 * videos share videoKey/coverUrl with per-locale titles; instructors by userId.
 * See docs/admin-courses-api.md.
 */

export const COURSE_LOCALES = [
  { code: "zh-CN", short: "简", label: "简体中文", primary: true },
  { code: "en-US", short: "EN", label: "English", primary: false },
  { code: "zh-HK", short: "繁", label: "繁體中文", primary: false },
] as const;

export type CourseLocaleCode = (typeof COURSE_LOCALES)[number]["code"];

export const COURSE_PRIMARY_LOCALE: CourseLocaleCode = "zh-CN";

export interface CourseLocaleContent {
  title: string;
  description: string;
  coverUrl: string;
}

export interface CourseVideoLocaleContent {
  title: string;
}

export interface CourseVideo {
  /** Present after load; omitted on save (Java rebuilds rows). */
  id?: string;
  /**
   * Client-only stable key for drag reorder / React keys.
   * Never sent to Java.
   */
  clientKey: string;
  videoKey: string;
  coverUrl: string;
  sortOrder: number;
  sectionId: string | null;
  localized: Record<CourseLocaleCode, CourseVideoLocaleContent>;
}

export interface CourseInstructor {
  /** Encoded public id for display; decode before Java submit. */
  userId: string;
  nickName: string;
  avatar: string;
  description: string;
  /** Percent string for the instructor row; empty means unset. */
  sharePercent: string;
}

export interface Course {
  id: string;
  published: boolean;
  localized: Record<CourseLocaleCode, CourseLocaleContent>;
  videos: CourseVideo[];
  /** List API summary field when full videos[] is omitted. */
  videoCount?: number;
  instructors: CourseInstructor[];
  certificateId: number | null;
  priceCredits: string;
  enrollmentEnabled: boolean;
  createTime: string;
  updateTime: string;
}

export function emptyCourseLocaleContent(): CourseLocaleContent {
  return { title: "", description: "", coverUrl: "" };
}

export function emptyLocalizedCourse(): Record<CourseLocaleCode, CourseLocaleContent> {
  return {
    "zh-CN": emptyCourseLocaleContent(),
    "en-US": emptyCourseLocaleContent(),
    "zh-HK": emptyCourseLocaleContent(),
  };
}

export function emptyVideoLocale(): CourseVideoLocaleContent {
  return { title: "" };
}

export function emptyVideoLocalized(): Record<CourseLocaleCode, CourseVideoLocaleContent> {
  return {
    "zh-CN": emptyVideoLocale(),
    "en-US": emptyVideoLocale(),
    "zh-HK": emptyVideoLocale(),
  };
}

export function emptyCourseVideo(sortOrder = 1): CourseVideo {
  return {
    clientKey: `new-${crypto.randomUUID()}`,
    videoKey: "",
    coverUrl: "",
    sortOrder,
    sectionId: null,
    localized: emptyVideoLocalized(),
  };
}

/** Display title: primary locale, then any non-empty title. */
export function courseDisplayTitle(course: Pick<Course, "localized">): string {
  const primary = course.localized[COURSE_PRIMARY_LOCALE]?.title?.trim();
  if (primary) return primary;
  for (const locale of COURSE_LOCALES) {
    const title = course.localized[locale.code]?.title?.trim();
    if (title) return title;
  }
  return "（未命名课程）";
}

export function courseDisplayCover(course: Pick<Course, "localized">): string {
  const primary = course.localized[COURSE_PRIMARY_LOCALE]?.coverUrl?.trim();
  if (primary) return primary;
  for (const locale of COURSE_LOCALES) {
    const cover = course.localized[locale.code]?.coverUrl?.trim();
    if (cover) return cover;
  }
  return "";
}

export function hasAnyCourseTitle(localized: Course["localized"]): boolean {
  return COURSE_LOCALES.some((locale) => localized[locale.code]?.title?.trim());
}

/**
 * Covers upload to the banner bucket as object keys like `course/cover/...`.
 * Legacy rows may already be absolute URLs (web-static / CDN). Resolve both for <img>.
 *
 * Prefix: NEXT_PUBLIC_BANNER_BASE_URL (build-time for client).
 * CN admin preview temporarily uses the same SG host as .com:
 *   https://fizzdragon-banner-sg.oss-ap-southeast-1.aliyuncs.com
 * Revisit when CN course covers are served from banner.fizzspace.cn.
 */
function courseCoverBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_BANNER_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return "https://fizzdragon-banner-sg.oss-ap-southeast-1.aliyuncs.com";
}

export function resolveCertificateImageUrl(raw?: string | null): string {
  const url = raw?.trim() ?? "";
  if (!url) return "";
  if (/^(https?:)?\/\//.test(url) || url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  const base = (process.env.NEXT_PUBLIC_STATIC_BASE_URL ?? "https://static.fizzspace.cn").replace(
    /\/+$/,
    ""
  );
  return `${base}/${url.replace(/^\/+/, "")}`;
}

export function resolveCourseCoverUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "";
  if (/^(https?:)?\/\//.test(url) || url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  return `${courseCoverBaseUrl()}/${url.replace(/^\/+/, "")}`;
}
