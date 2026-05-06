import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { getCourseList, getCourseVideoLink, isCourseApiError } from "@/src/services/courses";
import type { Course, CourseChapters } from "@/src/services/courses";

export interface OuterCourse {
  index: number;
  stableKey: string;
  outerType: string;
  type: string;
  episodeCount: number;
  price: Course["url"];
  title: string;
  info: string;
  picLink: string;
  updateTime: string;
}

export interface GroupedCourse {
  mainID: number;
  stableKey: string;
  type: string;
  courses: Course[];
}

export interface CoursePackages {
  outerCourses: OuterCourse[];
  groupedCourses: GroupedCourse[];
}

export interface CourseFilters {
  searchQuery: string;
  category: string | null;
  priceRange: string | null;
}

interface CourseTypeBucket {
  outerType: string;
  type: string;
  courses: Course[];
  sourceIndex: number;
  stableKey: string;
}

export interface CourseDetailData {
  detail: {
    mainID: number;
    title: string;
    info: string;
    updateTime: string;
    vedioLink: string;
  };
  series: Array<{
    id: number;
    stableProgressKey: string;
    title: string;
    picLink: string;
  }>;
  currentId: number;
  stableProgressKey: string;
}

export interface CourseVideoProgress {
  currentTime: number;
  duration: number;
  updatedAt: number;
}

export type CourseProgressMap = Record<number, number>;

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const COURSE_LANGUAGE_ALIASES: Record<Locale, string[]> = {
  "en-US": ["en-us", "en_us", "en", "english"],
  "zh-CN": ["zh-cn", "zh_cn", "zh", "cn", "sc", "chs", "simplified"],
  "zh-HK": ["zh-hk", "zh_hk", "zh-tw", "zh_tw", "hk", "tw", "tc", "cht", "traditional"],
};

function normalizeCourseLanguage(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, "-") ?? "";
}

function courseMatchesLocale(course: Course, locale: Locale) {
  const language = normalizeCourseLanguage(course.lan);
  if (!language) return false;
  return COURSE_LANGUAGE_ALIASES[locale].includes(language);
}

function normalizeProgressKeyPart(value: string | number) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function courseSeriesStableKey(outerType: string, sourceIndex: number) {
  return `series-${normalizeProgressKeyPart(outerType || "course")}-${sourceIndex}`;
}

function courseEpisodeStableKey(seriesStableKey: string, episodeNumber: number) {
  return `${seriesStableKey}-episode-${normalizeProgressKeyPart(episodeNumber)}`;
}

function filterCourseChaptersByLocale(
  courseChapters: CourseChapters | undefined | null,
  locale: Locale
): CourseChapters | undefined | null {
  if (!courseChapters) return courseChapters;

  let hasLanguageTaggedCourses = false;
  let hasLocaleMatches = false;
  const filteredEntries = Object.entries(courseChapters).map(([chapterKey, courses]) => {
    const matchedCourses = courses.filter((course) => {
      const hasLanguage = normalizeCourseLanguage(course.lan).length > 0;
      hasLanguageTaggedCourses ||= hasLanguage;
      const matches = courseMatchesLocale(course, locale);
      hasLocaleMatches ||= matches;
      return matches;
    });

    return [chapterKey, matchedCourses] as const;
  });

  if (!hasLanguageTaggedCourses || !hasLocaleMatches) return courseChapters;

  return Object.fromEntries(filteredEntries) as CourseChapters;
}

/**
 * 解析课程 type 前缀中的中文序号，用于课程系列排序。
 */
function parseChineseOrdinal(type: string): number | null {
  const match = type.trimStart().match(/^([零〇一二两三四五六七八九十百千万]+)[、.．]/);
  if (!match) return null;

  const text = match[1];
  if (text === "十") return 10;

  const tenIndex = text.indexOf("十");
  if (tenIndex >= 0) {
    const beforeTen = text.slice(0, tenIndex);
    const afterTen = text.slice(tenIndex + 1);
    const tens = beforeTen ? (CHINESE_DIGITS[beforeTen] ?? 0) : 1;
    const ones = afterTen ? (CHINESE_DIGITS[afterTen] ?? 0) : 0;
    return tens * 10 + ones;
  }

  return CHINESE_DIGITS[text] ?? null;
}

/**
 * 比较两个课程系列的排序位置，优先使用中文序号，缺失时保持原始出现顺序。
 */
