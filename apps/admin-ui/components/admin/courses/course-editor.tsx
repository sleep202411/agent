"use client";

import { useMemo, useState, type DragEvent } from "react";
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
import {
  COURSE_LOCALES,
  COURSE_PRIMARY_LOCALE,
  courseDisplayTitle,
  emptyCourseVideo,
  emptyLocalizedCourse,
  hasAnyCourseTitle,
  resolveCourseCoverUrl,
  type Course,
  type CourseLocaleCode,
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

async function uploadCoverFile(file: File): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch("/api/admin/courses/upload/cover", { method: "POST", body: form });
  const body = (await response.json().catch(() => null)) as {
    path?: string;
    data?: string;
    error?: string;
    msg?: string;
  } | null;
  const path = body?.path?.trim() || (typeof body?.data === "string" ? body.data.trim() : "");
  if (!response.ok || !path) {
    throw new Error("文件上传失败");
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
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method || "PUT", uploadUrl, true);
    const merged: Record<string, string> = {
      "Content-Type": file.type || "application/octet-stream",
      ...headers,
    };
    for (const [key, value] of Object.entries(merged)) {
      xhr.setRequestHeader(key, value);
    }
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      const bodyText = xhr.responseText || "";
      reject(
        new Error(
          bodyText
            ? `文件上传失败：${extractOssErrorMessage(bodyText, xhr.status)}`
            : "文件上传失败"
        )
      );
    };
    xhr.onerror = () => {
      reject(new Error("文件上传失败"));
    };
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    xhr.send(file);
  });
}

