"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useAdminSessionRequests } from "../admin-session-boundary";
import { useAdminOperation } from "../use-admin-operation";
import { adminUiApiPath } from "@/lib/admin-api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconBook2,
  IconCloudOff,
  IconCloudUpload,
  IconDeviceFloppy,
  IconGripVertical,
  IconLoader2,
  IconPhoto,
  IconPlus,
  IconTrash,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/admin/page-header";
import { ErrorBanner, Field, StatusPill } from "@/components/admin/news/shared";
import { FormLabel, TextInput } from "@/components/admin/billing/shared";
import { InstructorPicker } from "@/components/admin/courses/instructor-picker";
import { CourseCertificateEditor } from "@/components/admin/courses/course-certificate-editor";
import {
  COURSE_LOCALES,
  COURSE_PRIMARY_LOCALE,
  COURSE_TYPES,
  courseDisplayTitle,
  emptyCourseVideo,
  emptyLocalizedCourse,
  hasAnyCourseTitle,
  parseCourseType,
  resolveCourseCoverUrl,
  type Course,
  type CourseLocaleCode,
  type CourseType,
  type CourseVideo,
} from "@/components/admin/courses/types";
import { cn } from "@/lib/utils";

function CoverThumb({
  url,
  label = "封面预览",
  className,
}: {
  url: string;
  label?: string;
  className?: string;
}) {
  const src = resolveCourseCoverUrl(url);
  return (
    <div className={cn("w-full max-w-[200px] shrink-0", className)}>
      <p className="mb-1.5 text-[12px] font-medium text-slate-600">{label}</p>
      <div className="aspect-video overflow-hidden rounded-md border border-slate-200 bg-slate-100">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-slate-300">
            <IconPhoto className="size-6" />
          </div>
        )}
      </div>
    </div>
  );
}

async function uploadCoverFile(file: File, signal: AbortSignal): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(adminUiApiPath("/api/admin/courses/upload/cover"), {
    method: "POST",
    body: form,
    signal,
  });
  const body = (await response.json().catch(() => null)) as {
    path?: string;
    data?: string;
    error?: string;
    msg?: string;
  } | null;
  signal.throwIfAborted();
  const path = body?.path?.trim() || (typeof body?.data === "string" ? body.data.trim() : "");
  if (!response.ok || !path) {
    throw new Error(body?.error ?? body?.msg ?? "文件上传失败");
  }
  return path;
}

function extractOssErrorMessage(bodyText: string, status: number): string {
  const code = bodyText.match(/<Code>([^<]+)<\/Code>/i)?.[1];
  const message = bodyText.match(/<Message>([^<]+)<\/Message>/i)?.[1];
  if (code && message) return `${code}: ${message}`;
  if (message) return message;
  return `HTTP ${status}`;
}

function putCourseVideoToOss(
  uploadUrl: string,
  method: string,
  headers: Record<string, string>,
  file: File,
  signal: AbortSignal,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Upload aborted", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      xhr.onload = xhr.onerror = xhr.onabort = null;
      xhr.upload.onprogress = null;
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      xhr.abort();
      finish(new DOMException("Upload aborted", "AbortError"));
    };
    try {
      xhr.open(method || "PUT", uploadUrl, true);
      const merged = new Headers(headers);
      if (!merged.has("content-type"))
        merged.set("content-type", file.type || "application/octet-stream");
      merged.forEach((value, key) => xhr.setRequestHeader(key, value));
      xhr.upload.onprogress = (event) => {
        if (!settled && !signal.aborted && event.lengthComputable && event.total > 0)
          onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) finish();
        else
          finish(
            new Error(
              xhr.responseText
                ? `文件上传失败：${extractOssErrorMessage(xhr.responseText, xhr.status)}`
                : "文件上传失败"
            )
          );
      };
      xhr.onerror = () => finish(new Error("文件上传失败"));
      xhr.onabort = () => finish(new DOMException("Upload aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else xhr.send(file);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function uploadCourseVideoDirect(
  file: File,
  signal: AbortSignal,
  onProgress?: (percent: number) => void
): Promise<string> {
  const urlRes = await fetch(adminUiApiPath("/api/admin/courses/upload/video-url"), {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name || "video.mp4",
      contentType: file.type || "application/octet-stream",
    }),
  });
  const urlBody = (await urlRes.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    error?: string;
    data?: {
      uploadUrl?: string;
      method?: string;
      headers?: Record<string, string>;
      path?: string;
    };
  } | null;
  signal.throwIfAborted();
  if (!urlRes.ok || urlBody?.code !== 200 || !urlBody.data?.uploadUrl || !urlBody.data.path) {
    throw new Error(urlBody?.error ?? urlBody?.msg ?? "文件上传失败");
  }
  const { uploadUrl, method, headers, path } = urlBody.data;
  await putCourseVideoToOss(uploadUrl, method || "PUT", headers ?? {}, file, signal, onProgress);
  signal.throwIfAborted();
  return path;
}

