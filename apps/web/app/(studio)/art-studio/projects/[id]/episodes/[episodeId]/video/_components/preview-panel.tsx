"use client";

import { IconDownload, IconPlayerPlay, IconVideo } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ossUrl } from "@/src/lib/asset-paths";

interface PreviewPanelProps {
  videoPath: string;
  imagePath: string;
  duration: string;
}

/**
 * Right-column preview. Falls back gracefully:
 *   video → cover image → empty state
 * Hidden below xl so the editor + timeline get the screen on
 * narrower windows.
 */
export function PreviewPanel({ videoPath, imagePath, duration }: PreviewPanelProps) {
  const mediaPath = videoPath || imagePath;
  return (
    <section className="hidden min-h-0 flex-col gap-3 lg:flex">
      <Card className="min-h-0 flex-1 overflow-hidden p-0">
        <div className="relative flex h-full min-h-[420px] items-center justify-center bg-black">
          {videoPath ? (
            <video src={ossUrl(videoPath)} controls className="h-full w-full object-contain" />
          ) : imagePath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ossUrl(imagePath)} alt="" className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm text-white/55">
              <IconVideo className="size-8" />
              暂无预览
            </div>
          )}
          {mediaPath ? (
            <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
              <IconPlayerPlay className="size-3 fill-current" /> 00:00 / 00:
              {String(duration || "05").padStart(2, "0")}
            </div>
          ) : null}
          {mediaPath ? (
            <Button
              variant="soft"
              color="muted"
              size="icon-sm"
              className="absolute bottom-3 right-3"
            >
              <IconDownload />
            </Button>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
