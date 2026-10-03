"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  IconCheck,
  IconHeart,
  IconPlayerPlay,
  IconShare2,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import type { ExperienceGameSummary } from "@repo/shared/experience-runtime";
import { useQuery } from "@tanstack/react-query";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { useCurrentUser } from "@/src/hooks/use-user";
import { fetchLatestSave } from "@/src/lib/story-saves";
import { MediaCarousel } from "./media-carousel";
import { findMockStoreEntry } from "../_data/interactive-film-store";

/**
 * Steam-style store dialog for published interactive films. Clicking a film
 * card on /games opens this preview instead of dropping the viewer straight
 * into the player; "Play now" then continues to the player route. Follows the
 * web content-detail rules — consumption layout, compact titles, hairline
 * structure, media carries the color, brand red only on the Play action.
 *
 * Rich store content (trailer, screenshots, about) comes from the mock
 * fixture while the store-detail API contract is pending; a game without a
 * mock entry renders only what the real catalogue provides. Signed-in
 * players with a save see "Continue playing" instead of "Play now".
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
  const t = useTranslations("games.store");
  const locale = useLocale() as Locale;
  const { user } = useCurrentUser();

  const entry = game ? findMockStoreEntry(game.gameId) : undefined;
  const content = entry?.content[locale] ?? entry?.content["en-US"];
  const title = content?.title ?? game?.title ?? "";
  const shortDescription = content?.shortDescription ?? game?.subtitle ?? "";
  const coverUrl = entry?.coverUrl ?? game?.coverUrl ?? null;

  // Progress lookup for the Continue affordance — signed-in players only, so
  // anonymous browsing never trips the global 401 handler.
  const { data: latestSave } = useQuery({
    queryKey: ["story-saves", "latest", game?.gameId, user?.id ?? "anonymous"],
    queryFn: () => fetchLatestSave(game!.gameId),
    enabled: open && Boolean(game) && Boolean(user),
    staleTime: 0,
    retry: false,
  });

  if (!game) return null;

  const playHref = localizePath(
    `/play/interactive-film/${encodeURIComponent(game.gameId)}`,
    locale
  );
  const continueHref =
    latestSave && latestSave.chapterId
      ? `${playHref}?chapter=${encodeURIComponent(latestSave.chapterId)}`
      : playHref;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="gap-0 bg-background p-0 text-sm text-foreground sm:max-w-5xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/[0.06] bg-background/92 px-5 py-4 backdrop-blur-md sm:px-6">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
              <span>{t("label")}</span>
              {content?.genres.length ? (
                <>
                  <span aria-hidden className="text-muted-foreground/40">
                    ·
                  </span>
                  <span>{content.genres.join(" / ")}</span>
                </>
              ) : null}
            </p>
            <DialogTitle className="mt-1.5 truncate text-xl font-bold tracking-tight sm:text-2xl">
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">{shortDescription}</DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-muted-foreground transition hover:bg-white/[0.1] hover:text-foreground"
          >
            <IconX className="size-4.5" stroke={1.8} />
          </DialogClose>
        </div>

        <div className="px-5 py-5 sm:px-6">
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              {entry ? (
                <MediaCarousel
                  media={entry.media}
                  title={title}
                  trailerLabel={t("trailerLabel")}
                  counterLabel={(index, total) => t("mediaCounter", { index, total })}
                  imageAltFallback={title}
                />
              ) : (
                <CoverPlaceholder coverUrl={coverUrl} title={title} />
              )}
            </div>

            <aside className="flex flex-col gap-5">
              {shortDescription ? (
                <p className="text-sm leading-relaxed text-foreground/80">{shortDescription}</p>
              ) : null}

              <dl>
                {entry && content ? (
                  <InfoRow
                    label={t("releaseDate")}
                    value={new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                      new Date(entry.releaseDate)
                    )}
                  />
                ) : (
                  <InfoRow
                    label={t("updatedAt")}
                    value={new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                      new Date(game.updatedAt)
                    )}
                  />
                )}
                {entry && content ? (
                  <InfoRow label={t("developer")} value={entry.developer} />
                ) : null}
                {entry && content ? (
                  <InfoRow label={t("publisher")} value={entry.publisher} />
                ) : null}
                {entry && content?.genres.length ? (
                  <InfoRow label={t("genres")} value={content.genres.join(", ")} />
                ) : null}
                {entry && content ? (
                  <InfoRow label={t("languages")} value={entry.languages.join(", ")} />
                ) : null}
                <InfoRow label={t("madeWith")} value="FizzDragon Studio" />
              </dl>

              {content?.tags.length ? (
                <div className="flex flex-wrap gap-2">
                  {content.tags.map((tag) => (
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
            continueHref={continueHref}
            hasSave={Boolean(latestSave)}
            title={title}
            coverUrl={coverUrl}
            freeToPlay={Boolean(content)}
            playersNow={entry?.playersNow}
          />

          {content ? (
            <section className="mt-10" aria-labelledby="store-about">
              <SectionHeading id="store-about" title={t("aboutTitle")} />
              <div className="mt-4 space-y-3.5">
                {content.aboutParagraphs.map((paragraph) => (
                  <p key={paragraph.slice(0, 32)} className="text-sm leading-7 text-foreground/75">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CoverPlaceholder({ coverUrl, title }: { coverUrl: string | null; title: string }) {
  if (!coverUrl) {
    return <div className="grid aspect-video w-full place-items-center rounded-2xl bg-secondary" />;
  }
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
      <Image src={coverUrl} alt={title} fill unoptimized sizes="640px" className="object-cover" />
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
  continueHref,
  hasSave,
  title,
  coverUrl,
  freeToPlay,
  playersNow,
}: {
  gameId: string;
  playHref: string;
  /** Play link pre-pointed at the saved chapter when one exists. */
  continueHref: string;
  hasSave: boolean;
  title: string;
  coverUrl: string | null;
  freeToPlay: boolean;
  playersNow?: number;
}) {
  const t = useTranslations("games.store");
  const locale = useLocale() as Locale;
  const [wishlisted, setWishlisted] = useState(false);
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
        <div className="relative hidden aspect-video w-36 shrink-0 overflow-hidden rounded-lg bg-black sm:block">
          <Image
            src={coverUrl}
            alt={title}
            fill
            unoptimized
            sizes="144px"
            className="object-cover"
          />
        </div>
      ) : null}

      <div className="min-w-0">
        <h2 className="text-sm font-bold tracking-tight sm:text-base">{title}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          {freeToPlay ? (
            <span className="font-semibold text-[#3fbf87]">{t("freeToPlay")}</span>
          ) : null}
          {typeof playersNow === "number" ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <IconUsers className="size-3.5" stroke={1.8} />
              {t("playingNow", { count: playersNow.toLocaleString(locale) })}
            </span>
          ) : null}
        </p>
      </div>

      <div className="flex items-center gap-3 sm:ml-auto">
        {hasSave ? (
          <Link
            href={`${playHref}?restart=1`}
            className="hidden h-11 items-center rounded-full bg-white/[0.06] px-5 text-sm font-medium text-muted-foreground transition hover:bg-white/[0.1] hover:text-foreground sm:inline-flex"
          >
            {t("restartFromBeginning")}
          </Link>
        ) : null}
        <Link
          href={hasSave ? continueHref : playHref}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2.5 rounded-full bg-primary px-7 text-sm font-semibold text-white transition hover:bg-[#f03a3f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:flex-none"
        >
          <IconPlayerPlay className="size-4.5 fill-current" stroke={0} />
          {hasSave ? t("continuePlaying") : t("playNow")}
        </Link>

        <button
          type="button"
          onClick={() => setWishlisted((value) => !value)}
          aria-pressed={wishlisted}
          aria-label={wishlisted ? t("wishlisted") : t("wishlist")}
          title={wishlisted ? t("wishlisted") : t("wishlist")}
          className={`grid size-11 shrink-0 place-items-center rounded-full transition ${
            wishlisted
              ? "bg-primary/12 text-primary"
              : "bg-white/[0.06] text-muted-foreground hover:bg-white/[0.1] hover:text-foreground"
          }`}
        >
          <IconHeart
            className="size-4.5"
            stroke={1.8}
            fill={wishlisted ? "currentColor" : "none"}
          />
        </button>

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
