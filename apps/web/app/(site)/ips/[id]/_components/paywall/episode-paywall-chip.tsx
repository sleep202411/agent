"use client";

/**
 * Drop-in replacement for the episode-row "Play" button. Matches the
 * existing button's compact dimensions exactly so swapping in / out
 * doesn't shift layout. Renders one of four affordances based on
 * resolved access:
 *
 *   • free               → original play button (no paywall context)
 *   • owned-single       → play button tinted green, with ✓ icon
 *   • owned-full         → play button tinted violet, with ✓ icon
 *   • locked             → "🔒 N" amber CTA, click opens confirm dialog
 *
 * If the paywall is inactive (no-paywall / owner-bypass), the chip
 * just renders the original play button — so the calling site can
 * blanket-replace its play button with this component and the
 * non-paywall path stays visually identical.
 */

import { useState } from "react";
import { IconCheck, IconCoin, IconLock, IconPlayerPlay } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { usePricing } from "./pricing-context";
import { UnlockConfirmDialog } from "./unlock-confirm-dialog";

interface EpisodePaywallChipProps {
  episodeId: string;
  episodeTitle?: string;
  episodeNumber: number;
  /** True when this episode is the one currently being played in
   *  the trailer slot. Forwarded into the play button's `isPlaying`
   *  appearance / disabled state. */
  isPlaying?: boolean;
  /** Click handler for the play affordance. Caller wires this to its
   *  existing "select episode" logic; the chip doesn't know how
   *  playback works. Called only when the episode is accessible. */
  onPlay?: () => void;
  /** Label fallbacks for the play states. Defaults read from the
   *  `paywall` i18n namespace; callers can override to keep
   *  page-local copy ("Now playing" etc.). */
  playLabel?: string;
  nowPlayingLabel?: string;
}

export function EpisodePaywallChip({
  episodeId,
  episodeTitle,
  episodeNumber,
  isPlaying = false,
  onPlay,
  playLabel,
  nowPlayingLabel,
}: EpisodePaywallChipProps) {
  const t = useTranslations("paywall");
  const { state, episodeAccess } = usePricing();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Inactive paywall → plain play button, behaves exactly like before.
  if (state === "no-paywall" || state === "owner-bypass") {
    return (
      <PlayButton
        variant="free"
        isPlaying={isPlaying}
        onClick={onPlay}
        playLabel={playLabel ?? t("play")}
        nowPlayingLabel={nowPlayingLabel ?? t("nowPlaying")}
      />
    );
  }

  const access = episodeAccess(episodeId);

  if (access.kind === "locked" || access.kind === "locked-bundle") {
    return (
      <>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-medium text-amber-400 transition-colors",
            "hover:border-amber-400/60 hover:bg-amber-400/20"
          )}
          aria-label={t("unlockAria", { n: episodeNumber, price: access.price })}
        >
          <IconLock className="size-3" />
          <IconCoin className="size-3" />
          <span className="tabular-nums">{access.price}</span>
        </button>
        {access.kind === "locked-bundle" ? (
          <UnlockConfirmDialog mode="bundle" open={confirmOpen} onOpenChange={setConfirmOpen} />
        ) : (
          <UnlockConfirmDialog
            mode="episode"
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            episode={{ id: episodeId, title: episodeTitle, number: episodeNumber }}
          />
        )}
      </>
    );
  }

  // Free / owned — render the same compact play button but with the
  // ownership variant for visual feedback.
  return (
    <PlayButton
      variant={
        access.kind === "owned-full"
          ? "owned-full"
          : access.kind === "owned-single"
            ? "owned"
            : "free"
      }
      isPlaying={isPlaying}
      onClick={onPlay}
      playLabel={playLabel ?? t("play")}
      nowPlayingLabel={nowPlayingLabel ?? t("nowPlaying")}
    />
  );
}

// ─── Play button atom ──────────────────────────────────

type PlayVariant = "free" | "owned" | "owned-full";

function PlayButton({
  variant,
  isPlaying,
  onClick,
  playLabel,
  nowPlayingLabel,
}: {
  variant: PlayVariant;
  isPlaying: boolean;
  onClick?: () => void;
  playLabel: string;
  nowPlayingLabel: string;
}) {
  // Color sets matched to the row's existing primary-tint play
  // button — owned variants subtly recolor without resizing.
  const colors = isPlaying
    ? "cursor-default bg-primary/20 text-primary"
    : variant === "owned"
      ? "bg-green-400/10 text-green-400 hover:bg-green-400/20"
      : variant === "owned-full"
        ? "bg-violet-400/10 text-violet-400 hover:bg-violet-400/20"
        : "bg-primary/10 text-primary hover:bg-primary/20";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPlaying || !onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors",
        colors,
        "disabled:cursor-not-allowed"
      )}
    >
      {variant === "owned" || variant === "owned-full" ? (
        <IconCheck className="size-3" />
      ) : (
        <IconPlayerPlay className="size-3" />
      )}
      {isPlaying ? nowPlayingLabel : playLabel}
    </button>
  );
}
