"use client";

/**
 * Lightweight personal-work playback dialog.
 *
 * Behaviour:
 *   - On open, POST `/vedio/play/personal/getLink { id }` for a signed
 *     OSS URL (videoLink on the work record is just the bucket key —
 *     the bucket is private, so direct construction won't play).
 *   - If a signed URL comes back, render an autoplay <video controls>.
 *   - If the record has no videoLink at all (rare; mostly older imports
 *     that only have a banner), fall back to showing the banner image.
 *   - Title + introduction render below the media so visitors get
 *     context without leaving the Creator Center.
 *
 * Owner-side editing is intentionally out of scope here — clicking a
 * card from the owner's own profile still opens this read-only modal.
 * Re-editing existing personal videos happens via `/publish` (a
 * separate wizard) and can be wired in later if the team needs an
 * inline edit affordance.
 */
import { useEffect, useState } from "react";
import { IconLoader2, IconPhoto } from "@tabler/icons-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTranslations } from "@/src/i18n/i18n";
import { env } from "@/src/env";
import { getPersonalVideoLink } from "@/src/services/project";
import type { PersonalWork } from "@/src/services/project";

interface WorkPlayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  work: PersonalWork | null;
}

export function WorkPlayDialog({ open, onOpenChange, work }: WorkPlayDialogProps) {
  const t = useTranslations("creatorCenter");
  const [signedUrl, setSignedUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Fetch a fresh signed URL each open. Don't cache — Java's signed
  // URLs have a short TTL and reusing a stale one fails silently.
  useEffect(() => {
    if (!open || !work?.id) {
      setSignedUrl("");
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    getPersonalVideoLink(work.id)
      .then((url) => {
        if (cancelled) return;
        setSignedUrl(typeof url === "string" ? url : "");
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, work?.id]);

  if (!work) return null;

  const title = String(work.title ?? "").trim() || "—";
  const intro = String(work.introduction ?? "").trim();
  const bannerKey = String(work.videoBanner ?? "").trim();
  const bannerUrl = bannerKey
    ? bannerKey.startsWith("http")
      ? bannerKey
      : `${env.BANNER_BASE_URL.replace(/\/+$/, "")}/${bannerKey.replace(/^\/+/, "")}`
    : "";

  const showVideo = !!signedUrl && !error;
  const showBanner = !signedUrl && !loading && !!bannerUrl;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-0 p-0">
        <DialogHeader className="px-5 pb-0 pt-5">
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <div className="relative mt-3 aspect-video w-full overflow-hidden bg-black">
          {loading ? (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <IconLoader2 className="size-6 animate-spin" />
            </div>
          ) : showVideo ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={signedUrl}
              controls
              autoPlay
              playsInline
              className="size-full object-contain"
            />
          ) : showBanner ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bannerUrl} alt={title} className="size-full object-contain" />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground/60">
              <IconPhoto className="size-8" />
              <p className="text-xs">{error ? t("works.playFailed") : t("works.noMedia")}</p>
            </div>
          )}
        </div>
        {intro ? (
          <div className="max-h-40 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-muted-foreground">
            {intro}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
