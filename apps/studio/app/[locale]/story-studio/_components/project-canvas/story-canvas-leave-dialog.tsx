"use client";

import { IconAlertTriangle, IconCheck, IconDownload } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StoryCanvasRecoveryPlane } from "./story-canvas-leave-guard";

export function StoryCanvasLeaveDialog({
  open,
  planes,
  recoveryExported,
  onStay,
  onExport,
  onDiscardAndLeave,
}: {
  open: boolean;
  planes: readonly StoryCanvasRecoveryPlane[];
  recoveryExported: boolean;
  onStay: () => void;
  onExport: () => void;
  onDiscardAndLeave: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.leaveGuard");

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onStay()}>
      <DialogContent
        className="rounded-[22px] bg-[oklch(0.205_0_0/0.98)] p-5 text-white shadow-[0_32px_100px_rgba(0,0,0,0.72)] sm:max-w-lg"
        onEscapeKeyDown={onStay}
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-[-0.01em] text-white">
            <IconAlertTriangle className="size-4 text-destructive" stroke={1.8} />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="max-w-[48ch] text-xs leading-5 text-white/48">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 rounded-2xl bg-white/[0.045] p-2">
          {planes.map((plane) => (
            <div
              key={plane}
              className="flex items-start gap-3 rounded-xl bg-white/[0.035] px-3 py-2.5"
            >
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-white/46" />
              <div>
                <p className="text-xs font-medium text-white/76">{t(`planes.${plane}.title`)}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-white/38">
                  {t(`planes.${plane}.description`)}
                </p>
              </div>
            </div>
          ))}
        </div>

        {recoveryExported ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-xl bg-white/[0.045] px-3 py-2 text-[11px] text-white/58"
          >
            <IconCheck className="size-3.5" stroke={1.9} />
            {t("exported")}
          </p>
        ) : null}

        <DialogFooter className="mt-1 sm:justify-between">
          <Button type="button" variant="ghost" size="xl" onClick={onStay}>
            {t("stay")}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="secondary" size="xl" onClick={onExport}>
              <IconDownload className="size-4" />
              {t("export")}
            </Button>
            <Button type="button" variant="destructive" size="xl" onClick={onDiscardAndLeave}>
              {t("discardAndLeave")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
