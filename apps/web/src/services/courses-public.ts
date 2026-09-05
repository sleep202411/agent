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

export function listPublicCourses(locale: string) {
  return api.get<PublicCourseSummary[]>("/project/courses", {
    params: { locale },
  });
}

export function getPublicCourse(courseId: number | string, locale: string) {
  return api.get<PublicCourseDetail>(`/project/courses/${encodeURIComponent(String(courseId))}`, {
    params: { locale },
  });
}

export function getPublicCoursePlayUrl(videoId: number | string, locale: string) {
  return api.post<string>(
    `/project/courses/videos/${encodeURIComponent(String(videoId))}/play-url`,
    { params: { locale } }
  );
}
