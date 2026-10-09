/**
 * Server-side client for the Java 课程 backend `/api/admin/courses`.
 *
 * Base: NEWS_API_BASE_URL (same Java Content origin as news) — must include
 * `/content`. Auth: X-Admin-Api-Token via javaAdminAuthHeaders().
 *
 * NEVER import from client components; mutations go through
 * app/api/admin/courses/* after getAdminSession().
 *
 * Contract: docs/admin-courses-api.md
 */
import { encodeUserId } from "@repo/shared/user-id-codec";
import type {
  Course,
  CourseInstructor,
  CourseLocaleCode,
  CourseLocaleContent,
  CourseVideo,
  CourseVideoLocaleContent,
} from "@/components/admin/courses/types";
import { emptyLocalizedCourse } from "@/components/admin/courses/types";
import { javaAdminAuthHeaders } from "@/lib/java-admin-auth";

function coursesApiBaseUrl(): string {
  const base = process.env.NEWS_API_BASE_URL?.trim();
  if (base) return base.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return "https://java.fizzdragon.com/content";
  throw new Error(
    "Missing NEWS_API_BASE_URL — Java Content origin for 课程 (must include /content)."
  );
}

async function coursesFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(javaAdminAuthHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }
  // Let the runtime set multipart boundary when body is FormData.
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${coursesApiBaseUrl()}/api/admin/courses${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

async function coursesData<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    data?: T;
  } | null;
  if (!response.ok || !payload || payload.code !== 200) {
    throw new Error(payload?.msg ?? `课程服务请求失败：${response.status}`);
  }
  return payload.data as T;
}

/** Normalize Java upload envelope → OSS path / key string. */
function extractUploadPath(payload: {
  code?: number;
  msg?: string;
  data?: unknown;
  path?: unknown;
  url?: unknown;
}): string {
  if (payload.code != null && Number(payload.code) !== 200) {
    throw new Error(payload.msg ?? "上传失败。");
  }
  const candidates: unknown[] = [
    payload.data,
    payload.path,
    payload.url,
    typeof payload.data === "object" && payload.data !== null
      ? (payload.data as { path?: unknown; url?: unknown; key?: unknown }).path
      : null,
    typeof payload.data === "object" && payload.data !== null
      ? (payload.data as { path?: unknown; url?: unknown; key?: unknown }).url
      : null,
    typeof payload.data === "object" && payload.data !== null
      ? (payload.data as { path?: unknown; url?: unknown; key?: unknown }).key
      : null,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  throw new Error(payload.msg?.trim() || "上传成功但未返回文件路径。");
}

async function uploadCourseFile(
  path: "/upload/cover" | "/upload/video",
  file: File
): Promise<string> {
  // Re-buffer so the outbound multipart definitely carries bytes + a filename.
  // Re-wrapping the inbound File/Blob alone has been empty for some Node runtimes.
  const bytes = await file.arrayBuffer();
  const filename = file.name?.trim() || (path.endsWith("/cover") ? "cover.jpg" : "video.mp4");
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: file.type || "application/octet-stream" }),
    filename
  );

  const response = await coursesFetch(path, { method: "POST", body: form });
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    data?: unknown;
    path?: unknown;
    url?: unknown;
  } | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.msg?.trim() || `文件上传失败：${response.status}`);
  }
  return extractUploadPath(payload);
}

interface JavaCourseLocale {
  title?: string | null;
  description?: string | null;
  coverUrl?: string | null;
}

interface JavaVideoLocale {
  title?: string | null;
}

interface JavaCourseVideo {
  id?: number;
  videoKey?: string | null;
  coverUrl?: string | null;
  sortOrder?: number | null;
  sectionId?: number | string | null;
  localized?: Record<string, JavaVideoLocale> | null;
}

interface JavaInstructor {
  userId: number | string;
  nickName?: string | null;
  avatar?: string | null;
  description?: string | null;
  shareBps?: number | string | null;
}

interface JavaInstructorShare {
  userId?: number | string | null;
  shareBps?: number | string | null;
}

