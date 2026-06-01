"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  IconChevronDown,
  IconChevronUp,
  IconDeviceTv,
  IconPlayerPlay,
  IconSparkles,
  IconUser,
  IconVolume,
  IconVolumeOff,
  IconX,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import type { PlazaProject } from "./plaza-types";

const MUTE_STORAGE_KEY = "fd:tv:muted";
const WHEEL_THROTTLE_MS = 600;
const LOAD_MORE_BUFFER = 3;

interface TVStreamProps {
  ips: PlazaProject[];
  onClose: () => void;
  onLoadMore?: () => void;
  hasNextPage?: boolean;
  isFetchingMore?: boolean;
}

export function TVStream({ ips, onClose, onLoadMore, hasNextPage, isFetchingMore }: TVStreamProps) {
  const t = useTranslations("ip");
  const locale = useLocale() as Locale;
  const [current, setCurrent] = useState(0);
  const [animDir, setAnimDir] = useState<"up" | "down" | null>(null);
  const [muted, setMuted] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.sessionStorage.getItem(MUTE_STORAGE_KEY) !== "false";
  });

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      sessionStorage.setItem(MUTE_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const goNext = useCallback(() => {
    setCurrent((c) => {
      if (c >= ips.length - 1) return c;
      setAnimDir("up");
      window.setTimeout(() => setAnimDir(null), 220);
      return c + 1;
    });
  }, [ips.length]);

  const goPrev = useCallback(() => {
    setCurrent((c) => {
      if (c <= 0) return c;
      setAnimDir("down");
      window.setTimeout(() => setAnimDir(null), 220);
      return c - 1;
    });
  }, []);

  useEffect(() => {
    if (!hasNextPage || !onLoadMore || isFetchingMore) return;
    if (current >= ips.length - LOAD_MORE_BUFFER) onLoadMore();
  }, [current, ips.length, hasNextPage, onLoadMore, isFetchingMore]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Escape") {
        onClose();
      } else if (e.key === "m") {
        toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, onClose, toggleMute]);

  useEffect(() => {
    let lastWheel = 0;
    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      if (now - lastWheel < WHEEL_THROTTLE_MS) return;
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      if (Math.abs(e.deltaY) < 8) return;
      lastWheel = now;
      if (e.deltaY > 0) goNext();
      else goPrev();
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [goNext, goPrev]);

  if (ips.length === 0) {
    return <EmptyState onClose={onClose} />;
  }

  const ip = ips[Math.min(current, ips.length - 1)];

  return (
    <div className="fixed inset-0 z-100 flex flex-col bg-black">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 pb-3 pt-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <IconDeviceTv className="size-5" />
          <span>{t("tvLabel")}</span>
          <span className="ml-1 text-xs font-normal tabular-nums text-white/40">
            {current + 1} / {ips.length}
            {hasNextPage ? "+" : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("tvClose")}
          className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <IconX className="size-5" />
        </button>
      </div>

      <div
        className={`flex-1 transition-all duration-200 ease-out ${
          animDir === "up"
            ? "-translate-y-4 opacity-0"
            : animDir === "down"
              ? "translate-y-4 opacity-0"
              : "translate-y-0 opacity-100"
        }`}
      >
        <TVCard ip={ip} muted={muted} locale={locale} />
      </div>

      <div className="absolute right-6 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-3">
        <button
          type="button"
          onClick={goPrev}
          disabled={current === 0}
          aria-label={t("tvPrev")}
          className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-20"
        >
          <IconChevronUp className="size-5" />
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={current >= ips.length - 1 && !hasNextPage}
          aria-label={t("tvNext")}
          className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-20"
        >
          <IconChevronDown className="size-5" />
        </button>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? t("tvUnmute") : t("tvMute")}
          className="mt-2 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:bg-white/20"
        >
          {muted ? <IconVolumeOff className="size-5" /> : <IconVolume className="size-5" />}
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center px-6">
        <div className="flex items-center gap-2 text-xs text-white/30">
          <span>{t("tvNavHint")}</span>
        </div>
      </div>
    </div>
  );
}

function TVCard({ ip, muted, locale }: { ip: PlazaProject; muted: boolean; locale: Locale }) {
  const t = useTranslations("ip");
  const ownerName = ip.ownerName.trim() || t("anonymousOwner");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  return (
    <div className="relative size-full overflow-hidden bg-black">
      {ip.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ip.cover} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <IconSparkles className="size-16 text-white/20" />
        </div>
      )}

      {ip.trailer && (
        <>
          {ip.cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ip.cover}
              alt=""
              className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-2xl"
            />
          )}
          <video
            ref={videoRef}
            key={ip.id}
            src={ip.trailer}
            autoPlay
            muted={muted}
            playsInline
            loop
            preload="auto"
            className="relative size-full object-contain"
          />
        </>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3 bg-linear-to-t from-black/85 via-black/40 to-transparent px-6 pb-20 pt-16 sm:px-10 sm:pb-24">
        <div className="max-w-2xl space-y-3">
          <h2 className="text-2xl font-black leading-tight text-white sm:text-4xl">{ip.name}</h2>

          <div className="flex items-center gap-2 text-sm">
            {ip.ownerAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ip.ownerAvatar}
                alt=""
                className="size-7 rounded-full border border-white/20 object-cover"
              />
            ) : (
              <div className="flex size-7 items-center justify-center rounded-full border border-white/20 bg-white/10">
                <IconUser className="size-3.5 text-white/70" />
              </div>
            )}
            <span className="font-medium text-white/85">{ownerName}</span>
          </div>

          {ip.description && (
            <p className="line-clamp-3 max-w-lg text-sm leading-relaxed text-white/70">
              {ip.description}
            </p>
          )}

          <Link
            href={localizePath(`/ips/${ip.id}`, locale)}
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-black transition-colors hover:bg-white/90"
          >
            <IconPlayerPlay className="size-4" />
            {t("tvViewDetail")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onClose }: { onClose: () => void }) {
  const t = useTranslations("ip");
  return (
    <div className="fixed inset-0 z-100 flex flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white/70">
      <IconDeviceTv className="size-12 text-white/30" />
      <p className="text-sm">{t("tvEmpty")}</p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
      >
        {t("tvClose")}
      </button>
    </div>
  );
}
