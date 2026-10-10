/**
 * Public courses API (`CoursePublicController`).
 * Proxied via JAVA_CONTENT_URL → `/project/courses`.
 */
import { api } from "@/src/lib/api";
import { env } from "@/src/env";
import { resolveAssetUrl } from "@/src/services/user";

export interface PublicCourseInstructor {
  userId: number;
  nickName: string;
  avatar: string;
  description?: string | null;
}

export interface PublicCourseVideo {
  id: number;
  sortOrder: number;
  sectionId: number | null;
  title: string;
  coverUrl: string;
}

/** Published list item (flattened locale fields + instructors). */
export interface PublicCourseSummary {
  id: number;
  updateTime: string;
  locale: string | null;
  title: string;
  description: string;
  coverUrl: string;
  videoCount?: number | null;
  instructors: PublicCourseInstructor[];
  priceCredits?: number | string | null;
  enrollmentEnabled?: boolean | number | null;
  certificateId?: number | string | null;
}

export interface PublicCourseDetail {
  id: number;
  updateTime: string;
  locale: string | null;
  title: string;
  description: string;
  coverUrl: string;
  videos: PublicCourseVideo[];
  instructors: PublicCourseInstructor[];
}

export function resolveCourseCoverUrl(raw: string | null | undefined): string {
  return resolveAssetUrl(raw, env.BANNER_BASE_URL) ?? "";
}

/** List price when enrollment is on and credits > 0; otherwise the course is free. */
export function publicCoursePriceCredits(course: {
  priceCredits?: number | string | null;
  enrollmentEnabled?: boolean | number | null;
}): number | null {
  const enabled = course.enrollmentEnabled === true || course.enrollmentEnabled === 1;
  if (!enabled) return null;
  const raw = course.priceCredits;
  if (raw == null || raw === "" || raw === "free") return null;
  const price = Number(String(raw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(price) || price <= 0) return null;
  return Math.trunc(price);
}

export function matchesPublicCoursePriceRange(
  priceCredits: number | null,
  priceRange: string | null
): boolean {
  if (!priceRange) return true;
  if (priceRange === "free") return priceCredits == null;
  if (priceCredits == null) return false;
  if (priceRange.endsWith("+")) {
    const min = Number(priceRange.slice(0, -1));
    return Number.isFinite(min) && priceCredits >= min;
  }
  const [min, max] = priceRange.split("-").map(Number);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return true;
  return priceCredits >= min && priceCredits <= max;
}

export function publicCourseCertificateId(course: {
  certificateId?: number | string | null;
}): number | null {
  const id = Number(course.certificateId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export type PublicCertificate = {
  id: number;
  name: string;
  imagePath: string | null;
  iconUrl: string;
};

export function resolveCertificateIconUrl(imagePath: string | null | undefined): string {
  return resolveAssetUrl(imagePath?.trim() || null, env.STATIC_BASE_URL) ?? "";
}

export function toPublicCertificate(row: {
  id?: number | string | null;
  name?: string | null;
  imagePath?: string | null;
}): PublicCertificate | null {
  const id = Number(row.id);
  const name = row.name?.trim() ?? "";
  if (!Number.isSafeInteger(id) || id <= 0 || !name) return null;
  const imagePath = row.imagePath?.trim() || null;
  return {
    id,
    name,
    imagePath,
    iconUrl: resolveCertificateIconUrl(imagePath),
  };
}

export async function getAssignedCourseCertificate(
  courseId: number | string,
  signal?: AbortSignal
): Promise<PublicCertificate | null> {
  const data = await api.get<{
    courseId: string;
    certificate: { id: number; name: string; imagePath?: string | null } | null;
  }>(`/aurora/academy/course-certificates/${encodeURIComponent(String(courseId))}`, { signal });
  return data?.certificate ? toPublicCertificate(data.certificate) : null;
}

export function listPublicCourses(locale: string, signal?: AbortSignal) {
  return api.get<PublicCourseSummary[]>("/project/courses", {
    params: { locale },
    signal,
  });
}

export function getPublicCourse(courseId: number | string, locale: string, signal?: AbortSignal) {
  return api.get<PublicCourseDetail>(`/project/courses/${encodeURIComponent(String(courseId))}`, {
    params: { locale },
    signal,
  });
}

export function getPublicCoursePlayUrl(
  videoId: number | string,
  locale: string,
  signal?: AbortSignal
) {
  return api.post<string>(
    `/project/courses/videos/${encodeURIComponent(String(videoId))}/play-url`,
    { params: { locale }, signal }
  );
}
