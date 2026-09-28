"use client";

import { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import WaveSurfer from "wavesurfer.js";
import { IconPlayerPlay, IconPlayerPause } from "@tabler/icons-react";

interface AudioPlayerProps {
  src: string;
  name?: string;
}

export function AudioPlayer(props: AudioPlayerProps) {
  return <AudioPlayerSession key={props.src} {...props} />;
}

function AudioPlayerSession({ src, name }: AudioPlayerProps) {
  const t = useTranslations("common");
  const messages = useRef(t);
  useLayoutEffect(() => {
    messages.current = t;
  }, [t]);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState("0:00");
  const [duration, setDuration] = useState("0:00");

  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "rgba(229, 34, 39, 0.4)",
      progressColor: "#E52227",
      cursorColor: "#E52227",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 80,
      normalize: true,
    });

    wsRef.current = ws;
    const current = () => wsRef.current === ws;

    ws.on("ready", () => {
      if (!current()) return;
      setReady(true);
      setDuration(formatTime(ws.getDuration()));
    });

    // Position updates also fire when the waveform is sought while paused.
    ws.on("timeupdate", () => {
      if (!current()) return;
      setCurrentTime(formatTime(ws.getCurrentTime()));
    });

    ws.on("play", () => {
      if (current()) setPlaying(true);
    });
    ws.on("pause", () => {
      if (current()) setPlaying(false);
    });
    ws.on("finish", () => {
      if (current()) setPlaying(false);
    });

    void ws.load(src).catch((error: unknown) => {
      if (!current()) return;
      setReady(false);
      setPlaying(false);
      toast.error(
        error instanceof Error && error.message ? error.message : messages.current("loadFailed")
      );
    });

    return () => {
      wsRef.current = null;
      ws.destroy();
    };
  }, [src]);

  const togglePlay = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    void ws.playPause().catch((error: unknown) => {
      if (wsRef.current !== ws) return;
      setPlaying(false);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : messages.current("operationFailed")
      );
    });
  }, []);

  return (
    <div className="space-y-3">
      {name && <p className="truncate text-sm font-medium">{name}</p>}

      {/* Waveform */}
      <div ref={containerRef} className="rounded-lg" />

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!ready}
          className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 disabled:opacity-50"
        >
          {playing ? <IconPlayerPause className="size-5" /> : <IconPlayerPlay className="size-5" />}
        </button>
        <span className="text-xs text-muted-foreground">
          {currentTime} / {duration}
        </span>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