interface JavaCourse {
  id: number;
  published?: boolean | number | null;
  createTime?: string | null;
  updateTime?: string | null;
  localized?: Record<string, JavaCourseLocale> | null;
  videos?: JavaCourseVideo[] | null;
  /** Present on list summary when videos[] is omitted. */
  videoCount?: number | null;
  instructors?: JavaInstructor[] | null;
  certificateId?: number | string | null;
  priceCredits?: number | string | null;
  enrollmentEnabled?: boolean | number | null;
  instructorShares?: JavaInstructorShare[] | null;
}

interface JavaCourseListStats {
  total?: number | null;
  published?: number | null;
  unpublished?: number | null;
  instructors?: number | null;
}

interface JavaCourseListData {
  list?: JavaCourse[];
  total?: number;
  stats?: JavaCourseListStats | null;
}

export interface AdminCoursesStats {
  total: number;
  published: number;
  unpublished: number;
  instructors: number;
}

export interface AdminCoursesListData {
  items: Course[];
  stats: AdminCoursesStats;
  total: number;
}

export interface CoursesLoadResult<T> {
  data: T | null;
  error: string | null;
}

/** PUT body — does not change published. */
export interface AdminCourseSaveInput {
  localized: Record<CourseLocaleCode, CourseLocaleContent>;
  videos: Array<{
    videoKey: string;
    coverUrl: string;
    sortOrder: number;
    sectionId: null;
    localized: Record<CourseLocaleCode, CourseVideoLocaleContent>;
  }>;
  /** Real Java numeric user ids (already decoded). */
  instructorUserIds: number[];
  certificateId: number | null;
  priceCredits: number;
  enrollmentEnabled: boolean;
  instructorShares: Array<{ userId: number; shareBps: number }>;
}

function toLocaleContent(java?: JavaCourseLocale | null): CourseLocaleContent {
  return {
    title: java?.title ?? "",
    description: java?.description ?? "",
    coverUrl: java?.coverUrl ?? "",
  };
}

function toVideoLocale(java?: JavaVideoLocale | null): CourseVideoLocaleContent {
  return { title: java?.title ?? "" };
}

function toVideo(java: JavaCourseVideo): CourseVideo {
  const localized = java.localized ?? {};
  const id = java.id != null ? String(java.id) : undefined;
  return {
    id,
    clientKey: id ?? `new-${crypto.randomUUID()}`,
    videoKey: java.videoKey ?? "",
    coverUrl: java.coverUrl ?? "",
    sortOrder: java.sortOrder ?? 0,
    sectionId: java.sectionId == null ? null : String(java.sectionId),
    localized: {
      "zh-CN": toVideoLocale(localized["zh-CN"]),
      "en-US": toVideoLocale(localized["en-US"]),
      "zh-HK": toVideoLocale(localized["zh-HK"]),
    },
  };
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function sharePercentFromBps(bps: number | null): string {
  if (bps == null) return "";
  return String(bps / 100);
}

function toInstructor(java: JavaInstructor, shares: Map<string, number>): CourseInstructor {
  const rawId = String(java.userId);
  const shareBps = asFiniteNumber(java.shareBps) ?? shares.get(rawId) ?? null;
  return {
    userId: encodeUserId(java.userId),
    nickName: java.nickName ?? "",
    avatar: java.avatar ?? "",
    description: java.description ?? "",
    sharePercent: sharePercentFromBps(shareBps),
  };
}

function toCourse(java: JavaCourse): Course {
  const localized = java.localized ?? {};
  const videos = (java.videos ?? []).map(toVideo).sort((a, b) => a.sortOrder - b.sortOrder);
  const shares = new Map<string, number>();
  for (const item of java.instructorShares ?? []) {
    const userId = item.userId == null ? "" : String(item.userId);
    const shareBps = asFiniteNumber(item.shareBps);
    if (userId && shareBps != null) shares.set(userId, shareBps);
  }
  const price = asFiniteNumber(java.priceCredits);
  const certificateId = asFiniteNumber(java.certificateId);
  return {
    id: String(java.id),
    published: java.published === true || java.published === 1,
    localized: {
      "zh-CN": toLocaleContent(localized["zh-CN"]),
      "en-US": toLocaleContent(localized["en-US"]),
      "zh-HK": toLocaleContent(localized["zh-HK"]),
    },
    videos,
    videoCount: java.videoCount ?? videos.length,
    instructors: (java.instructors ?? []).map((instructor) => toInstructor(instructor, shares)),
    certificateId: certificateId != null && certificateId > 0 ? certificateId : null,
    priceCredits: price == null ? "" : String(price),
    enrollmentEnabled: java.enrollmentEnabled === true || java.enrollmentEnabled === 1,
    createTime: java.createTime ?? "",
    updateTime: java.updateTime ?? "",
  };
}

function toQuery(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "课程服务请求失败。";
}

function toStats(java?: JavaCourseListStats | null, totalFallback = 0): AdminCoursesStats {
  return {
    total: java?.total ?? totalFallback,
    published: java?.published ?? 0,
    unpublished: java?.unpublished ?? 0,
    instructors: java?.instructors ?? 0,
  };
}

export async function fetchAdminCoursesList(
  params?: Record<string, string | undefined>
): Promise<CoursesLoadResult<AdminCoursesListData>> {
  try {
    const data = await coursesData<JavaCourseListData>(await coursesFetch(toQuery(params)));
    const total = data.total ?? 0;
    return {
      data: {
        items: (data.list ?? []).map(toCourse),
        stats: toStats(data.stats, total),
        total,
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error: errorMessage(error) };
  }
}

export async function fetchAdminCourseDetail(id: string): Promise<CoursesLoadResult<Course>> {
  try {
    const data = await coursesData<JavaCourse>(await coursesFetch(`/${encodeURIComponent(id)}`));
    return { data: toCourse(data), error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error) };
  }
}

export async function createAdminCourseDraft(): Promise<string> {
  const response = await coursesFetch("", { method: "POST", body: "{}" });
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    id?: number | string;
  } | null;
  if (!response.ok || !payload || payload.code !== 200) {
    throw new Error(payload?.msg ?? `新建课程失败：${response.status}`);
  }
  return String(payload.id ?? "");
}

