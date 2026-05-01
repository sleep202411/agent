"use client";

import { useEffect, useRef, useState } from "react";
import { IconUpload, IconLoader2, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { VideoPlayer } from "@/components/media/video-player";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { uploadEpisodeCover, uploadEpisodeVideo } from "@/app/(site)/ips/_hooks/uploads";
import { useEpisodeVideoLink } from "@/app/(site)/ips/_hooks/use-ip";

// Episode-specific Van Gogh artwork on the static CDN.
const EPISODE_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 21_22_58.png"
);

// Sample fixtures used as default values when creating a NEW episode so
// QA can save end-to-end without having to upload anything. Editing an
// existing episode keeps its real values. Drop these once the upload
// flow is verified end-to-end on staging.
const SAMPLE_VIDEO_URL = encodeURI("https://static.fizzspace.cn/static/pc/1777541432954.mp4");
const SAMPLE_COVER_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月30日 10_30_15.png"
);

export interface EpisodeDraft {
  title: string;
  description: string;
  /** Wire-format string — what the backend persists as `videoLink`. For
   *  newly-uploaded files this is the OSS object key returned by the
   *  signed-upload pipeline. For existing episodes loaded for edit, this
   *  is the opaque value pulled off the list response and round-tripped
   *  unchanged so non-video edits don't null the attachment. */
  videoLink: string;
  /** Display-only playable URL (blob: while uploading, full URL fetched
   *  via `useEpisodeVideoLink` when editing existing episodes, or the
   *  sample fixture URL). Never sent to the backend — `videoLink` is. */
  videoUrl: string;
  /** Wire-format OSS object key — sent on save as `videoBanner`. */
  videoBanner: string;
  /** Display-only image URL for the `<img>` preview (blob: during upload,
   *  `ipImageUrl(videoBanner)` for existing episodes, or sample URL).
   *  Never sent to the backend. */
  coverUrl: string;
  /** Seconds. Probed off the local blob or remote URL. */
  duration: number;
  /** Pixels. Filled from the same probe. */
  width: number;
  height: number;
  /** Bytes. Only known when the user uploads a File (`File.size`). */
  size: number;
}

const EMPTY_DRAFT: EpisodeDraft = {
  title: "",
  description: "",
  videoLink: SAMPLE_VIDEO_URL,
  videoUrl: SAMPLE_VIDEO_URL,
  videoBanner: SAMPLE_COVER_URL,
  coverUrl: SAMPLE_COVER_URL,
  duration: 0,
  width: 0,
  height: 0,
  size: 0,
};

interface EpisodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: EpisodeDraft | null;
  index: number | null; // -1 = creating; >=0 = editing
  /** Project id — required by the presigned-URL endpoint. */
  projectId: string;
  /** Episode id for edit mode — used to resolve the playable URL via
   *  `/vedio/play/getLink`, and passed as `videoId` to the upload
   *  endpoint when re-uploading an existing episode's source. Undefined
   *  for create. */
  episodeId?: string;
  /**
   * Resolve to close the dialog; reject (or throw) to keep it open and
   * surface the error message inline. Mirrors react-query's
   * `mutateAsync` semantics so the parent can pass it through directly.
   */
  onSubmit: (draft: EpisodeDraft) => Promise<void>;
}

// Browser-side metadata probe: loads a <video> off-DOM to read duration +
// dimensions + first-frame thumbnail. Works for direct video files (mp4/webm)
// when CORS allows. For platform links (YouTube/Bilibili) backend yt-dlp is
// the right call — TODO once Nest endpoint exists.
async function probeVideo(src: string): Promise<{
  duration: number;
  width: number;
  height: number;
  cover: string;
} | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.src = src;

    let settled = false;
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };
    const finish = (
      result: { duration: number; width: number; height: number; cover: string } | null
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      const duration = Math.round(video.duration || 0);
      const width = video.videoWidth;
      const height = video.videoHeight;
      // Try to grab a frame at 1s for cover; fall back to 0 if too short.
      const seekTo = duration > 1 ? 1 : 0;
      video.currentTime = seekTo;
      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            finish({ duration, width, height, cover: "" });
            return;
          }
          ctx.drawImage(video, 0, 0, width, height);
          // toDataURL throws if canvas is tainted (cross-origin without CORS).
          let cover = "";
          try {
            cover = canvas.toDataURL("image/jpeg", 0.7);
          } catch {
            cover = "";
          }
          finish({ duration, width, height, cover });
        } catch {
          finish({ duration, width, height, cover: "" });
        }
      };
    };

    // Hard timeout — some sources stall forever.
    setTimeout(() => finish(null), 8000);
  });
}