function compareCourseTypes(a: CourseTypeBucket, b: CourseTypeBucket): number {
  const aOrder = parseChineseOrdinal(a.type);
  const bOrder = parseChineseOrdinal(b.type);

  if (aOrder !== null && bOrder !== null && aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  if (aOrder !== null && bOrder === null) return 1;
  if (aOrder === null && bOrder !== null) return -1;

  return a.sourceIndex - b.sourceIndex;
}

/**
 * 将接口返回的原始课程包重组为首页课程包和详情课程包。
 */
export function buildCoursePackages(
  courseChapters?: CourseChapters | null,
  locale: Locale = "en-US"
): CoursePackages {
  const localizedCourseChapters = filterCourseChaptersByLocale(courseChapters, locale);
  const buckets = new Map<string, CourseTypeBucket>();
  let sourceIndex = 0;

  Object.entries(localizedCourseChapters ?? {}).forEach(([outerType, courses]) => {
    courses.forEach((course) => {
      const bucket = buckets.get(course.type);

      if (bucket) {
        bucket.courses.push(course);
        return;
      }

      buckets.set(course.type, {
        outerType,
        type: course.type,
        courses: [course],
        sourceIndex,
        stableKey: courseSeriesStableKey(outerType, sourceIndex),
      });
      sourceIndex += 1;
    });
  });

  const sortedBuckets = Array.from(buckets.values()).sort(compareCourseTypes);

  const outerCourses = sortedBuckets.map((bucket, index) => {
    const courses = [...bucket.courses].sort((a, b) => a.number - b.number);
    const coverCourse = courses.find((course) => course.number === 1) ?? courses[0];

    return {
      index,
      stableKey: bucket.stableKey,
      outerType: bucket.outerType,
      type: bucket.type,
      episodeCount: courses.length,
      price: coverCourse?.url ?? null,
      title: coverCourse?.title ?? "",
      info: coverCourse?.info ?? "",
      picLink: coverCourse?.picLink ?? "",
      updateTime: coverCourse?.updateTime ?? "",
    };
  });

  const groupedCourses = sortedBuckets.map((bucket, index) => ({
    mainID: index,
    stableKey: bucket.stableKey,
    type: bucket.type,
    courses: [...bucket.courses].sort((a, b) => a.number - b.number),
  }));

  return { outerCourses, groupedCourses };
}

/**
 * 将课程价格字段转换为数字，免费或空价格返回 null。
 */
function getCoursePriceNumber(course: OuterCourse): number | null {
  if (!course.price || course.price === "free") return null;

  const price = Number(course.price);
  return Number.isFinite(price) ? price : null;
}

/**
 * 判断课程价格是否落在当前筛选区间内。
 */
function matchesPriceRange(course: OuterCourse, priceRange: string | null): boolean {
  if (!priceRange) return true;
  if (priceRange === "free") return course.price === "free";

  const price = getCoursePriceNumber(course);
  if (price === null) return false;

  if (priceRange.endsWith("+")) {
    const min = Number(priceRange.replace("+", ""));
    return Number.isFinite(min) ? price >= min : true;
  }

  const [min, max] = priceRange.split("-").map(Number);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return true;

  return price >= min && price <= max;
}

/**
 * 根据搜索词、课程类别和价格区间过滤首页课程列表。
 */
export function filterCourses(courses: OuterCourse[], filters: CourseFilters): OuterCourse[] {
  const query = filters.searchQuery.trim().toLowerCase();

  return courses.filter((course) => {
    const matchesQuery =
      !query ||
      course.title.toLowerCase().includes(query) ||
      course.type.toLowerCase().includes(query) ||
      course.info.toLowerCase().includes(query);
    const matchesCategory = !filters.category || course.outerType === filters.category;
    const matchesPrice = matchesPriceRange(course, filters.priceRange);

    return matchesQuery && matchesCategory && matchesPrice;
  });
}

/**
 * 生成筛选后的课程列表，供课程首页直接渲染。
 */
export function useFilteredCourses(courses: OuterCourse[], filters: CourseFilters) {
  return useMemo(() => filterCourses(courses, filters), [courses, filters]);
}

function courseVideoProgressKey(storageID: number | string) {
  return `course_video_progress_${storageID}`;
}

export function readStoredEpisodeProgress(storageID: number | string): CourseVideoProgress | null {
  if (typeof window === "undefined") return null;

  const storedValue = window.localStorage.getItem(courseVideoProgressKey(storageID));
  if (!storedValue) return null;

  try {
    const parsedValue = JSON.parse(storedValue) as Partial<CourseVideoProgress>;
    const currentTime = Number(parsedValue.currentTime);
    const duration = Number(parsedValue.duration);
    const updatedAt = Number(parsedValue.updatedAt);

    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) {
      return null;
    }

    return {
      currentTime: Math.min(Math.max(currentTime, 0), duration),
      duration,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function readLatestStoredEpisodeProgress(
  episodeID: number,
  stableProgressKey?: string
): CourseVideoProgress | null {
  const idProgress = readStoredEpisodeProgress(episodeID);
  const stableProgress = stableProgressKey ? readStoredEpisodeProgress(stableProgressKey) : null;

  if (!idProgress) return stableProgress;
  if (!stableProgress) return idProgress;
  return stableProgress.updatedAt >= idProgress.updatedAt ? stableProgress : idProgress;
}

export function writeStoredEpisodeProgress(
  episodeID: number,
  progress: Pick<CourseVideoProgress, "currentTime" | "duration">,
  stableProgressKey?: string
) {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(progress.duration) || progress.duration <= 0) return;

  const payload = JSON.stringify({
    currentTime: Math.min(Math.max(progress.currentTime, 0), progress.duration),
    duration: progress.duration,
    updatedAt: Date.now(),
  });

  window.localStorage.setItem(courseVideoProgressKey(episodeID), payload);
  if (stableProgressKey) {
    window.localStorage.setItem(courseVideoProgressKey(stableProgressKey), payload);
  }
}

/**
 * 从路由参数中解析课程系列 ID。
 */
function parseSeriesID(seriesID: string | number | undefined): number | null {
  if (seriesID === undefined || seriesID === null) return null;

  const parsedSeriesID = Number(seriesID);
  return Number.isInteger(parsedSeriesID) ? parsedSeriesID : null;
}

/**
 * 读取指定课程系列最近观看的集数 ID。
 */
function readStoredEpisodeID(seriesID: number): number | null {
  if (typeof window === "undefined") return null;

  const storedEpisodeID = Number(window.localStorage.getItem(`course_progress_${seriesID}`));
  return Number.isInteger(storedEpisodeID) ? storedEpisodeID : null;
}

function readStoredStableEpisodeKey(seriesStableKey: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`course_progress_key_${seriesStableKey}`);
}

/**
 * 写入指定课程系列最近观看的集数 ID。
 */
export function writeStoredEpisodeID(
  seriesID: number,
  episodeID: number,
  stableEpisodeKey?: string,
  seriesStableKey?: string
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`course_progress_${seriesID}`, String(episodeID));
  if (stableEpisodeKey && seriesStableKey) {
    window.localStorage.setItem(`course_progress_key_${seriesStableKey}`, stableEpisodeKey);
  }
}