function reindexVideos(videos: CourseVideo[]): CourseVideo[] {
  return videos.map((video, index) => ({ ...video, sortOrder: index + 1, sectionId: null }));
}

type UploadSlot = {
  percent: number | null;
};

function courseCoverUploadKey() {
  return "cover";
}

function videoFileUploadKey(clientKey: string) {
  return `video-file:${clientKey}`;
}

function videoCoverUploadKey(clientKey: string) {
  return `video-cover:${clientKey}`;
}

export function CourseEditor(props: Parameters<typeof CourseEditorContent>[0]) {
  return <CourseEditorContent key={props.course?.id ?? "missing"} {...props} />;
}

function CourseEditorContent({
  course: initial,
  loadError,
  siteLabel,
  databaseLabel,
}: {
  course: Course | null;
  loadError: string | null;
  siteLabel: string;
  databaseLabel: string;
}) {
  const router = useRouter();
  const { busy: writeBusy, begin } = useAdminOperation();
  const writing = useRef(false);
  const activeWrite = useRef<ReturnType<typeof begin>>(null);
  const requests = useAdminSessionRequests();
  const uploadKeys = useRef(new Map<string, NonNullable<ReturnType<typeof requests.begin>>>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const leases = uploadKeys.current;
    return () => {
      mounted.current = false;
      for (const lease of leases.values()) {
        lease.cancel();
        lease.release();
      }
      leases.clear();
    };
  }, []);
  const [course, setCourse] = useState<Course | null>(initial);
  const [locale, setLocale] = useState<CourseLocaleCode>(COURSE_PRIMARY_LOCALE);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  /** Per-slot in-flight uploads — covers and videos can run in parallel. */
  const [uploads, setUploads] = useState<Record<string, UploadSlot>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(loadError);
  const [notice, setNotice] = useState<string | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const localized = course?.localized ?? emptyLocalizedCourse();
  const currentLocale = localized[locale];

  const titlePreview = useMemo(() => (course ? courseDisplayTitle(course) : "课程编辑"), [course]);

  function beginUpload(key: string, withPercent: boolean) {
    if (!mounted.current || writing.current || uploadKeys.current.has(key)) return null;
    const lease = requests.begin();
    if (!lease) return null;
    uploadKeys.current.set(key, lease);
    setUploads((current) => ({ ...current, [key]: { percent: withPercent ? 0 : null } }));
    setUploadErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    return {
      ...lease,
      current: () => mounted.current && uploadKeys.current.get(key) === lease && lease.current(),
    };
  }

  function setUploadPercent(key: string, percent: number) {
    setUploads((current) => {
      if (!current[key]) return current;
      return { ...current, [key]: { percent } };
    });
  }

  function endUpload(key: string, operation: NonNullable<ReturnType<typeof beginUpload>>) {
    if (uploadKeys.current.get(key)?.signal !== operation.signal) return;
    uploadKeys.current.delete(key);
    operation.release();
    if (!mounted.current) return;
    setUploads((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function failUpload(key: string, message: string) {
    setUploadErrors((current) => ({ ...current, [key]: message }));
  }

  if (!course) {
    return (
      <div className="space-y-4">
        <PageHeader title="课程编辑" description={`${siteLabel} · ${databaseLabel}`} />
        <ErrorBanner message={error ?? "课程不存在或加载失败。"} />
        <Button variant="outline" asChild>
          <Link
            href="/courses"
            onClick={() => {
              writing.current = true;
              activeWrite.current?.cancel();
              activeWrite.current?.finish();
              for (const lease of uploadKeys.current.values()) {
                lease.cancel();
                lease.release();
              }
              uploadKeys.current.clear();
            }}
          >
            <IconArrowLeft className="size-4" />
            返回列表
          </Link>
        </Button>
      </div>
    );
  }

  function patchLocale(patch: Partial<(typeof localized)[CourseLocaleCode]>) {
    setCourse((current) => {
      if (!current) return current;
      return {
        ...current,
        localized: {
          ...current.localized,
          [locale]: { ...current.localized[locale], ...patch },
        },
      };
    });
  }

  function setVideos(next: CourseVideo[]) {
    const retained = new Set(next.map((video) => video.clientKey));
    for (const video of course?.videos ?? []) {
      if (retained.has(video.clientKey)) continue;
      for (const key of [
        videoFileUploadKey(video.clientKey),
        videoCoverUploadKey(video.clientKey),
      ]) {
        const lease = uploadKeys.current.get(key);
        if (lease) {
          lease.cancel();
          lease.release();
          uploadKeys.current.delete(key);
        }
        setUploads((current) => {
          const result = { ...current };
          delete result[key];
          return result;
        });
      }
    }
    setCourse((current) => (current ? { ...current, videos: reindexVideos(next) } : current));
  }

  async function handleCoverUpload(file: File | null) {
    if (!file) return;
    const key = courseCoverUploadKey();
    const operation = beginUpload(key, false);
    if (!operation) return;
    try {
      const path = await uploadCoverFile(file, operation.signal);
      if (!operation.current()) return;
      setCourse((current) =>
        current && current.localized[locale].coverUrl === currentLocale.coverUrl
          ? {
              ...current,
              localized: {
                ...current.localized,
                [locale]: { ...current.localized[locale], coverUrl: path },
              },
            }
          : current
      );
    } catch (err) {
      if (operation.current()) failUpload(key, err instanceof Error ? err.message : "文件上传失败");
    } finally {
      endUpload(key, operation);
    }
  }

  async function handleVideoFileUpload(clientKey: string, file: File | null) {
    if (!file) return;
    const key = videoFileUploadKey(clientKey);
    const operation = beginUpload(key, true);
    if (!operation) return;
    try {
      const path = await uploadCourseVideoDirect(file, operation.signal, (percent) => {
        if (operation.current()) setUploadPercent(key, percent);
      });
      if (!operation.current()) return;
      setCourse((current) => {
        if (!current) return current;
        const videos = current.videos.map((video) =>
          video.clientKey === clientKey &&
          video.videoKey === course?.videos.find((item) => item.clientKey === clientKey)?.videoKey
            ? { ...video, videoKey: path }
            : video
        );
        return { ...current, videos };
      });
    } catch (err) {
      if (operation.current()) failUpload(key, err instanceof Error ? err.message : "文件上传失败");
    } finally {
      endUpload(key, operation);
    }
  }

  async function handleVideoCoverUpload(clientKey: string, file: File | null) {
    if (!file) return;
    const key = videoCoverUploadKey(clientKey);
    const operation = beginUpload(key, false);
    if (!operation) return;
    try {
      const path = await uploadCoverFile(file, operation.signal);
      if (!operation.current()) return;
      setCourse((current) => {
        if (!current) return current;
        const videos = current.videos.map((video) =>
          video.clientKey === clientKey &&
          video.coverUrl === course?.videos.find((item) => item.clientKey === clientKey)?.coverUrl
            ? { ...video, coverUrl: path }
            : video
        );
        return { ...current, videos };
      });
    } catch (err) {
      if (operation.current()) failUpload(key, err instanceof Error ? err.message : "文件上传失败");
    } finally {
      endUpload(key, operation);
    }
  }

  async function save() {
    if (!course || writing.current || uploadKeys.current.size) return;
    if (!hasAnyCourseTitle(course.localized)) {
      setError("至少填写一种语言的课程名称。");
      return;
    }
    for (const [index, video] of course.videos.entries()) {
      if (!video.videoKey.trim()) {
        setError(`第 ${index + 1} 个视频缺少视频文件。`);
        return;
      }
    }
    const shares: Array<{ userId: string; shareBps: number }> = [];
    for (const item of course.instructors) {
      const raw = item.sharePercent?.trim() ?? "";
      if (!raw) continue;
      const bps = Math.round(Number(raw) * 100);
      if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
        setError(`讲师 ${item.nickName || item.userId} 的分润无效。`);
        return;
      }
      shares.push({ userId: item.userId, shareBps: bps });
    }
    if (shares.reduce((sum, item) => sum + item.shareBps, 0) > 10000) {
      setError("讲师分润合计不能超过 100%。");
      return;
    }
    if (course.priceCredits.trim() && !/^(0|[1-9]\d{0,11})$/.test(course.priceCredits.trim())) {
      setError("总费用须为非负整数。");
      return;
    }
    const operation = begin();
    if (!operation) return;
    activeWrite.current = operation;
    writing.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        adminUiApiPath(`/api/admin/courses/${encodeURIComponent(course.id)}`),
        {
          signal: operation.signal,
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            localized: course.localized,
            videos: course.videos.map((video, index) => ({
              videoKey: video.videoKey,
              coverUrl: video.coverUrl,
              sortOrder: index + 1,
              localized: video.localized,
            })),
            instructorUserIds: course.instructors.map((item) => item.userId),
            certificateId: course.certificateId,
            priceCredits: course.priceCredits.trim() || "0",
            enrollmentEnabled: /^(0|[1-9]\d{0,11})$/.test(course.priceCredits.trim())
              ? Number(course.priceCredits.trim()) > 0
              : false,
            instructorShares: shares,
            type: parseCourseType(course.type),
          }),
        }
      );
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!operation.current()) return;
      if (!response.ok) throw new Error(body?.error ?? `保存失败：${response.status}`);
      setNotice("已保存（未改变上架状态）。");
      router.refresh();
    } catch (err) {
      if (operation.current()) setError(err instanceof Error ? err.message : "保存失败。");
    } finally {
      if (operation.current()) {
        setSaving(false);
        writing.current = false;
      }
      operation.finish();
    }
  }

  async function togglePublish() {
    if (!course || writing.current || uploadKeys.current.size) return;
    if (!course.published && !hasAnyCourseTitle(course.localized)) {
      setError("发布前请至少填写一种语言的课程名称，并先保存。");
      return;
    }
    const operation = begin();
    if (!operation) return;
    activeWrite.current = operation;
    writing.current = true;
    setPublishing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        adminUiApiPath(`/api/admin/courses/${encodeURIComponent(course.id)}/publish`),
        {
          signal: operation.signal,
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ published: !course.published }),
        }
      );
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!operation.current()) return;
      if (!response.ok) throw new Error(body?.error ?? `操作失败：${response.status}`);
      setCourse((current) => (current ? { ...current, published: !course.published } : current));
      setNotice(course.published ? "已下架。" : "已发布上架。");
    } catch (err) {
      if (operation.current()) setError(err instanceof Error ? err.message : "更新发布状态失败。");
    } finally {
      if (operation.current()) {
        setPublishing(false);
        writing.current = false;
      }
      operation.finish();
    }
  }

  function moveVideo(index: number, delta: number) {
    setCourse((current) => {
      if (!current) return current;
      const target = index + delta;
      if (target < 0 || target >= current.videos.length) return current;
      const next = [...current.videos];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return { ...current, videos: reindexVideos(next) };
    });
  }

  function reorderVideo(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setCourse((current) => {
      if (!current) return current;
      if (from >= current.videos.length || to >= current.videos.length) return current;
      const next = [...current.videos];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { ...current, videos: reindexVideos(next) };
    });
  }

  function handleVideoDragStart(index: number, event: DragEvent<HTMLButtonElement>) {
    setDraggingIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    // Improve drag ghost readability in some browsers.
    event.dataTransfer.setData("application/x-course-video-index", String(index));
  }

  function handleVideoDragOver(index: number, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) setDragOverIndex(index);
  }

  function handleVideoDrop(index: number, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const raw =
      event.dataTransfer.getData("application/x-course-video-index") ||
      event.dataTransfer.getData("text/plain");
    const from = Number(raw);
    if (Number.isFinite(from)) reorderVideo(from, index);
    setDraggingIndex(null);
    setDragOverIndex(null);
  }

  function handleVideoDragEnd() {
    setDraggingIndex(null);
    setDragOverIndex(null);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={titlePreview}
        description={`${siteLabel} · ${databaseLabel} · #${course.id}`}
      />
      <div className="sticky top-12 z-10 flex flex-wrap items-center justify-end gap-2 border-b border-slate-200 bg-white/95 py-2 backdrop-blur">
        {course.published ? (
          <StatusPill tone="success">已上架</StatusPill>
        ) : (
          <StatusPill tone="muted">未上架</StatusPill>
        )}
        <Button variant="outline" asChild>
          <Link
            href="/courses"
            onClick={() => {
              writing.current = true;
              activeWrite.current?.cancel();
              activeWrite.current?.finish();
              for (const lease of uploadKeys.current.values()) {
                lease.cancel();
                lease.release();
              }
              uploadKeys.current.clear();
            }}
          >
            <IconArrowLeft className="size-4" />
            返回
          </Link>
        </Button>
        <Button
          variant="outline"
          disabled={publishing || saving || Object.keys(uploads).length > 0}
          onClick={() => void togglePublish()}
        >
          {course.published ? (
            <>
              <IconCloudOff className="size-4" />
              下架
            </>
          ) : (
            <>
              <IconCloudUpload className="size-4" />
              发布
            </>
          )}
        </Button>
        <Button
          disabled={saving || publishing || Object.keys(uploads).length > 0}
          onClick={() => void save()}
        >
          {saving ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : (
            <IconDeviceFloppy className="size-4" />
          )}
          保存
        </Button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      <section
        inert={writeBusy}
        className="space-y-4 rounded-xl border border-slate-200 border-l-4 border-l-slate-800 bg-white p-4 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-900 text-white">
            <IconBook2 className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">课程信息</p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              按语言编辑名称、封面与描述；切换语言标签即可分别填写。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {COURSE_LOCALES.map((item) => (
            <Button
              key={item.code}
              type="button"
              size="sm"
              variant={locale === item.code ? "default" : "outline"}
              onClick={() => setLocale(item.code)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1 space-y-4">
            <FormLabel label="课程名称" help="必填（至少一种语言）。">
              <TextInput
                value={currentLocale.title}
                onChange={(event) => patchLocale({ title: event.target.value })}
                placeholder="课程名称"
              />
            </FormLabel>
            <FormLabel
              label="封面"
              help="上传后写入当前语言 coverUrl（相对 path 会自动拼 banner 桶域名预览）。"
            >
              <div className="space-y-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <TextInput
                    value={currentLocale.coverUrl}
                    onChange={(event) => patchLocale({ coverUrl: event.target.value })}
                    placeholder="封面 URL / OSS path"
                  />
                  <label className="inline-flex shrink-0">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const selected = event.target.files?.[0] ?? null;
                        event.target.value = "";
                        void handleCoverUpload(selected);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      asChild
                      disabled={Boolean(uploads[courseCoverUploadKey()])}
                    >
                      <span>
                        {uploads[courseCoverUploadKey()] ? (
                          <IconLoader2 className="size-4 animate-spin" />
                        ) : (
                          <IconUpload className="size-4" />
                        )}
                        上传
                      </span>
                    </Button>
                  </label>
                </div>
                {uploadErrors[courseCoverUploadKey()] ? (
                  <p className="text-[12px] text-red-600">{uploadErrors[courseCoverUploadKey()]}</p>
                ) : null}
              </div>
            </FormLabel>
            <Field label="课程描述">
              <Textarea
                value={currentLocale.description}
                onChange={(event) => patchLocale({ description: event.target.value })}
                rows={4}
                placeholder="可选"
                className="min-h-24"
              />
            </Field>
          </div>
          <CoverThumb url={currentLocale.coverUrl} className="sm:sticky sm:top-4" />
        </div>

        <div className="grid items-start gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0">
            <FormLabel label="课程分类">
              <select
                aria-label="课程分类"
                value={String(parseCourseType(course.type))}
                onChange={(event) =>
                  setCourse((current) =>
                    current
                      ? { ...current, type: Number(event.target.value) as CourseType }
                      : current
                  )
                }
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              >
                {COURSE_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </FormLabel>
          </div>
          <div className="min-w-0">
            <CourseCertificateEditor
              value={course.certificateId == null ? "" : String(course.certificateId)}
              onChange={(value) =>
                setCourse((current) =>
                  current ? { ...current, certificateId: value ? Number(value) : null } : current
                )
              }
            />
          </div>
          <div className="min-w-0">
            <FormLabel label="总费用（社区积分）">
              <TextInput
                type="number"
                min={0}
                max={999999999999}
                step={1}
                value={course.priceCredits ?? ""}
                onChange={(event) =>
                  setCourse((current) =>
                    current ? { ...current, priceCredits: event.target.value } : current
                  )
                }
              />
            </FormLabel>
          </div>
        </div>
      </section>

      <section
        inert={writeBusy}
        className="space-y-4 rounded-xl border border-indigo-100 border-l-4 border-l-indigo-500 bg-indigo-50/30 p-4 shadow-sm"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-600 text-white">
              <IconVideo className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">视频列表</p>
              <p className="mt-0.5 text-[12px] text-slate-500">
                片源与视频封面各语言共用；标题按语言填写。拖动手柄可排序，也可使用上下按钮。
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 border-indigo-200 bg-white hover:bg-indigo-50"
            onClick={() =>
              setVideos([...course.videos, emptyCourseVideo(course.videos.length + 1)])
            }
          >
            <IconPlus className="size-4" />
            添加视频
          </Button>
        </div>

        {course.videos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-indigo-200 bg-white/70 px-3 py-8 text-center text-sm text-slate-400">
            暂无视频。
          </p>
        ) : (
          <div className="space-y-4">
            {course.videos.map((video, index) => {
              const fileKey = videoFileUploadKey(video.clientKey);
              const coverKey = videoCoverUploadKey(video.clientKey);
              const fileUpload = uploads[fileKey];
              const coverUpload = uploads[coverKey];
              return (
                <div
                  key={video.clientKey}
                  onDragOver={(event) => handleVideoDragOver(index, event)}
                  onDrop={(event) => handleVideoDrop(index, event)}
                  className={cn(
                    "space-y-3 rounded-lg border border-indigo-100 bg-white p-3 transition-shadow",
                    draggingIndex === index && "opacity-60",
                    dragOverIndex === index &&
                      draggingIndex != null &&
                      draggingIndex !== index &&
                      "border-indigo-400 ring-2 ring-indigo-200"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => handleVideoDragStart(index, event)}
                        onDragEnd={handleVideoDragEnd}
                        aria-label={`拖动排序视频 ${index + 1}`}
                        title="拖动排序"
                        className="inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 active:cursor-grabbing"
                      >
                        <IconGripVertical className="size-4" />
                      </button>
                      <p className="text-sm font-semibold text-slate-800">视频 {index + 1}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={index === 0}
                        onClick={() => moveVideo(index, -1)}
                      >
                        <IconArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={index === course.videos.length - 1}
                        onClick={() => moveVideo(index, 1)}
                      >
                        <IconArrowDown className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setVideos(course.videos.filter((_, i) => i !== index))}
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1 space-y-3">
                      <FormLabel label="视频文件">
                        <div className="space-y-1.5">
                          <div className="flex gap-2">
                            <TextInput
                              value={video.videoKey}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCourse((current) => {
                                  if (!current) return current;
                                  const videos = current.videos.map((item, i) =>
                                    i === index ? { ...item, videoKey: value } : item
                                  );
                                  return { ...current, videos };
                                });
                              }}
                              placeholder="course/....mp4"
                            />
                            <label className="inline-flex shrink-0">
                              <input
                                type="file"
                                accept="video/*"
                                className="hidden"
                                onChange={(event) => {
                                  const selected = event.target.files?.[0] ?? null;
                                  event.target.value = "";
                                  void handleVideoFileUpload(video.clientKey, selected);
                                }}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                asChild
                                disabled={Boolean(fileUpload)}
                              >
                                <span>
                                  {fileUpload ? (
                                    <IconLoader2 className="size-4 animate-spin" />
                                  ) : (
                                    <IconUpload className="size-4" />
                                  )}
                                  {fileUpload && fileUpload.percent != null
                                    ? `${fileUpload.percent}%`
                                    : "上传"}
                                </span>
                              </Button>
                            </label>
                          </div>
                          {fileUpload && fileUpload.percent != null ? (
                            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-slate-800 transition-[width] duration-150"
                                style={{ width: `${fileUpload.percent}%` }}
                              />
                            </div>
                          ) : null}
                          {uploadErrors[fileKey] ? (
                            <p className="text-[12px] text-red-600">{uploadErrors[fileKey]}</p>
                          ) : null}
                        </div>
                      </FormLabel>
                      <FormLabel label="视频封面">
                        <div className="space-y-1.5">
                          <div className="flex gap-2">
                            <TextInput
                              value={video.coverUrl}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCourse((current) => {
                                  if (!current) return current;
                                  const videos = current.videos.map((item, i) =>
                                    i === index ? { ...item, coverUrl: value } : item
                                  );
                                  return { ...current, videos };
                                });
                              }}
                              placeholder="可选"
                            />
                            <label className="inline-flex shrink-0">
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/gif,image/webp"
                                className="hidden"
                                onChange={(event) => {
                                  const selected = event.target.files?.[0] ?? null;
                                  event.target.value = "";
                                  void handleVideoCoverUpload(video.clientKey, selected);
                                }}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                asChild
                                disabled={Boolean(coverUpload)}
                              >
                                <span>
                                  {coverUpload ? (
                                    <IconLoader2 className="size-4 animate-spin" />
                                  ) : (
                                    <IconUpload className="size-4" />
                                  )}
                                  上传
                                </span>
                              </Button>
                            </label>
                          </div>
                          {uploadErrors[coverKey] ? (
                            <p className="text-[12px] text-red-600">{uploadErrors[coverKey]}</p>
                          ) : null}
                        </div>
                      </FormLabel>
                    </div>
                    <CoverThumb url={video.coverUrl} label="封面" className="max-w-[160px]" />
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {COURSE_LOCALES.map((item) => (
                      <FormLabel key={item.code} label={`标题 · ${item.short}`}>
                        <TextInput
                          value={video.localized[item.code].title}
                          onChange={(event) => {
                            const value = event.target.value;
                            setCourse((current) => {
                              if (!current) return current;
                              const videos = current.videos.map((entry, i) => {
                                if (i !== index) return entry;
                                return {
                                  ...entry,
                                  localized: {
                                    ...entry.localized,
                                    [item.code]: { title: value },
                                  },
                                };
                              });
                              return { ...current, videos };
                            });
                          }}
                          placeholder={`${item.label} 标题`}
                        />
                      </FormLabel>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section
        inert={writeBusy}
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <InstructorPicker
          instructors={course.instructors}
          onChange={(instructors) => {
            if (writing.current) return;
            setCourse((current) => (current ? { ...current, instructors } : current));
          }}
          headerActions={
            <Button
              size="sm"
              disabled={saving || publishing || Object.keys(uploads).length > 0}
              onClick={() => void save()}
            >
              {saving ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconDeviceFloppy className="size-4" />
              )}
              保存
            </Button>
          }
        />
      </section>
    </div>
  );
}
