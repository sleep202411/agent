"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import {
  getPublicCourse,
  getPublicCoursePlayUrl,
  listPublicCourses,
  resolveCourseCoverUrl,
  type PublicCourseDetail,
  type PublicCourseInstructor,
  type PublicCourseSummary,
  type PublicCourseVideo,
} from "@/src/services/courses-public";

export interface PublicCourseCardModel {
  id: number;
  title: string;
  description: string;
  coverUrl: string;
  updateTime: string;
  /** Null when list payload has no count — hide “N lessons” badge. */
  episodeCount: number | null;
  instructors: PublicCourseInstructor[];
  price: "free";
}

export interface PublicCourseDetailView {
  courseId: number;
  title: string;
  description: string;
  coverUrl: string;
  updateTime: string;
  instructors: PublicCourseInstructor[];
  videos: PublicCourseVideo[];
  currentVideoId: number | null;
  /** Resolved poster for the active lesson (video cover → course cover). */
  currentPosterUrl: string;
  videoUrl: string;
}

function toCard(summary: PublicCourseSummary): PublicCourseCardModel {
  const count = summary.videoCount;
  return {
    id: summary.id,
    title: summary.title?.trim() || "",
    description: summary.description?.trim() || "",
    coverUrl: summary.coverUrl?.trim() || "",
    updateTime: summary.updateTime ?? "",
    episodeCount: typeof count === "number" && count >= 0 ? count : null,
    instructors: summary.instructors ?? [],
    price: "free",
  };
}

function filterBySearch(courses: PublicCourseCardModel[], searchQuery: string) {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return courses;
  return courses.filter(
    (course) =>
      course.title.toLowerCase().includes(query) ||
      course.description.toLowerCase().includes(query) ||
      course.instructors.some((i) => i.nickName.toLowerCase().includes(query))
  );
}

const PROGRESS_PREFIX = "public-course-progress-v1:";
const EPISODE_PREFIX = "public-course-episode-v1:";

function readStoredVideoId(courseId: number): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${EPISODE_PREFIX}${courseId}`);
    if (!raw) return null;
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

function writeStoredVideoId(courseId: number, videoId: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${EPISODE_PREFIX}${courseId}`, String(videoId));
  } catch {
    /* ignore */
  }
}

export function readPublicCourseProgress(courseId: number): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(`${PROGRESS_PREFIX}${courseId}`);
    const value = Number(raw);
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
  } catch {
    return 0;
  }
}

export function usePublicCourseList(searchQuery = "") {
  const locale = useLocale() as Locale;
  const { data, isLoading, error } = useQuery({
    queryKey: ["public-courses", locale],
    queryFn: () => listPublicCourses(locale),
  });

  const courses = useMemo(() => (data ?? []).map(toCard), [data]);
  const filteredCourses = useMemo(
    () => filterBySearch(courses, searchQuery),
    [courses, searchQuery]
  );

  return { isLoading, error, courses, filteredCourses };
}

export function usePublicCourseDetail(courseIdParam: string | undefined) {
  const locale = useLocale() as Locale;
  const courseId = Number(courseIdParam);
  const validId = Number.isFinite(courseId) && courseId > 0 ? courseId : null;
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);

  const detailQuery = useQuery({
    queryKey: ["public-course", validId, locale],
    queryFn: () => getPublicCourse(validId!, locale),
    enabled: validId != null,
  });

  const course: PublicCourseDetail | null = detailQuery.data ?? null;
  const videos = useMemo(() => {
    const list = [...(course?.videos ?? [])];
    list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return list;
  }, [course?.videos]);

  const currentVideo = useMemo(() => {
    if (videos.length === 0) return null;
    if (selectedVideoId != null) {
      return videos.find((v) => v.id === selectedVideoId) ?? videos[0] ?? null;
    }
    if (validId != null) {
      const stored = readStoredVideoId(validId);
      if (stored != null) {
        return videos.find((v) => v.id === stored) ?? videos[0] ?? null;
      }
    }
    return videos[0] ?? null;
  }, [videos, selectedVideoId, validId]);

  useEffect(() => {
    if (validId == null || !currentVideo) return;
    writeStoredVideoId(validId, currentVideo.id);
  }, [validId, currentVideo]);

  const playQuery = useQuery({
    queryKey: ["public-course-play", currentVideo?.id, locale],
    queryFn: () => getPublicCoursePlayUrl(currentVideo!.id, locale),
    enabled: currentVideo?.id != null,
  });

  const detailView = useMemo<PublicCourseDetailView | null>(() => {
    if (!course || validId == null) return null;
    const courseCover = resolveCourseCoverUrl(course.coverUrl);
    const videoCover = resolveCourseCoverUrl(currentVideo?.coverUrl);
    return {
      courseId: validId,
      title: course.title?.trim() || "",
      description: course.description?.trim() || "",
      coverUrl: courseCover,
      updateTime: course.updateTime ?? "",
      instructors: course.instructors ?? [],
      videos,
      currentVideoId: currentVideo?.id ?? null,
      currentPosterUrl: videoCover || courseCover,
      videoUrl: playQuery.data ?? "",
    };
  }, [course, validId, videos, currentVideo?.id, currentVideo?.coverUrl, playQuery.data]);

  function setCurrentVideo(videoId: number) {
    setSelectedVideoId(videoId);
  }

  return {
    isLoading: detailQuery.isLoading,
    error: detailQuery.error,
    playError: playQuery.error,
    detail: detailView,
    currentTitle: currentVideo?.title ?? course?.title ?? "",
    stableProgressKey:
      validId != null && currentVideo != null
        ? `public-course-${validId}-video-${currentVideo.id}`
        : "",
    setCurrentVideo,
  };
}
