"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconCheck, IconLoader2, IconPlayerPlay, IconShare2, IconX } from "@tabler/icons-react";
import type { ExperienceGameSummary } from "@repo/shared/experience-runtime";
import { useQuery } from "@tanstack/react-query";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { useCurrentUser } from "@/src/hooks/use-user";
import { fetchLatestSave } from "@/src/lib/story-saves";
import { fetchStoreListing } from "@/src/lib/story-store";
import { MediaCarousel } from "./media-carousel";
import type { StoreMediaItem } from "../_data/store-media";

/**
 * Steam-style store dialog for published interactive films. Clicking a film
 * card on /games opens this preview instead of dropping the viewer straight
 * into the player; "Play now" then continues to the player route. Follows the
 * web content-detail rules — consumption layout, compact titles, hairline
 * structure, media carries the color, brand red only on the Play action.
 *
 * Introduction, trailer and screenshots come from the public release
 * snapshot. Catalogue metadata remains useful when a work has no public
 * introduction. Signed-in players with a save can continue their game.
 */

export function InteractiveFilmStoreDialog({
  game,
  open,
  onOpenChange,
}: {
  game: ExperienceGameSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!game) return null;
  return (
    <SelectedInteractiveFilmDialog
      key={`${game.gameId}:${game.currentVersion}`}
      game={game}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

function SelectedInteractiveFilmDialog({
  game,
  open,
  onOpenChange,
}: {
  game: ExperienceGameSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("games.store");
  const commonT = useTranslations("common");
  const locale = useLocale() as Locale;
  const { user } = useCurrentUser();

  const listingQuery = useQuery({
    queryKey: ["story-store", game.gameId, game.currentVersion],
    queryFn: ({ signal }) => fetchStoreListing(game.gameId, signal),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });
  const listing = listingQuery.data;

  const title = listing?.title ?? game.title;
  const description = listing?.description ?? (listing === null ? (game.subtitle ?? "") : "");
  // A snapshot's explicit null means its cover is no longer available; the
  // catalogue URL must not restore media that the release reader withheld.
  const coverUrl = listing ? listing.coverUrl : (game.coverUrl ?? null);
  const tags = listing?.tags ?? [];
  const developer = listing?.developer;
  const mediaItems: StoreMediaItem[] = useMemo(() => {
    if (!listing) return [];
    return [
      ...(listing.trailerUrl
        ? [
            {
              kind: "video" as const,
              url: listing.trailerUrl,
              posterUrl: coverUrl,
            },
          ]
        : []),
      ...listing.screenshots.map((shot) => ({
        kind: "image" as const,
        url: shot.url,
        alt: title,
      })),
    ];
  }, [listing, coverUrl, title]);

  // Progress lookup for the Continue affordance — signed-in players only, so
  // anonymous browsing never trips the global 401 handler.
  const saveQuery = useQuery({
    queryKey: ["story-saves", "latest", game.gameId, user?.id ?? "anonymous"],
    queryFn: () => fetchLatestSave(game.gameId),
    enabled: open && Boolean(user),
    staleTime: 0,
    retry: false,
  });
  const latestSave = user ? saveQuery.data : null;

  const playHref = localizePath(
    `/play/interactive-film/${encodeURIComponent(game.gameId)}`,
    locale
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 bg-background p-0 text-sm text-foreground sm:max-w-5xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/[0.06] bg-background/92 px-5 py-4 backdrop-blur-md sm:px-6">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
              <span>{t("label")}</span>
            </p>
            <DialogTitle className="mt-1.5 truncate text-xl font-bold tracking-tight sm:text-2xl">
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("label")}: {title}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label={commonT("close")}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-muted-foreground transition hover:bg-white/[0.1] hover:text-foreground"
          >
            <IconX className="size-4.5" stroke={1.8} />
          </DialogClose>
        </div>

        <div className="px-5 py-5 sm:px-6">
          {listingQuery.isLoading ? (
            <p role="status" className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
              <IconLoader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {commonT("loading")}
            </p>
          ) : null}
          {listingQuery.isError ? (
            <ReadFailure
              error={listingQuery.error}
              pending={listingQuery.isFetching}
              fallback={commonT("loadFailed")}
              retryLabel={commonT("retry")}
              onRetry={() => void listingQuery.refetch()}
            />
          ) : null}
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              {mediaItems.length > 0 ? (
                <MediaCarousel
                  key={mediaItems.map((item) => item.url).join("|")}
                  media={mediaItems}
                  title={title}
                  trailerLabel={t("trailerLabel")}
                  counterLabel={(index, total) => t("mediaCounter", { index, total })}
                  imageAltFallback={title}
                  errorLabel={t("mediaError")}
                  retryLabel={commonT("retry")}
                />
              ) : (
                <CoverPlaceholder
                  coverUrl={coverUrl}
                  title={title}
                  errorLabel={t("mediaError")}
                  retryLabel={commonT("retry")}
                />
              )}
            </div>

            <aside className="flex flex-col gap-5">
              <dl>
                <InfoRow
                  label={t("updatedAt")}
                  value={new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                    new Date(game.updatedAt)
                  )}
                />
                {developer ? <InfoRow label={t("developer")} value={developer} /> : null}
                <InfoRow label={t("madeWith")} value="FizzDragon" />
              </dl>

              {tags.length ? (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </aside>
          </div>

          <PlayStrip
            gameId={game.gameId}
            playHref={playHref}
            hasSave={Boolean(latestSave)}
            title={title}
            coverUrl={coverUrl}
            progressPending={Boolean(user) && saveQuery.isLoading}
          />
          {user && saveQuery.isError ? (
            <ReadFailure
              error={saveQuery.error}
              pending={saveQuery.isFetching}
              fallback={commonT("loadFailed")}
              retryLabel={commonT("retry")}
              onRetry={() => void saveQuery.refetch()}
            />
          ) : null}

          {description ? (
            <section className="mt-10" aria-labelledby="store-about">
              <SectionHeading id="store-about" title={t("aboutTitle")} />
              <p className="mt-4 text-sm leading-7 whitespace-pre-wrap break-words text-foreground/75">
                {description}
              </p>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReadFailure({
  error,
  pending,
  fallback,
  retryLabel,
  onRetry,
}: {
  error: unknown;
  pending: boolean;
  fallback: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  const message = error instanceof Error ? error.message : fallback;
  return (
    <div role="alert" className="my-4 flex flex-wrap items-start justify-between gap-3">
      <p className="min-w-0 flex-1 text-sm leading-6 break-words text-foreground/80">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={pending}
        className="inline-flex h-8 items-center gap-2 rounded-lg bg-white/[0.06] px-3 text-xs font-medium transition hover:bg-white/[0.1] disabled:opacity-50"
      >
        {pending ? <IconLoader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
        {retryLabel}
      </button>
    </div>
  );
}

function CoverPlaceholder({
  coverUrl,
  title,
  errorLabel,
  retryLabel,
  compact = false,
}: {
  coverUrl: string | null;
  title: string;
  errorLabel: string;
  retryLabel: string;
  compact?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  if (!coverUrl) {
    return <div className="grid aspect-video w-full place-items-center rounded-2xl bg-secondary" />;
  }
  if (failedUrl === coverUrl)
    return (
      <div
        role="alert"
        className={`flex aspect-video flex-col items-center justify-center gap-2 rounded-2xl bg-secondary px-3 text-center ${compact ? "text-[10px]" : "text-sm"}`}
      >
        <p>{errorLabel}</p>
        <button
          type="button"
          data-cover-retry
          className="rounded-md bg-white/[0.08] px-3 py-1.5 text-xs"
          onClick={() => {
            setFailedUrl(null);
            setAttempt((value) => value + 1);
          }}
        >
          {retryLabel}
        </button>
      </div>
    );
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
      <Image
        key={`${coverUrl}:${attempt}`}
        src={coverUrl}
        alt={title}
        fill
        unoptimized
        sizes={compact ? "144px" : "640px"}
        className="object-cover"
        onError={() => setFailedUrl(coverUrl)}
      />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-white/[0.06] py-2.5 last:border-b-0">
      <dt className="shrink-0 text-[11px] font-medium tracking-[0.08em] text-muted-foreground/80 uppercase">
        {label}
      </dt>
      <dd className="text-right text-[13px] leading-5 text-foreground/85">{value}</dd>
    </div>
  );
}

function SectionHeading({ id, title }: { id: string; title: string }) {
  return (
    <h2 id={id} className="text-base font-semibold tracking-tight sm:text-lg">
      {title}
    </h2>
  );
}

function PlayStrip({
  gameId,
  playHref,
  hasSave,
  title,
  coverUrl,
  progressPending,
}: {
  gameId: string;
  playHref: string;
  hasSave: boolean;
  title: string;
  coverUrl: string | null;
  progressPending: boolean;
}) {
  const t = useTranslations("games.store");
  const commonT = useTranslations("common");
  const locale = useLocale() as Locale;
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const onShare = useCallback(async () => {
    const url = new URL(
      localizePath(`/play/interactive-film/${encodeURIComponent(gameId)}`, locale),
      window.location.origin
    ).toString();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url });
        return;
      } catch {
        /* cancelled — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(t("shareFailed"), url);
    }
  }, [gameId, locale, t]);

  return (
    <section className="mt-6 flex flex-col gap-4 rounded-2xl bg-white/[0.04] p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
      {coverUrl ? (
        <div className="hidden w-36 shrink-0 sm:block">
          <CoverPlaceholder
            coverUrl={coverUrl}
            title={title}
            compact
            errorLabel={t("mediaError")}
            retryLabel={commonT("retry")}
          />
        </div>
      ) : null}

      <div className="min-w-0">
        <h2 className="text-sm font-bold tracking-tight sm:text-base">{title}</h2>
      </div>

      <div className="flex items-center gap-3 sm:ml-auto">
        {hasSave ? (
          <Link
            href={`${playHref}?restart=1`}
            className="inline-flex h-11 items-center rounded-full bg-white/[0.06] px-4 text-xs font-medium text-muted-foreground transition hover:bg-white/[0.1] hover:text-foreground sm:px-5 sm:text-sm"
          >
            {t("restartFromBeginning")}
          </Link>
        ) : null}
        {progressPending ? (
          <span
            role="status"
            className="inline-flex h-11 flex-1 items-center justify-center gap-2.5 rounded-full bg-white/[0.06] px-7 text-sm text-muted-foreground sm:flex-none"
          >
            <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
            {commonT("loading")}
          </span>
        ) : (
          <Link
            href={playHref}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2.5 rounded-full bg-primary px-7 text-sm font-semibold text-white transition hover:bg-[#f03a3f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:flex-none"
          >
            <IconPlayerPlay className="size-4.5 fill-current" stroke={0} />
            {hasSave ? t("continuePlaying") : t("playNow")}
          </Link>
        )}

        <button
          type="button"
          onClick={onShare}
          aria-label={copied ? t("shared") : t("share")}
          title={copied ? t("shared") : t("share")}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/[0.06] text-muted-foreground transition hover:bg-white/[0.1] hover:text-foreground"
        >
          {copied ? (
            <IconCheck className="size-4.5 text-[#3fbf87]" stroke={1.8} />
          ) : (
            <IconShare2 className="size-4.5" stroke={1.8} />
          )}
        </button>
      </div>
    </section>
  );
}