export function EpisodeDialog({
  open,
  onOpenChange,
  initial,
  index,
  projectId,
  episodeId,
  onSubmit,
}: EpisodeDialogProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const [draft, setDraft] = useState<EpisodeDraft>(EMPTY_DRAFT);
  const [probing, setProbing] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [videoDragOver, setVideoDragOver] = useState(false);
  const [coverDragOver, setCoverDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const fileObjectUrlRef = useRef<string>("");
  const coverObjectUrlRef = useRef<string>("");

  useEffect(() => {
    if (open) {
      setDraft(initial ?? EMPTY_DRAFT);
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [open, initial]);

  // For edit mode, resolve the playable URL via `/vedio/play/getLink`
  // (the wire `videoLink` is an internal OSS key, not directly playable).
  // Skip when the user has already uploaded a new file (blob: URL takes
  // precedence) or when there's nothing to play yet.
  const wantsPlayLink = open && !!episodeId && !draft.videoUrl && !!draft.videoLink;
  const playLinkQuery = useEpisodeVideoLink(episodeId ?? "", wantsPlayLink);
  useEffect(() => {
    if (!wantsPlayLink) return;
    const url = playLinkQuery.data;
    if (!url) return;
    setDraft((d) => (d.videoUrl ? d : { ...d, videoUrl: url }));
  }, [wantsPlayLink, playLinkQuery.data]);

  // Probe duration for any pre-filled videoUrl that didn't go through
  // `handleVideoFile` (the SAMPLE_VIDEO_URL fixture, or an existing
  // episode being edited that the backend stored without metadata).
  useEffect(() => {
    if (!open) return;
    if (!draft.videoUrl || draft.duration > 0) return;
    let cancelled = false;
    void probeVideo(draft.videoUrl).then((meta) => {
      if (cancelled || !meta) return;
      setDraft((d) =>
        d.duration > 0
          ? d
          : {
              ...d,
              duration: meta.duration,
              width: d.width || meta.width,
              height: d.height || meta.height,
              // Probe gives a data: URL — display-only hint until the
              // user uploads a real cover (videoBanner stays empty).
              coverUrl: d.coverUrl || meta.cover,
            }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, draft.videoUrl, draft.duration]);

  // Revoke any object URLs we created when dialog closes.
  useEffect(() => {
    return () => {
      if (fileObjectUrlRef.current) URL.revokeObjectURL(fileObjectUrlRef.current);
      if (coverObjectUrlRef.current) URL.revokeObjectURL(coverObjectUrlRef.current);
    };
  }, []);

  const update = (patch: Partial<EpisodeDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    // User edited something — clear any stale submit error so they don't
    // see it lingering after they correct the issue.
    if (submitError) setSubmitError(null);
  };

  const probeAndApply = async (src: string) => {
    setProbing(true);
    const meta = await probeVideo(src);
    setProbing(false);
    if (!meta) {
      toast.warning(t("epProbeFailed"));
      return;
    }
    setDraft((d) => ({
      ...d,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      // Probe gives a data: URL — display-only hint, doesn't populate videoBanner.
      coverUrl: d.coverUrl || meta.cover,
    }));
  };

  const handleVideoFile = async (file: File) => {
    if (!file.type.startsWith("video/")) {
      toast.error(t("epFileNotVideo"));
      return;
    }
    if (file.size > 2 * 1024 * 1024 * 1024) {
      toast.error(t("epFileTooLarge"));
      return;
    }
    // Probe metadata + grab a thumbnail off the local blob first so the UI
    // updates immediately. The blob URL stays in `videoUrl` (display) for
    // the lifetime of the dialog, even after upload completes — `videoLink`
    // (wire) is what swaps to the OSS object key.
    if (fileObjectUrlRef.current) URL.revokeObjectURL(fileObjectUrlRef.current);
    const localUrl = URL.createObjectURL(file);
    fileObjectUrlRef.current = localUrl;
    update({ videoUrl: localUrl, videoLink: "", size: file.size });
    void probeAndApply(localUrl);

    setUploadingVideo(true);
    try {
      const uploaded = await uploadEpisodeVideo(file, { projectId, videoId: episodeId });
      update({ videoLink: uploaded.path });
      toast.success(tc("uploadSuccess"));
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : tc("uploadFailed"));
    } finally {
      setUploadingVideo(false);
    }
  };

  const handleCoverFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t("epCoverNotImage"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("epCoverTooLarge"));
      return;
    }
    if (coverObjectUrlRef.current) URL.revokeObjectURL(coverObjectUrlRef.current);
    const localUrl = URL.createObjectURL(file);
    coverObjectUrlRef.current = localUrl;
    update({ coverUrl: localUrl, videoBanner: "" });

    setUploadingCover(true);
    try {
      const uploaded = await uploadEpisodeCover(file);
      // Persist the OSS path; UI keeps using the blob preview until then.
      update({ videoBanner: uploaded.path });
      toast.success(tc("uploadSuccess"));
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : tc("uploadFailed"));
    } finally {
      setUploadingCover(false);
    }
  };

  const handleSave = async () => {
    if (uploadingVideo || uploadingCover) {
      toast.warning(tc("uploading"));
      return;
    }
    if (!draft.title.trim()) {
      toast.warning(t("epTitleRequired"));
      return;
    }
    if (!draft.description.trim()) {
      toast.warning(t("epDescriptionRequired"));
      return;
    }
    if (!draft.videoLink.trim()) {
      toast.warning(t("epVideoRequired"));
      return;
    }
    if (!draft.videoBanner.trim()) {
      toast.warning(t("epCoverRequired"));
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        ...draft,
        title: draft.title.trim(),
        description: draft.description.trim(),
        videoLink: draft.videoLink.trim(),
      });
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error && err.message ? err.message : tc("saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const isEditing = index !== null && index >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={EPISODE_HERO_URL}
          eyebrow={t("epHeroEyebrow")}
          title={isEditing ? t("epDialogTitleEdit") : t("epDialogTitleNew")}
          description={t("epHeroSubtitle")}
        />

        <DialogBody className="py-4">
          {/* Title */}
          <Field>
            <FieldLabel>
              {t("epTitleLabel")} <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder={t("epTitlePlaceholder")}
            />
            <FieldDescription>{t("epTitleHelp")}</FieldDescription>
          </Field>

          {/* Description */}
          <Field>
            <FieldLabel>
              {t("epDescriptionLabel")} <span className="text-destructive">*</span>
            </FieldLabel>
            <Textarea
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder={t("epDescriptionPlaceholder")}
              rows={3}
            />
            <FieldDescription>{t("epDescriptionHelp")}</FieldDescription>
          </Field>

          {/* Video + cover side-by-side */}
          <div className="grid grid-cols-2 gap-3">
            {/* Video */}
            <Field>
              <FieldLabel>
                {t("epVideoLabel")} <span className="text-destructive">*</span>
              </FieldLabel>
              {draft.videoUrl ? (
                <div className="relative aspect-video overflow-hidden rounded-lg bg-muted/50">
                  <VideoPlayer
                    key={draft.videoUrl}
                    src={draft.videoUrl}
                    autoplay={false}
                    className={cn(
                      "size-full",
                      "[&_.video-js]:size-full",
                      // Shrink the default video.js big play button (3em / 1.5em is huge for a preview).
                      "[&_.vjs-big-play-button]:size-10!",
                      "[&_.vjs-big-play-button]:-mt-5! [&_.vjs-big-play-button]:-ml-5!",
                      "[&_.vjs-big-play-button]:rounded-full!",
                      "[&_.vjs-big-play-button]:border-0!",
                      "[&_.vjs-big-play-button]:bg-black/60!",
                      "[&_.vjs-big-play-button]:text-base! [&_.vjs-big-play-button]:leading-10!",
                      // Hide the picture-in-picture button.
                      "[&_.vjs-picture-in-picture-control]:hidden!"
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => update({ videoUrl: "", videoLink: "", duration: 0 })}
                    className="absolute right-1.5 top-1.5 z-10 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <IconX className="size-3.5" />
                  </button>
                  {draft.duration > 0 && (
                    <span className="absolute left-1.5 top-1.5 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {formatDuration(draft.duration)}
                    </span>
                  )}
                </div>
              ) : draft.videoLink ? (
                <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/40 text-muted-foreground">
                  <IconLoader2 className="size-5 animate-spin" />
                  <span className="text-[11px]">{t("epLoadingPreview")}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setVideoDragOver(true);
                  }}
                  onDragLeave={() => setVideoDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setVideoDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleVideoFile(file);
                  }}
                  className={cn(
                    "flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-card/40 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-card/60",
                    videoDragOver && "border-primary/60 bg-primary/5 text-primary"
                  )}
                >
                  {uploadingVideo || probing ? (
                    <>
                      <IconLoader2 className="size-5 animate-spin" />
                      <span className="text-[11px]">
                        {uploadingVideo ? tc("uploading") : t("epProbing")}
                      </span>
                    </>
                  ) : (
                    <>
                      <IconUpload className="size-5" />
                      <span className="text-[11px] font-medium">{t("epVideoDropzoneTitle")}</span>
                      <span className="text-[10px] text-muted-foreground/70">
                        {t("epDropzoneHint")}
                      </span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleVideoFile(file);
                  e.target.value = "";
                }}
              />
              <FieldDescription>{t("epVideoHelp")}</FieldDescription>
            </Field>

            {/* Cover */}
            <Field>
              <FieldLabel>
                {t("epCoverLabel")} <span className="text-destructive">*</span>
              </FieldLabel>
              {draft.coverUrl ? (
                <div className="relative aspect-video overflow-hidden rounded-lg bg-muted/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={draft.coverUrl} alt="" className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => update({ coverUrl: "", videoBanner: "" })}
                    className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <IconX className="size-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setCoverDragOver(true);
                  }}
                  onDragLeave={() => setCoverDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setCoverDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleCoverFile(file);
                  }}
                  className={cn(
                    "flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-card/40 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-card/60",
                    coverDragOver && "border-primary/60 bg-primary/5 text-primary"
                  )}
                >
                  {uploadingCover ? (
                    <>
                      <IconLoader2 className="size-5 animate-spin" />
                      <span className="text-[11px]">{tc("uploading")}</span>
                    </>
                  ) : (
                    <>
                      <IconUpload className="size-5" />
                      <span className="text-[11px] font-medium">{t("epCoverDropzoneTitle")}</span>
                      <span className="text-[10px] text-muted-foreground/70">
                        {t("epCoverHint")}
                      </span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCoverFile(file);
                  e.target.value = "";
                }}
              />
              <FieldDescription>{t("epCoverHelp")}</FieldDescription>
            </Field>
          </div>
        </DialogBody>

        <DialogFooter className="sm:items-center">
          {submitError && (
            <p className="mr-auto text-xs text-destructive sm:max-w-[60%]">{submitError}</p>
          )}
          <Button
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {tc("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={uploadingVideo || uploadingCover || submitting}>
            {submitting ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
