"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import {
  readLatestStoredEpisodeProgress,
  readStoredEpisodeProgress,
} from "@/src/hooks/use-courses";
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
const EPISODE_PROGRESS_PREFIX = "course_video_progress_";

export function publicCourseVideoStableKey(courseId: number, videoId: number): string {
  return `public-course-${courseId}-video-${videoId}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

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

function writePublicCourseProgress(courseId: number, percent: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${PROGRESS_PREFIX}${courseId}`, String(clampPercent(percent)));
  } catch {
    /* ignore */
  }
}

/**
 * Average per-lesson watch ratio across the course playlist.
 * Player stores each lesson under `course_video_progress_{id|stableKey}`.
 */
export function recomputePublicCourseProgress(courseId: number, videoIds: number[]): number {
  if (typeof window === "undefined" || videoIds.length === 0) return 0;

  let watched = 0;
  for (const videoId of videoIds) {
    const progress = readLatestStoredEpisodeProgress(
      videoId,
      publicCourseVideoStableKey(courseId, videoId)
    );
    if (!progress || progress.duration <= 0) continue;
    watched += Math.min(progress.currentTime / progress.duration, 1);
  }

  const percent = clampPercent((watched / videoIds.length) * 100);
  writePublicCourseProgress(courseId, percent);
  return percent;
}

/** Recover list % from episode keys when the aggregate key was never written. */
function derivePublicCourseProgressFromEpisodes(
  courseId: number,
  episodeCount?: number | null
): number {
  if (typeof window === "undefined") return 0;

  const prefix = `${EPISODE_PROGRESS_PREFIX}public-course-${courseId}-video-`;
  let watched = 0;
  let tracked = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const storageId = key.slice(EPISODE_PROGRESS_PREFIX.length);
      const progress = readStoredEpisodeProgress(storageId);
      if (!progress || progress.duration <= 0) continue;
      watched += Math.min(progress.currentTime / progress.duration, 1);
      tracked += 1;
    }
  } catch {
    return 0;
  }

  if (tracked === 0) return 0;
  const denom = typeof episodeCount === "number" && episodeCount > 0 ? episodeCount : tracked;
  return clampPercent((watched / denom) * 100);
}

/**
 * List-card progress. Prefers the aggregate written during playback; falls back
 * to scanning per-lesson keys (same store the player writes).
 */
export function readPublicCourseProgress(courseId: number, episodeCount?: number | null): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(`${PROGRESS_PREFIX}${courseId}`);
    if (raw != null && raw !== "") {
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0) return clampPercent(value);
    }
  } catch {
    /* fall through */
  }
  return derivePublicCourseProgressFromEpisodes(courseId, episodeCount);
}

export function usePublicCourseList(searchQuery = "") {
  const { user } = useCurrentUser();
  const locale = useLocale() as Locale;
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["public-courses", locale, user?.id ?? "guest"],
    queryFn: ({ signal }) => listPublicCourses(locale, signal),
  });

  const courses = useMemo(() => (data ?? []).map(toCard), [data]);
  const filteredCourses = useMemo(
    () => filterBySearch(courses, searchQuery),
    [courses, searchQuery]
  );

  return { isLoading, error, courses, filteredCourses, refetch, isFetching };
}

export function usePublicCourseDetail(courseIdParam: string | undefined) {
  const { user } = useCurrentUser();
  const locale = useLocale() as Locale;
  const courseId = Number(courseIdParam);
  const validId = Number.isSafeInteger(courseId) && courseId > 0 ? courseId : null;
  const scope = JSON.stringify([user?.id ?? null, validId, locale]);
  const activeScope = useRef<string | null>(scope);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      if (activeScope.current === scope) activeScope.current = null;
    };
  }, [scope]);
  const [selection, setSelection] = useState<{ scope: string; id: number } | null>(null);
  const selectedVideoId = selection?.scope === scope ? selection.id : null;

  const detailQuery = useQuery({
    queryKey: ["public-course", validId, locale, user?.id ?? "guest"],
    queryFn: ({ signal }) => getPublicCourse(validId!, locale, signal),
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
    queryKey: ["public-course-play", validId, currentVideo?.id, locale, user?.id ?? "guest"],
    queryFn: ({ signal }) => getPublicCoursePlayUrl(currentVideo!.id, locale, signal),
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
    if (activeScope.current !== scope || !videos.some((video) => video.id === videoId)) return;
    setSelection({ scope, id: videoId });
  }

  return {
    isLoading: detailQuery.isLoading,
    error: detailQuery.error,
    playError: playQuery.error,
    isFetching: detailQuery.isFetching,
    retryDetail: validId == null ? undefined : detailQuery.refetch,
    isPlayFetching: playQuery.isFetching,
    retryPlayback: playQuery.refetch,
    detail: detailView,
    currentTitle: currentVideo?.title ?? course?.title ?? "",
    seriesVideoIds: videos.map((video) => video.id),
    stableProgressKey:
      validId != null && currentVideo != null
        ? publicCourseVideoStableKey(validId, currentVideo.id)
        : "",
    setCurrentVideo,
  };
}
