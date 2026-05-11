"use client";

/**
 * TV Stream — full-screen, single-card-at-a-time IP showcase modal.
 *
 * UX bones lifted from the `fizzdragon-prd` mock (see
 * `/components/ip/TVStream.tsx` in that repo): one card visible at a
 * time with a fade swap on advance, keyboard / wheel / chevron
 * navigation, top-right close, top-center counter. The substantive
 * difference vs the mock is that we play real trailers — each IP's
 * `videoLink` is an opaque OSS key, resolved on demand through
 * `useProjectVideoLink` (`POST /vedio/play/project/getLink`) and
 * piped into a `<video>` background.
 *
 * Caller owns the IP list (so the same `useInfiniteIPList` data the
 * Plaza grid renders also fuels the stream — no second fetch). When
 * the user is within the last 3 cards we ping `loadMore` so the
 * stream never bottoms out abruptly.
 *
 * Mute pref persists in `sessionStorage` across modal open/close +
 * card advances, but resets per browser tab — TV is a deliberate
 * lean-back surface, not a setting we want to leak elsewhere.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  IconChevronDown,
  IconChevronUp,
  IconDeviceTv,
  IconLoader2,
  IconPlayerPlay,
  IconUser,
  IconVolume,
  IconVolumeOff,
  IconX,
} from "@tabler/icons-react";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { ipImageUrl, userAvatarUrl, useProjectVideoLink } from "../_hooks/use-ip";
import type { IPProject } from "../_hooks/use-ip";

const MUTE_STORAGE_KEY = "fd:tv:muted";
// Throttle wheel-driven swaps so a single trackpad flick doesn't
// jump 3 cards. 600ms matches the PRD reference; feels snappy
// without misfiring on momentum scroll.
const WHEEL_THROTTLE_MS = 600;
// Pre-fetch the next page when the user is within this many cards
// of the end. Keeps the queue from running dry mid-session.
const LOAD_MORE_BUFFER = 3;

interface TVStreamProps {
  ips: IPProject[];
  onClose: () => void;
  /** Fetch next page of IPs (called when nearing end of queue). */
  onLoadMore?: () => void;
  hasNextPage?: boolean;
  isFetchingMore?: boolean;
}

