"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconShare2, IconCheck } from "@tabler/icons-react";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

type ShareCopy = {
  share: string;
  shareCopied: string;
  shareFailed: string;
};

/**
 * Floating share affordance on the interactive-film player. The play route is
 * login-gated, so the viewer is always authenticated — we fetch their own
 * referral code and bake it into the shared link so a new player who signs up
 * through it attributes back to the sharer. If the code can't be resolved
 * (referral program not provisioned, transient failure), we still share a
 * clean, playable link — never blocking on the decoration.
 */
export function PlayShareButton({
  gameId,
  locale,
  copy,
  chapterId,
}: {
  gameId: string;
  locale: Locale;
  copy: ShareCopy;
  /**
   * The chapter currently open, for a serial work. Without it a share from
   * chapter three hands the recipient chapter one, because the route opens the
   * first chapter whenever the URL names none.
   */
  chapterId?: string | null;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Best-effort: the user's own recommendationCode (= their invite code).
    fetch("/aurora/referrals/me", {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { inviteCode?: string | null } | null) => {
        if (!cancelled && data && typeof data.inviteCode === "string") {
          setCode(data.inviteCode);
        }
      })
      .catch(() => {
        /* no code → share the plain link */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const buildShareUrl = useCallback(() => {
    const path = localizePath(`/play/interactive-film/${encodeURIComponent(gameId)}`, locale);
    const url = new URL(path, window.location.origin);
    if (chapterId) url.searchParams.set("chapter", chapterId);
    if (code) url.searchParams.set("recommendationCode", code);
    return url.toString();
  }, [gameId, locale, code, chapterId]);

  const onShare = useCallback(async () => {
    const url = buildShareUrl();
    // Prefer the native share sheet on mobile; fall back to clipboard.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // Cancelled or unsupported payload — fall through to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (e.g. insecure context) — last-resort prompt.
      window.prompt(copy.shareFailed, url);
    }
  }, [buildShareUrl, copy.shareFailed]);

  return (
    <button
      type="button"
      onClick={onShare}
      aria-label={copy.share}
      className="pointer-events-auto fixed top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] z-50 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-2 text-sm font-medium text-white/90 backdrop-blur-md transition-colors hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      {copied ? <IconCheck className="size-4" /> : <IconShare2 className="size-4" />}
      <span>{copied ? copy.shareCopied : copy.share}</span>
    </button>
  );
}