function calculateCourseProgress(groupedCourse: GroupedCourse): number {
  if (typeof window === "undefined" || groupedCourse.courses.length === 0) return 0;

  let watchedProgress = 0;
  let trackedEpisodes = 0;

  groupedCourse.courses.forEach((course) => {
    const progress = readLatestStoredEpisodeProgress(
      course.id,
      courseEpisodeStableKey(groupedCourse.stableKey, course.number)
    );
    if (!progress) return;

    watchedProgress += Math.min(progress.currentTime / progress.duration, 1);
    trackedEpisodes += 1;
  });

  if (trackedEpisodes > 0) {
    return Math.round((watchedProgress / groupedCourse.courses.length) * 100);
  }

  const storedEpisodeID = readStoredEpisodeID(groupedCourse.mainID);
  const storedStableEpisodeKey = readStoredStableEpisodeKey(groupedCourse.stableKey);
  const storedEpisodeIndex = groupedCourse.courses.findIndex((course) => {
    const stableKey = courseEpisodeStableKey(groupedCourse.stableKey, course.number);
    return stableKey === storedStableEpisodeKey || course.id === storedEpisodeID;
  });

  if (storedEpisodeIndex < 0) return 0;
  return Math.round((storedEpisodeIndex / groupedCourse.courses.length) * 100);
}

export function useCourseProgressMap(groupedCourses: GroupedCourse[]) {
  const [progressMap, setProgressMap] = useState<CourseProgressMap>({});

  useEffect(() => {
    const nextProgressMap: CourseProgressMap = {};

    groupedCourses.forEach((groupedCourse) => {
      nextProgressMap[groupedCourse.mainID] = calculateCourseProgress(groupedCourse);
    });

    setProgressMap(nextProgressMap);
  }, [groupedCourses]);

  return progressMap;
}

/**
 * 根据本地进度或第一集选择当前需要展示的课程集数。
 */
function resolveCurrentCourse(groupedCourse: GroupedCourse | null): Course | null {
  if (!groupedCourse) return null;

  const storedStableEpisodeKey = readStoredStableEpisodeKey(groupedCourse.stableKey);
  const storedEpisodeID = readStoredEpisodeID(groupedCourse.mainID);
  return (
    groupedCourse.courses.find(
      (course) =>
        courseEpisodeStableKey(groupedCourse.stableKey, course.number) === storedStableEpisodeKey
    ) ??
    groupedCourse.courses.find((course) => course.id === storedEpisodeID) ??
    groupedCourse.courses[0] ??
    null
  );
}

/**
 * 获取所有课程列表 Hook
 */
