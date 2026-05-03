"use client";

import { useRef, useState } from "react";
import { IconSparkles, IconVolume, IconVolumeOff } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const HERO_VIDEO_SRC = "https://static.fizzspace.cn/static/pc/login-bg.mp4";
const HERO_POSTER_SRC =
  "https://images.unsplash.com/photo-1557672172-298e090bd0f1?auto=format&fit=crop&w=1600&q=85";

export function AuthMediaPanel() {
  const t = useTranslations("auth");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    const next = !v.muted;
    v.muted = next;
    if (!next) v.play().catch(() => {});
    setMuted(next);
  };

  const title = t("mediaTitle");
  const description = t("mediaDescription");
  const attribution = t("mediaAttribution");
  const prompt = t("mediaPrompt");

  return (
    <section className="relative hidden h-screen flex-1 select-none overflow-hidden p-4 lg:flex">
      <div className="relative h-full w-full overflow-hidden rounded-xl">
        <video
          ref={videoRef}
          src={HERO_VIDEO_SRC}
          poster={HERO_POSTER_SRC}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="h-full w-full object-cover"
        />

        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? t("mediaUnmute") : t("mediaMute")}
          className="absolute right-4 top-4 z-10 inline-flex size-10 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60"
        >
          {muted ? <IconVolumeOff className="size-5" /> : <IconVolume className="size-5" />}
        </button>

        <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 via-black/55 to-transparent p-6 text-white">
          <h2 className="text-2xl font-semibold tracking-tight [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
            {title}
          </h2>
          <p className="mb-3 mt-1 max-w-md text-sm text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
            {description}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-medium backdrop-blur-md">
              <IconSparkles className="size-3.5" />
              {attribution}
            </span>
            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 backdrop-blur-md transition hover:bg-white/15 hover:text-white"
                >
                  {t("mediaShowPrompt")}
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <IconSparkles className="size-4 text-primary" />
                    {title}
                  </DialogTitle>
                  <p className="text-sm text-foreground/80">{description}</p>
                  <p className="text-xs text-muted-foreground">{attribution}</p>
                </DialogHeader>
                <DialogBody className="max-h-[70vh] overflow-y-auto">
                  <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                    {prompt}
                  </p>
                </DialogBody>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>
    </section>
  );
}
