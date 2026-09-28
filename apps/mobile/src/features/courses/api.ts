import { api } from "@/lib/api-client";
import { appEnv, resolveAssetUrl } from "@/config";

export interface Course {
  id: number;
  title: string;
  description: string;
  coverUrl: string;
  videoCount?: number | null;
  instructors: { userId: number; nickName: string }[];
}
export interface Lesson {
  id: number;
  title: string;
  sortOrder: number;
  coverUrl: string;
}
export interface CourseDetail extends Course {
  videos: Lesson[];
}
export const courseCover = (path: string) =>
  path ? resolveAssetUrl(path, appEnv.assets.bannerBaseUrl) : undefined;
export const listCourses = (locale: string, signal: AbortSignal) =>
  api.get<Course[]>("/project/courses", { service: "content", params: { locale }, signal });
export const getCourse = (id: string, locale: string, signal: AbortSignal) =>
  api.get<CourseDetail>(`/project/courses/${encodeURIComponent(id)}`, {
    service: "content",
    params: { locale },
    signal,
  });
export const getLessonUrl = (id: number, locale: string, signal: AbortSignal) =>
  api.post<string>(`/project/courses/videos/${id}/play-url`, {
    service: "content",
    params: { locale },
    signal,
  });
export function orderedLessons(videos: Lesson[]) {
  return [...videos].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}
