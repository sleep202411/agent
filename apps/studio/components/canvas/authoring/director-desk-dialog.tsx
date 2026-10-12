"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSiteRegion } from "@/app/_components/region-provider";
import { IconCamera, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DIRECTOR_DESK_READY,
  DIRECTOR_DESK_STAGING_READY,
  directorDeskSrc,
  isDirectorDeskOrigin,
} from "@/lib/canvas-authoring/director-desk-import";

export function DirectorDeskDialog({
  open,
  projectId,
  busy = false,
  onCapture,
  onOpenChange,
}: {
  open: boolean;
  projectId: string;
  busy?: boolean;
  onCapture?: (frame: Window | null | undefined) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("canvasNodes.asset.directorDesk");
  const region = useSiteRegion();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (!isDirectorDeskOrigin(event.origin)) return;
      if (
        event.data?.type === DIRECTOR_DESK_READY ||
        event.data?.type === DIRECTOR_DESK_STAGING_READY
      ) {
        setReady(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        onInteractOutside={(event) => event.preventDefault()}
        className="flex h-[min(88dvh,860px)] w-[min(1280px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl bg-[oklch(0.18_0_0)] p-0 shadow-[0_28px_90px_rgba(0,0,0,0.68)] sm:max-w-none"
      >
        <DialogHeader className="flex-row items-center gap-3 border-b border-white/[0.06] px-5 py-3 pr-14">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("description")}</DialogDescription>
          <Button
            type="button"
            variant="primary-cta"
            size="lg"
            disabled={!ready || busy}
            data-loading={busy || undefined}
            className="ml-auto"
            onClick={() => onCapture?.(frameRef.current?.contentWindow)}
          >
            {busy ? (
              <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
            ) : (
              <IconCamera className="size-4" stroke={1.8} />
            )}
            {busy ? t("capturing") : t("capture")}
          </Button>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 bg-black">
          {open ? (
            <iframe
              ref={frameRef}
              title={t("title")}
              src={directorDeskSrc(projectId, window.location.origin, region)}
              allow="camera; microphone; fullscreen"
              allowFullScreen
              className="size-full border-0"
              onLoad={() => setReady(true)}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
