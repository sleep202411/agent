"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { GenerationState } from "@/lib/canvas-authoring/generation-api";
import { CanvasMediaViewer } from "./canvas-media-viewer";

/** Browse every image without changing the node's primary downstream reference. */
export function GenerationOutputGallery({
  outputs,
  title,
}: {
  outputs: NonNullable<GenerationState["outputs"]>;
  title: string;
}) {
  const t = useTranslations("generation");
  const [opened, setOpened] = useState<{ url: string; index: number } | null>(null);
  const images = outputs.filter((output) => output.type === "image");
  if (images.length < 2) return null;
  const active =
    opened && images[opened.index]?.url === opened.url ? images[opened.index] : undefined;
  return (
    <div className="nodrag nopan nowheel border-t border-white/10 p-2">
      <p className="mb-2 text-xs text-muted-foreground">
        {t("outputGalleryCount", { count: images.length })}
      </p>
      <div className="flex gap-2 overflow-x-auto">
        {images.map((output, index) => (
          <button
            key={`${index}:${output.url}`}
            type="button"
            aria-label={t("viewOutput", { number: index + 1, count: images.length })}
            className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-white/15 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={(event) => {
              event.stopPropagation();
              setOpened({ url: output.url, index });
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={output.url} alt="" draggable={false} className="size-full object-cover" />
            <span className="absolute right-0 bottom-0 rounded-tl bg-black/70 px-1 text-xs text-white">
              {index + 1}
            </span>
          </button>
        ))}
      </div>
      {active && opened && (
        <CanvasMediaViewer
          key={active.url}
          type="image"
          src={active.url}
          assetId={active.assetId}
          title={`${title} · ${opened.index + 1}/${images.length}`}
          alt={t("viewOutput", { number: opened.index + 1, count: images.length })}
          downloadName={`${title}-${opened.index + 1}.png`}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  );
}