export function TVStream({ ips, onClose, onLoadMore, hasNextPage, isFetchingMore }: TVStreamProps) {
  const t = useTranslations("ip");
  const locale = useLocale() as Locale;

  // Filter to IPs with a trailer — without `videoLink` there's
  // nothing to play, so showing them in a video stream wastes a slot.
  const playable = useMemo(() => ips.filter((ip) => !!ip.videoLink), [ips]);

  const [current, setCurrent] = useState(0);
  // Animation direction drives the fade-in/out class. `null` between
  // transitions so the entered card sits at full opacity.
  const [animDir, setAnimDir] = useState<"up" | "down" | null>(null);

  // Mute pref hydrates from sessionStorage on mount; default mute=true
  // so browser autoplay never gets blocked on first card.
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const saved = sessionStorage.getItem(MUTE_STORAGE_KEY);
    if (saved === "false") setMuted(false);
  }, []);
  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      sessionStorage.setItem(MUTE_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // Lock body scroll while the modal is open. Without this the page
  // beneath scrolls when the user wheels past the last card.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const goNext = useCallback(() => {
    setCurrent((c) => {
      if (c >= playable.length - 1) return c;
      setAnimDir("up");
      window.setTimeout(() => setAnimDir(null), 220);
      return c + 1;
    });
  }, [playable.length]);

  const goPrev = useCallback(() => {
    setCurrent((c) => {
      if (c <= 0) return c;
      setAnimDir("down");
      window.setTimeout(() => setAnimDir(null), 220);
      return c - 1;
    });
  }, []);

  // Pre-fetch when nearing end of queue.
  useEffect(() => {
    if (!hasNextPage || !onLoadMore || isFetchingMore) return;
    if (current >= playable.length - LOAD_MORE_BUFFER) onLoadMore();
  }, [current, playable.length, hasNextPage, onLoadMore, isFetchingMore]);

  // Keyboard nav. ↑/↓ for the conventional path, j/k for the
  // vim-mode crowd, ESC to bail. Bound to window so focus state
  // (mute button, view-detail link) doesn't swallow them.
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

  // Wheel-as-swipe — every wheel event past the throttle window
  // advances one card. PRD uses the same idiom.
  useEffect(() => {
    let lastWheel = 0;
    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      if (now - lastWheel < WHEEL_THROTTLE_MS) return;
      // Tolerate the small horizontal drift that touchpads emit;
      // only react when the dominant axis is vertical.
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      if (Math.abs(e.deltaY) < 8) return;
      lastWheel = now;
      if (e.deltaY > 0) goNext();
      else goPrev();
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [goNext, goPrev]);

  if (playable.length === 0) {
    return <EmptyState onClose={onClose} />;
  }

  const ip = playable[current];

  return (
    <div className="fixed inset-0 z-100 flex flex-col bg-black">
      {/* Top bar — counter on the left, close on the right. Sits
          above the video at z-10 so it stays clickable. */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 pt-5 pb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <IconDeviceTv className="size-5" />
          <span>{t("tvLabel")}</span>
          <span className="ml-1 text-xs font-normal text-white/40 tabular-nums">
            {current + 1} / {playable.length}
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

      {/* Card stage — the fade transition lives here so the chrome
          (nav arrows, mute, top bar) stays put while content swaps. */}
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

      {/* Right rail — navigation arrows + mute. Vertically centered,
          single column so the layout reads "playback controls" rather
          than "social rail" (we don't have likes/share data yet). */}
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
          disabled={current >= playable.length - 1 && !hasNextPage}
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

      {/* Footer hint — keyboard / wheel discoverability. The text is
          deliberately near-invisible so it doesn't compete with the
          card content; users who need it will find it. */}
      <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center px-6">
        <div className="flex items-center gap-2 text-xs text-white/30">
          <span>{t("tvNavHint")}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Single card ──────────────────────────────────────────

function TVCard({ ip, muted, locale }: { ip: IPProject; muted: boolean; locale: Locale }) {
  const t = useTranslations("ip");
  // Lazy resolve the playable URL. Hook gates on truthy `videoLink`;
  // since `playable` upstream filtered to IPs with a trailer, this
  // always fires. Result is cached per IP id, so flipping back and
  // forth doesn't re-hit the backend.
  const { data: playableUrl, isLoading } = useProjectVideoLink(String(ip.id), !!ip.videoLink);
  const cover = ipImageUrl(ip.bannerLink);
  const avatar = userAvatarUrl(ip.ownerAvatar);
  const ownerName = (ip.ownerName || "").trim() || t("anonymousOwner");

  // Keep the muted attribute in sync — React's `muted` prop only
  // reflects to the DOM on initial render; subsequent toggles are
  // ignored unless we set the property imperatively.
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  return (
    <div className="relative size-full overflow-hidden">
      {/* Backdrop — cover image stays visible during getLink + first
          frame paint. Slight scale + dim so it reads as ambient
          rather than primary. */}
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover}
          alt=""
          className="absolute inset-0 size-full scale-110 object-cover blur-2xl opacity-40"
        />
      )}

      {/* Centered video — object-contain so 16:9 trailers don't get
          cropped to fit a portrait viewport. The ambient backdrop
          above fills the bars. */}
      {playableUrl ? (
        <video
          ref={videoRef}
          // Keying on ip.id forces a clean remount on advance so
          // autoplay attribute kicks in fresh; sidesteps having to
          // call .load()/.play() imperatively when src changes.
          key={ip.id}
          src={playableUrl}
          autoPlay
          muted={muted}
          playsInline
          loop
          preload="auto"
          className="relative size-full object-contain"
        />
      ) : (
        <div className="relative flex size-full items-center justify-center">
          {isLoading ? (
            <IconLoader2 className="size-10 animate-spin text-white/60" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-white/40">
              <IconPlayerPlay className="size-12" />
              <span className="text-sm">{t("tvNoStream")}</span>
            </div>
          )}
        </div>
      )}

      {/* Bottom-left overlay — title, owner, description, CTA. */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3 bg-linear-to-t from-black/85 via-black/40 to-transparent px-6 pb-20 pt-16 sm:px-10 sm:pb-24">
        <div className="max-w-2xl space-y-3">
          <h2 className="text-2xl font-black leading-tight text-white sm:text-4xl">{ip.name}</h2>

          <div className="flex items-center gap-2 text-sm">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
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

// ─── Empty state ──────────────────────────────────────────

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
