"use client";

import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import type { Level } from "hls.js";
import { formatBitrate } from "@/lib/interactive-film-playback-view";
import { cn } from "@/lib/utils";

const AUTO_LEVEL = -1;

type PreviewLevel = {
  index: number;
  label: string;
  width: number;
  height: number;
  bitrate: number;
};

/**
 * Operator preview of a published HLS master through the bundled hls.js
 * (MSE only — no native fallback, so the preview shows exactly what MSE
 * playback sees). Callers key it by asset so only one instance exists; the
 * instance is destroyed on close and unmount.
 */
export function HlsPreviewPlayer({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [source, setSource] = useState(url);
  const [levels, setLevels] = useState<PreviewLevel[]>([]);
  const [selected, setSelected] = useState(AUTO_LEVEL);
  const [playing, setPlaying] = useState<PreviewLevel | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  if (source !== url) {
    setSource(url);
    setLevels([]);
    setSelected(AUTO_LEVEL);
    setPlaying(null);
    setFatal(null);
    setUnsupported(false);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let instance: Hls | null = null;
    void import("hls.js")
      .then(({ default: HlsPlayer }) => {
        if (disposed) return;
        if (!HlsPlayer.isSupported()) {
          setUnsupported(true);
          return;
        }
        const hls = new HlsPlayer();
        instance = hls;
        hlsRef.current = hls;
        const syncLevels = () => setLevels(previewLevels(hls.levels));
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, syncLevels);
        hls.on(HlsPlayer.Events.LEVELS_UPDATED, syncLevels);
        hls.on(HlsPlayer.Events.LEVEL_SWITCHED, (_event, data) =>
          setPlaying(previewLevels(hls.levels)[data.level] ?? null)
        );
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          setFatal(
            `${data.details} · HTTP ${data.response?.code ?? "-"} · ${data.url ?? data.frag?.url ?? ""}`
          );
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      })
      .catch((error: unknown) => {
        if (!disposed) setFatal(error instanceof Error ? error.message : String(error));
      });
    return () => {
      disposed = true;
      instance?.destroy();
      if (hlsRef.current === instance) hlsRef.current = null;
    };
  }, [url]);

  function chooseLevel(index: number) {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = index;
    setSelected(index);
  }

  // hls.js orders levels from the lowest variant up; list the highest first.
  const options = [{ index: AUTO_LEVEL, label: "自动" }, ...[...levels].reverse()];
  return (
    <div className="space-y-3">
      {unsupported ? (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800"
          role="alert"
        >
          当前浏览器不支持 MediaSource，无法预览 HLS。
        </p>
      ) : null}
      <video
        ref={videoRef}
        controls
        playsInline
        className={cn("aspect-video w-full rounded-lg bg-black", unsupported && "hidden")}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="radiogroup"
          aria-label="清晰度"
          className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-0.5"
        >
          {options.map((option) => (
            <button
              key={option.index}
              type="button"
              role="radio"
              aria-checked={selected === option.index}
              disabled={levels.length === 0}
              onClick={() => chooseLevel(option.index)}
              className={cn(
                "rounded-md px-3 py-1 text-[12px] font-medium transition-colors disabled:opacity-50",
                selected === option.index
                  ? "bg-white text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="font-mono text-[11px] text-slate-500" aria-live="polite">
          {playing
            ? `${selected === AUTO_LEVEL ? "自动 · " : ""}${playing.label} · ${playing.width}×${playing.height} · ${formatBitrate(playing.bitrate)}`
            : "—"}
        </p>
      </div>
      {fatal ? (
        <p
          className="break-all rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-mono text-[11px] text-red-700"
          role="alert"
        >
          {fatal}
        </p>
      ) : null}
    </div>
  );
}

/** Tier names come from IMM's `{height}p.m3u8` playlists; adaptive tiers may be shorter. */
function previewLevels(levels: readonly Level[]): PreviewLevel[] {
  return levels.map((level, index) => {
    const file = level.uri.split(/[?#]/, 1)[0]!.split("/").pop() ?? "";
    const name = file.replace(/\.m3u8$/i, "");
    return {
      index,
      label: /^\d+p$/.test(name) ? name : level.height ? `${level.height}p` : `档位 ${index + 1}`,
      width: level.width,
      height: level.height,
      bitrate: level.bitrate,
    };
  });
}
