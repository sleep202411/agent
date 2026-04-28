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
import { Field, FieldLabel } from "@/components/ui/field";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";

// Episode-specific Van Gogh artwork on the static CDN.
const EPISODE_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 21_22_58.png"
);

export interface EpisodeDraft {
  title: string;
  description: string;
  type: "linear" | "interactive";
  videoUrl: string;
  cover: string;
  duration: number;
}

const EMPTY_DRAFT: EpisodeDraft = {
  title: "",
  description: "",
  type: "linear",
  videoUrl: "",
  cover: "",
  duration: 0,
};

interface EpisodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: EpisodeDraft | null;
  index: number | null; // -1 = creating; >=0 = editing
  onSubmit: (draft: EpisodeDraft) => void;
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
  onSubmit,
}: EpisodeDialogProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const [draft, setDraft] = useState<EpisodeDraft>(EMPTY_DRAFT);
  const [probing, setProbing] = useState(false);
  const [videoDragOver, setVideoDragOver] = useState(false);
  const [coverDragOver, setCoverDragOver] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const fileObjectUrlRef = useRef<string>("");
  const coverObjectUrlRef = useRef<string>("");

  useEffect(() => {
    if (open) setDraft(initial ?? EMPTY_DRAFT);
  }, [open, initial]);

  // Revoke any object URLs we created when dialog closes.
  useEffect(() => {
    return () => {
      if (fileObjectUrlRef.current) URL.revokeObjectURL(fileObjectUrlRef.current);
      if (coverObjectUrlRef.current) URL.revokeObjectURL(coverObjectUrlRef.current);
    };
  }, []);

  const update = (patch: Partial<EpisodeDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const probeAndApply = async (src: string, applyVideoUrl?: string) => {
    setProbing(true);
    const meta = await probeVideo(src);
    setProbing(false);
    if (!meta) {
      toast.warning(t("epProbeFailed"));
      if (applyVideoUrl !== undefined) update({ videoUrl: applyVideoUrl });
      return;
    }
    update({
      videoUrl: applyVideoUrl ?? draft.videoUrl,
      duration: meta.duration,
      cover: meta.cover || draft.cover,
    });
  };

  const handleVideoFile = (file: File) => {
    if (!file.type.startsWith("video/")) {
      toast.error(t("epFileNotVideo"));
      return;
    }
    if (file.size > 2 * 1024 * 1024 * 1024) {
      toast.error(t("epFileTooLarge"));
      return;
    }
    if (fileObjectUrlRef.current) URL.revokeObjectURL(fileObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    fileObjectUrlRef.current = url;
    // TODO: kick off STS direct upload to OSS here. For now we keep the
    // local object URL so metadata probe + preview work; the saved record
    // will need a real OSS URL before going to backend.
    void probeAndApply(url, url);
  };

  const handleCoverFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t("epCoverNotImage"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("epCoverTooLarge"));
      return;
    }
    if (coverObjectUrlRef.current) URL.revokeObjectURL(coverObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    coverObjectUrlRef.current = url;
    // TODO: upload cover image to OSS once endpoint exists; for now use the
    // local object URL for preview.
    update({ cover: url });
  };

  const handleSave = () => {
    if (!draft.title.trim()) {
      toast.warning(t("epTitleRequired"));
      return;
    }
    if (!draft.description.trim()) {
      toast.warning(t("epDescriptionRequired"));
      return;
    }
    if (!draft.videoUrl.trim()) {
      toast.warning(t("epVideoRequired"));
      return;
    }
    if (!draft.cover.trim()) {
      toast.warning(t("epCoverRequired"));
      return;
    }
    onSubmit({
      ...draft,
      title: draft.title.trim(),
      description: draft.description.trim(),
      videoUrl: draft.videoUrl.trim(),
    });
    onOpenChange(false);
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
                  {draft.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={draft.cover} alt="" className="size-full object-cover opacity-80" />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <IconUpload className="size-6 text-muted-foreground/40" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => update({ videoUrl: "", duration: 0 })}
                    className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <IconX className="size-3.5" />
                  </button>
                  {draft.duration > 0 && (
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {formatDuration(draft.duration)}
                    </span>
                  )}
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
                  {probing ? (
                    <>
                      <IconLoader2 className="size-5 animate-spin" />
                      <span className="text-[11px]">{t("epProbing")}</span>
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
            </Field>

            {/* Cover */}
            <Field>
              <FieldLabel>
                {t("epCoverLabel")} <span className="text-destructive">*</span>
              </FieldLabel>
              {draft.cover ? (
                <div className="relative aspect-video overflow-hidden rounded-lg bg-muted/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={draft.cover} alt="" className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => update({ cover: "" })}
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
                  <IconUpload className="size-5" />
                  <span className="text-[11px] font-medium">{t("epCoverDropzoneTitle")}</span>
                  <span className="text-[10px] text-muted-foreground/70">{t("epCoverHint")}</span>
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
            </Field>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleSave}>{tc("save")}</Button>
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
