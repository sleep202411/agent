"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { IconCloudUpload, IconLoader2, IconRefresh, IconVideo } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";

interface Props {
  videoUrl: string | undefined;
  uploading: boolean;
  onPickVideo: (file: File) => void;
  onPickCover: (file: File) => void;
  coverUploading: boolean;
}

const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function VideoUploadStep({
  videoUrl,
  uploading,
  onPickVideo,
  onPickCover,
  coverUploading,
}: Props) {
  const t = useTranslations("publishVideo");
  const videoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const pickVideo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error(t("uploadFailed"));
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      toast.error(t("uploadFailed"));
      return;
    }
    onPickVideo(file);
  };

  const pickCover = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(t("uploadFailed"));
      return;
    }
    onPickCover(file);
  };

  return (
    <div className="space-y-8">
      {/* Cover first, video second — matches the legacy
       *  fizzdragon-web personal-video flow (commit d9d91b4) so users
       *  set the poster image before uploading the (long) video. The
       *  team-project flow over there still does video → cover, but
       *  this wizard is personal-only. */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t("uploadVideoCover")}</h3>
        <button
          type="button"
          onClick={() => coverInputRef.current?.click()}
          disabled={coverUploading}
          className={cn(
            "flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary/30 transition-colors",
            coverUploading ? "cursor-wait" : "hover:border-primary/50 hover:bg-secondary/50"
          )}
        >
          {coverUploading ? (
            <IconLoader2 className="size-6 animate-spin text-primary" />
          ) : (
            <>
              <IconVideo className="size-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("uploadImageFormat")}</p>
            </>
          )}
        </button>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={pickCover}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t("uploadVideo")}</h3>

        {videoUrl ? (
          <div className="space-y-3">
            <video
              src={videoUrl}
              controls
              className="aspect-video w-full overflow-hidden rounded-xl bg-black"
            />
            <Button
              variant="outline"
              onClick={() => videoInputRef.current?.click()}
              disabled={uploading}
            >
              <IconRefresh className="size-4" />
              {t("replaceVideo")}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            disabled={uploading}
            className={cn(
              "flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-secondary/30 transition-colors",
              uploading ? "cursor-wait" : "hover:border-primary/50 hover:bg-secondary/50"
            )}
          >
            {uploading ? (
              <>
                <IconLoader2 className="size-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">{t("uploading")}</p>
              </>
            ) : (
              <>
                <IconCloudUpload className="size-10 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">{t("uploadVideoFile")}</p>
              </>
            )}
          </button>
        )}
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={pickVideo}
        />
      </section>
    </div>
  );
}
