"use client";

import { useState } from "react";
import { IconPhotoOff, IconRefresh } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import type { TvItem } from "../_hooks/types";

interface TvStageProps {
  item: TvItem;
}

export function TvStage({ item }: TvStageProps) {
  const t = useTranslations("tv");
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const [failedVideo, setFailedVideo] = useState<string | null>(null);
  const coverAvailable = Boolean(item.cover) && failedCover !== item.cover;
  const videoAvailable = Boolean(item.trailer) && failedVideo !== item.trailer;

  // Trailer-less items park on their cover — the viewer switches manually.
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {coverAvailable && !videoAvailable && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={item.cover}
          src={item.cover}
          alt=""
          onError={() => setFailedCover(item.cover)}
          className="absolute inset-0 size-full object-contain"
        />
      )}

      {videoAvailable && (
        <video
          key={item.id}
          src={item.trailer}
          poster={coverAvailable ? item.cover : undefined}
          autoPlay
          controls
          muted
          playsInline
          preload="metadata"
          onError={() => setFailedVideo(item.trailer)}
          className="relative size-full bg-black object-contain"
        />
      )}

      {!videoAvailable && (!coverAvailable || failedVideo === item.trailer) && (
        <div
          role="status"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 px-6 text-center text-white/60"
        >
          <IconPhotoOff aria-hidden className="size-10 text-white/30" />
          <p className="text-sm">
            {item.trailer ? t("videoUnavailable") : t("previewUnavailable")}
          </p>
          {item.trailer && (
            <button
              type="button"
              onClick={() => setFailedVideo(null)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <IconRefresh aria-hidden className="size-4" />
              {t("retry")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
