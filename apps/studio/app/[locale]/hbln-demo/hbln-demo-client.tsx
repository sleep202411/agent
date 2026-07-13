"use client";

import { useRef, useState } from "react";
import { StoryFilmPreviewPlayer } from "@/app/[locale]/(studio)/story-studio/projects/[projectId]/_components/story-film-preview-player";

// Fullscreen-immersive 影游 shell for the hu-bao-villa demo.
// The preview player's overlays are already absolute inset-0; we host it in a
// full-viewport container and override PlayerFrame's centered 16:9 card so the
// picture fills edge-to-edge (like the Jinling 影游). A one-gesture button also
// enters true browser fullscreen.
export function HblnDemoClient({
  release,
  locale,
}: {
  release: Record<string, unknown>;
  locale: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);

  const enter = () => {
    ref.current?.requestFullscreen?.().catch(() => {});
    setEntered(true);
  };

  return (
    <div ref={ref} data-hbln-fs className="fixed inset-0 z-[100] bg-black">
      <style>{`
        [data-hbln-fs] > div { width: 100%; height: 100%; }
        [data-hbln-fs] .aspect-video {
          aspect-ratio: auto !important;
          width: 100vw !important; height: 100vh !important;
          max-width: none !important; margin: 0 !important;
          border-radius: 0 !important; box-shadow: none !important;
        }
        [data-hbln-fs] video { width: 100vw !important; height: 100vh !important; object-fit: cover !important; }
        /* immersive 影游: no native video scrubber, no dev node label */
        [data-hbln-fs] video::-webkit-media-controls,
        [data-hbln-fs] video::-webkit-media-controls-enclosure,
        [data-hbln-fs] video::-webkit-media-controls-panel { display: none !important; opacity: 0 !important; }
        [data-hbln-fs] .z-20 .font-mono { display: none !important; }
      `}</style>

      <StoryFilmPreviewPlayer runtime={release} locale={locale} frameProfile="landscape_16_9" />

      {!entered ? (
        <button
          type="button"
          onClick={enter}
          className="absolute bottom-6 left-1/2 z-[110] -translate-x-1/2 rounded-full bg-white/90 px-6 py-3 text-sm font-semibold text-black shadow-2xl backdrop-blur transition hover:bg-white"
        >
          ▶ 进入全屏试玩
        </button>
      ) : null}
    </div>
  );
}
