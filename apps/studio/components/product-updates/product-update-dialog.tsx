"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconArrowRight, IconVolume, IconVolumeOff, IconX } from "@tabler/icons-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ProductUpdateMedia {
  alt: string;
  poster?: string;
  src: string;
  type: "image" | "video";
}

export interface ProductUpdateDialogProps {
  /** Stable release identifier. Changing it presents the update again. */
  announcementId: string;
  title: string;
  description: ReactNode;
  supportingText?: ReactNode;
  ctaLabel: string;
  closeLabel: string;
  muteLabel: string;
  unmuteLabel: string;
  media: ProductUpdateMedia;
  onCta: () => void;
  /** Useful for review links and deterministic browser tests. */
  forceOpen?: boolean;
  /** Optional query parameter whose value can match `announcementId` for review. */
  previewQueryParam?: string;
  storageNamespace?: string;
}

export function ProductUpdateDialog({
  announcementId,
  title,
  description,
  supportingText,
  ctaLabel,
  closeLabel,
  muteLabel,
  unmuteLabel,
  media,
  onCta,
  forceOpen = false,
  previewQueryParam,
  storageNamespace = "fizzdragon:product-update",
}: ProductUpdateDialogProps) {
  const storageKey = `${storageNamespace}:${announcementId}`;
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (forceOpen) return;
    const frame = requestAnimationFrame(() => {
      try {
        const isPreview = previewQueryParam
          ? new URLSearchParams(window.location.search).get(previewQueryParam) === announcementId
          : false;
        setOpen(isPreview || window.localStorage.getItem(storageKey) !== "seen");
      } catch {
        setOpen(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [announcementId, forceOpen, previewQueryParam, storageKey]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(storageKey, "seen");
    } catch {
      // Storage can be blocked by privacy settings. Dismissing still works for
      // the current page; the next session may present the update again.
    }
    setOpen(false);
  };

  return (
    <Dialog
      open={forceOpen || open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent
        ref={contentRef}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => contentRef.current?.focus());
        }}
        showCloseButton={false}
        overlayClassName="bg-[#05050A]/82 backdrop-blur-[10px]"
        className="w-[min(440px,calc(100vw-28px))] max-w-none gap-0 overflow-hidden rounded-[22px] border border-white/[0.11] bg-[#0e0b13] p-0 shadow-[0_4px_32px_rgba(0,0,0,0.4),0_0_80px_rgba(0,0,0,0.42),inset_0_0.5px_0_rgba(255,255,255,0.06)] sm:max-w-[440px]"
      >
        <div className="relative m-2 mb-0 aspect-[16/9] overflow-hidden rounded-[18px] bg-black">
          {media.type === "video" ? (
            <video
              src={media.src}
              poster={media.poster}
              aria-label={media.alt}
              autoPlay
              loop
              muted={muted}
              playsInline
              preload="metadata"
              className="size-full object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media.src} alt={media.alt} className="size-full object-cover" />
          )}

          <button
            type="button"
            aria-label={closeLabel}
            onClick={dismiss}
            className="absolute top-2 right-2 grid size-9 place-items-center rounded-full bg-black/72 text-white/90 backdrop-blur-md transition-colors hover:bg-black/90 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            <IconX className="size-[18px]" stroke={1.8} />
          </button>

          {media.type === "video" ? (
            <button
              type="button"
              aria-label={muted ? unmuteLabel : muteLabel}
              onClick={() => setMuted((current) => !current)}
              className="absolute right-2 bottom-2 grid size-9 place-items-center rounded-xl bg-black/62 text-white/82 backdrop-blur-md transition-colors hover:bg-black/82 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
            >
              {muted ? (
                <IconVolumeOff className="size-[17px]" stroke={1.8} />
              ) : (
                <IconVolume className="size-[17px]" stroke={1.8} />
              )}
            </button>
          ) : null}
        </div>

        <div className="px-6 pt-6 pb-6">
          <DialogTitle className="text-[24px] leading-[1.15] font-medium tracking-[-0.02em] text-white">
            {title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="mt-2 min-h-[63px] text-[13.5px] leading-[1.55] text-white/65">
              {description}
            </div>
          </DialogDescription>
          {supportingText ? (
            <div className="mt-3 text-[13.5px] leading-[1.55] text-white/50">{supportingText}</div>
          ) : null}

          <button
            type="button"
            onClick={() => {
              dismiss();
              onCta();
            }}
            className={cn(
              "mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-white px-4",
              "text-[13px] font-medium tracking-[0.01em] text-[#111118] transition-colors",
              "hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0b13] focus-visible:outline-none"
            )}
          >
            {ctaLabel}
            <IconArrowRight className="size-4" stroke={1.8} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