export function useCourseList() {
  const locale = useLocale() as Locale;
  // useQuery 自动处理 loading/error，data 是后端 data 包本身
  const { data, isLoading, error } = useQuery({
    queryKey: ["courses", locale], //缓存key
    queryFn: getCourseList,
  });

  const { outerCourses, groupedCourses } = useMemo(
    () => buildCoursePackages(data, locale),
    [data, locale]
  );

  return {
    // 直接返回 useQuery 的状态
    isLoading,
    error,
    data,
    outerCourses,
    groupedCourses,
  };
}

/**
 * 获取课程系列详情、当前集数详情和当前集数视频链接。
 */
export function useCourseDetail(mainID: string | number | undefined) {
  const locale = useLocale() as Locale;
  const parsedSeriesID = parseSeriesID(mainID);
  const {
    isLoading: isCourseListLoading,
    error: courseListError,
    outerCourses,
    groupedCourses,
  } = useCourseList();
  const [selectedEpisodeID, setSelectedEpisodeID] = useState<number | null>(null);

  const outerCourse = useMemo(
    () => outerCourses.find((course) => course.index === parsedSeriesID) ?? null,
    [outerCourses, parsedSeriesID]
  );

  const groupedCourse = useMemo(
    () => groupedCourses.find((courseGroup) => courseGroup.mainID === parsedSeriesID) ?? null,
    [groupedCourses, parsedSeriesID]
  );

  const currentCourse = useMemo(() => {
    if (!groupedCourse) return null;

    if (selectedEpisodeID !== null) {
      return (
        groupedCourse.courses.find((course) => course.id === selectedEpisodeID) ??
        resolveCurrentCourse(groupedCourse)
      );
    }

    return resolveCurrentCourse(groupedCourse);
  }, [groupedCourse, selectedEpisodeID]);

  const stableProgressKey = useMemo(() => {
    if (!currentCourse) return "";
    return courseEpisodeStableKey(groupedCourse?.stableKey ?? "", currentCourse.number);
  }, [currentCourse, groupedCourse?.stableKey]);

  useEffect(() => {
    if (parsedSeriesID === null || !currentCourse || !groupedCourse) return;
    const stableKey = courseEpisodeStableKey(groupedCourse.stableKey, currentCourse.number);
    writeStoredEpisodeID(parsedSeriesID, currentCourse.id, stableKey, groupedCourse.stableKey);
  }, [currentCourse, parsedSeriesID, groupedCourse]);

  const videoLinkQuery = useQuery({
    queryKey: ["course-video-link", currentCourse?.id, locale],
    queryFn: () => getCourseVideoLink(currentCourse!.id),
    enabled: !!currentCourse?.id,
  });

  const detail = useMemo<CourseDetailData>(
    () => ({
      detail: {
        mainID: groupedCourse?.mainID ?? parsedSeriesID ?? -1,
        title: currentCourse?.title ?? outerCourse?.title ?? "",
        info: currentCourse?.info ?? outerCourse?.info ?? "",
        updateTime: currentCourse?.updateTime ?? outerCourse?.updateTime ?? "",
        vedioLink: isCourseApiError(videoLinkQuery.error, 403)
          ? ""
          : (videoLinkQuery.data ?? currentCourse?.vedioLink ?? ""),
      },
      series:
        groupedCourse?.courses.map((course) => ({
          id: course.id,
          title: course.title,
          picLink: course.picLink,
          stableProgressKey: courseEpisodeStableKey(groupedCourse?.stableKey ?? "", course.number),
        })) ?? [],
      currentId: currentCourse?.id ?? -1,
      stableProgressKey,
    }),
    [
      currentCourse,
      groupedCourse,
      outerCourse,
      parsedSeriesID,
      videoLinkQuery.data,
      videoLinkQuery.error,
      stableProgressKey,
    ]
  );

  /**
   * 切换当前播放课程，并同步写入当前系列的本地播放进度。
   */
  function setCurrentEpisode(episodeID: number) {
    if (parsedSeriesID === null || !groupedCourse) return;
    const course = groupedCourse.courses.find((c) => c.id === episodeID);
    if (!course) return;
    const stableKey = courseEpisodeStableKey(groupedCourse.stableKey, course.number);
    writeStoredEpisodeID(parsedSeriesID, episodeID, stableKey, groupedCourse.stableKey);
    setSelectedEpisodeID(episodeID);
  }

  return {
    isLoading: isCourseListLoading || videoLinkQuery.isLoading,
    error:
      courseListError ??
      (isCourseApiError(videoLinkQuery.error, 403) ? null : videoLinkQuery.error),
    videoLinkError: videoLinkQuery.error,
    detail,
    setCurrentEpisode,
    stableProgressKey,
  };
}
