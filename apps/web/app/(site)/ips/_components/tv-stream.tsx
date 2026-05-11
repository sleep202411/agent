"use client";

/**
 * TV Stream — full-screen, single-card-at-a-time IP showcase modal.
 *
 * UX bones lifted from the `fizzdragon-prd` mock (see
 * `/components/ip/TVStream.tsx` in that repo): one card visible at a
 * time with a fade swap on advance, keyboard / wheel / chevron
 * navigation, top-right close, top-center counter. The substantive
 * difference vs the mock is that we play real trailers — each IP's
 * trailer URL is resolved on demand through `useProjectVideoLink`
 * (`POST /vedio/play/project/getLink`) and piped into a `<video>`.
 * IPs without a resolvable trailer fall back to a full-bleed cover
 * image, so every card in the queue is renderable rather than
 * filtered out — `videoLink !== null` on the list payload is not a
 * reliable trailer flag, only `getLink` is.
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

  // Pre-fetch when nearing end of queue.
  useEffect(() => {
    if (!hasNextPage || !onLoadMore || isFetchingMore) return;
    if (current >= ips.length - LOAD_MORE_BUFFER) onLoadMore();
  }, [current, ips.length, hasNextPage, onLoadMore, isFetchingMore]);

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

  if (ips.length === 0) {
    return <EmptyState onClose={onClose} />;
  }

  const ip = ips[current];

  return (
    <div className="fixed inset-0 z-100 flex flex-col bg-black">
      {/* Top bar — counter on the left, close on the right. Sits
          above the video at z-10 so it stays clickable. */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 pt-5 pb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <IconDeviceTv className="size-5" />
          <span>{t("tvLabel")}</span>
          <span className="ml-1 text-xs font-normal text-white/40 tabular-nums">
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
  // Always ask `getLink` — the `videoLink` field on the list payload
  // is not authoritative; trailers exist for some IPs whose listing
  // record reads null/empty. The hook caches per IP id, so flipping
  // back and forth doesn't re-hit the backend. When the call returns
  // empty / errors, `playableUrl` stays falsy and the card degrades
  // to its cover image.
  const { data: playableUrl } = useProjectVideoLink(String(ip.id));
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
    <div className="relative size-full overflow-hidden bg-black">
      {/* Layer 0 — full-bleed cover. Always rendered so the card has
          something to show during getLink in-flight and so IPs without
          a trailer still feel like a poster card rather than blank.
          object-cover trades a bit of cropping for an immersive feel
          (banners are 16:9 and the viewport is roughly landscape). */}
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <IconSparkles className="size-16 text-white/20" />
        </div>
      )}

      {/* Layers 1 + 2 — only when getLink resolved a playable URL.
          Blurred-cover backdrop fills the letterbox bars left by the
          contained video so the screen never goes hard-black around a
          16:9 trailer in a portrait window. */}
      {playableUrl && (
        <>
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt=""
              className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-2xl"
            />
          )}
          <video
            ref={videoRef}
            // Key on ip.id so advance triggers a clean remount and
            // autoplay attribute kicks in fresh — sidesteps
            // .load()/.play() bookkeeping when src changes.
            key={ip.id}
            src={playableUrl}
            autoPlay
            muted={muted}
            playsInline
            loop
            preload="auto"
            className="relative size-full object-contain"
          />
        </>
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