export async function saveAdminCourse(id: string, input: AdminCourseSaveInput): Promise<void> {
  await coursesData<unknown>(
    await coursesFetch(`/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    })
  );
}

export async function publishAdminCourse(id: string, published: boolean): Promise<void> {
  await coursesData<unknown>(
    await coursesFetch(`/${encodeURIComponent(id)}/publish`, {
      method: "PATCH",
      body: JSON.stringify({ published }),
    })
  );
}

export async function deleteAdminCourse(id: string): Promise<void> {
  await coursesData<unknown>(
    await coursesFetch(`/${encodeURIComponent(id)}`, { method: "DELETE" })
  );
}

/** Returns OSS path / key from envelope.data (string). */
export async function uploadAdminCourseCover(file: File): Promise<string> {
  return uploadCourseFile("/upload/cover", file);
}

/** Multipart fallback — prefer {@link requestAdminCourseVideoUploadUrl} + browser PUT. */
export async function uploadAdminCourseVideo(file: File): Promise<string> {
  return uploadCourseFile("/upload/video", file);
}

export interface AdminCourseVideoUploadUrl {
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
  path: string;
}

/**
 * Presigned PUT for browser-direct OSS upload (avoids Cloudflare body limits).
 * Client must echo `headers` on the PUT and persist `path` as videoKey.
 */
export async function requestAdminCourseVideoUploadUrl(input: {
  fileName: string;
  contentType: string;
}): Promise<AdminCourseVideoUploadUrl> {
  const data = await coursesData<{
    uploadUrl?: string;
    method?: string;
    headers?: Record<string, string>;
    path?: string;
  }>(
    await coursesFetch("/upload/video-url", {
      method: "POST",
      body: JSON.stringify({
        fileName: input.fileName,
        contentType: input.contentType,
      }),
    })
  );
  const uploadUrl = data?.uploadUrl?.trim();
  const path = data?.path?.trim();
  if (!uploadUrl || !path) {
    throw new Error("文件上传失败");
  }
  return {
    uploadUrl,
    method: data.method?.trim() || "PUT",
    headers: data.headers ?? {},
    path,
  };
}

export function emptyDraftCourse(id = ""): Course {
  return {
    id,
    published: false,
    localized: emptyLocalizedCourse(),
    videos: [],
    instructors: [],
    certificateId: null,
    priceCredits: "",
    enrollmentEnabled: false,
    createTime: "",
    updateTime: "",
  };
}