async function uploadCourseVideoDirect(
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  const urlRes = await fetch("/api/admin/courses/upload/video-url", {
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
  if (!urlRes.ok || urlBody?.code !== 200 || !urlBody.data?.uploadUrl || !urlBody.data.path) {
    throw new Error("文件上传失败");
  }
  const { uploadUrl, method, headers, path } = urlBody.data;
  await putCourseVideoToOss(uploadUrl, method || "PUT", headers ?? {}, file, onProgress);
  return path;
}

function reindexVideos(videos: CourseVideo[]): CourseVideo[] {
  return videos.map((video, index) => ({ ...video, sortOrder: index + 1, sectionId: null }));
}

export function CourseEditor({
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
  const [course, setCourse] = useState<Course | null>(initial);
  const [locale, setLocale] = useState<CourseLocaleCode>(COURSE_PRIMARY_LOCALE);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [videoUploadPercent, setVideoUploadPercent] = useState<number | null>(null);
  /** Inline upload tip — not the top ErrorBanner (that stays for save/load). */
  const [uploadError, setUploadError] = useState<{ key: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(loadError);
  const [notice, setNotice] = useState<string | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const localized = course?.localized ?? emptyLocalizedCourse();
  const currentLocale = localized[locale];

  const titlePreview = useMemo(() => (course ? courseDisplayTitle(course) : "课程编辑"), [course]);

  if (!course) {
    return (
      <div className="space-y-4">
        <PageHeader title="课程编辑" description={`${siteLabel} · ${databaseLabel}`} />
        <ErrorBanner message={error ?? "课程不存在或加载失败。"} />
        <Button variant="outline" asChild>
          <Link href="/courses">
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
    setCourse((current) => (current ? { ...current, videos: reindexVideos(next) } : current));
  }

  async function handleCoverUpload(file: File | null) {
    if (!file) return;
    setUploading("cover");
    setUploadError(null);
    try {
      const path = await uploadCoverFile(file);
      patchLocale({ coverUrl: path });
    } catch (err) {
      setUploadError({
        key: "cover",
        message: err instanceof Error ? err.message : "文件上传失败",
      });
    } finally {
      setUploading(null);
    }
  }

  async function handleVideoFileUpload(index: number, file: File | null) {
    if (!file) return;
    const key = `video-${index}`;
    setUploading(key);
    setVideoUploadPercent(0);
    setUploadError(null);
    try {
      const path = await uploadCourseVideoDirect(file, setVideoUploadPercent);
      setCourse((current) => {
        if (!current) return current;
        const videos = current.videos.map((video, i) =>
          i === index ? { ...video, videoKey: path } : video
        );
        return { ...current, videos };
      });
    } catch (err) {
      setUploadError({
        key,
        message: err instanceof Error ? err.message : "文件上传失败",
      });
    } finally {
      setUploading(null);
      setVideoUploadPercent(null);
    }
  }

  async function handleVideoCoverUpload(index: number, file: File | null) {
    if (!file) return;
    const key = `video-cover-${index}`;
    setUploading(key);
    setUploadError(null);
    try {
      const path = await uploadCoverFile(file);
      setCourse((current) => {
        if (!current) return current;
        const videos = current.videos.map((video, i) =>
          i === index ? { ...video, coverUrl: path } : video
        );
        return { ...current, videos };
      });
    } catch (err) {
      setUploadError({
        key,
        message: err instanceof Error ? err.message : "文件上传失败",
      });
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    if (!course) return;
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
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/courses/${course.id}`, {
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
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `保存失败：${response.status}`);
      setNotice("已保存（未改变上架状态）。");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish() {
    if (!course) return;
    if (!course.published && !hasAnyCourseTitle(course.localized)) {
      setError("发布前请至少填写一种语言的课程名称，并先保存。");
      return;
    }
    setPublishing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/courses/${course.id}/publish`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: !course.published }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `操作失败：${response.status}`);
      setCourse({ ...course, published: !course.published });
      setNotice(course.published ? "已下架。" : "已发布上架。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新发布状态失败。");
    } finally {
      setPublishing(false);
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
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {course.published ? (
              <StatusPill tone="success">已上架</StatusPill>
            ) : (
              <StatusPill tone="muted">未上架</StatusPill>
            )}
            <Button variant="outline" asChild>
              <Link href="/courses">
                <IconArrowLeft className="size-4" />
                返回
              </Link>
            </Button>
            <Button
              variant="outline"
              disabled={publishing || saving}
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
            <Button disabled={saving || publishing} onClick={() => void save()}>
              {saving ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconDeviceFloppy className="size-4" />
              )}
              保存
            </Button>
          </div>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      <section className="space-y-4 rounded-xl border border-slate-200 border-l-4 border-l-slate-800 bg-white p-4 shadow-sm">
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
                      onChange={(event) => void handleCoverUpload(event.target.files?.[0] ?? null)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      asChild
                      disabled={uploading === "cover"}
                    >
                      <span>
                        {uploading === "cover" ? (
                          <IconLoader2 className="size-4 animate-spin" />
                        ) : (
                          <IconUpload className="size-4" />
                        )}
                        上传
                      </span>
                    </Button>
                  </label>
                </div>
                {uploadError?.key === "cover" ? (
                  <p className="text-[12px] text-red-600">{uploadError.message}</p>
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
      </section>

      <section className="space-y-4 rounded-xl border border-indigo-100 border-l-4 border-l-indigo-500 bg-indigo-50/30 p-4 shadow-sm">
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
            {course.videos.map((video, index) => (
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
                                void handleVideoFileUpload(index, selected);
                              }}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              asChild
                              disabled={uploading === `video-${index}`}
                            >
                              <span>
                                {uploading === `video-${index}` ? (
                                  <IconLoader2 className="size-4 animate-spin" />
                                ) : (
                                  <IconUpload className="size-4" />
                                )}
                                {uploading === `video-${index}` && videoUploadPercent != null
                                  ? `${videoUploadPercent}%`
                                  : "上传"}
                              </span>
                            </Button>
                          </label>
                        </div>
                        {uploading === `video-${index}` && videoUploadPercent != null ? (
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-slate-800 transition-[width] duration-150"
                              style={{ width: `${videoUploadPercent}%` }}
                            />
                          </div>
                        ) : null}
                        {uploadError?.key === `video-${index}` ? (
                          <p className="text-[12px] text-red-600">{uploadError.message}</p>
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
                              onChange={(event) =>
                                void handleVideoCoverUpload(index, event.target.files?.[0] ?? null)
                              }
                            />
                            <Button
                              type="button"
                              variant="outline"
                              asChild
                              disabled={uploading === `video-cover-${index}`}
                            >
                              <span>
                                {uploading === `video-cover-${index}` ? (
                                  <IconLoader2 className="size-4 animate-spin" />
                                ) : (
                                  <IconUpload className="size-4" />
                                )}
                                上传
                              </span>
                            </Button>
                          </label>
                        </div>
                        {uploadError?.key === `video-cover-${index}` ? (
                          <p className="text-[12px] text-red-600">{uploadError.message}</p>
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
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <InstructorPicker
          instructors={course.instructors}
          onChange={(instructors) => setCourse({ ...course, instructors })}
        />
      </section>
    </div>
  );
}
