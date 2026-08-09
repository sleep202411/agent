"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconBook2,
  IconHeadphones,
  IconLoader2,
  IconPhoto,
  IconPlayerPlay,
  IconUser,
} from "@tabler/icons-react";
import type { TextGameDetail as TextGameDetailData } from "@repo/shared/text-game";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/src/hooks/use-user";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import {
  getPlayingTextGameSession,
  playerTextGameKeys,
} from "@/app/play/text-game/_lib/text-game-player-api";

export function TextGameDetail({ game }: { game: TextGameDetailData }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("textGame");
  const router = useRouter();
  const { open: openAuth } = useAuthDialog();
  const { user, isLoading: userLoading } = useCurrentUser();
  const content = game.content;
  const playHref = localizePath(`/play/text-game/${encodeURIComponent(game.gameId)}`, locale);
  const sessionQuery = useQuery({
    // Keep this availability probe separate from the player session cache.
    // A successful `data: null` here must not suppress the player's
    // load-or-start query when the reader enters the game.
    queryKey: playerTextGameKeys.progress(game.gameId),
    queryFn: () => getPlayingTextGameSession(game.gameId),
    enabled: Boolean(user),
    staleTime: 20_000,
    retry: false,
  });

  function enterGame() {
    if (user) {
      router.push(playHref);
      return;
    }
    openAuth({ mode: "stay", onSuccess: () => router.push(playHref) });
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-5 pt-6 pb-20 sm:px-8">
        <Button asChild variant="ghost" color="muted" className="text-muted-foreground">
          <Link href={localizePath("/games", locale)}>
            <IconArrowLeft className="size-4" />
            {t("detail.back")}
          </Link>
        </Button>

        <section className="mt-8 grid items-start gap-10 lg:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.4fr)] lg:gap-16">
          <div className="relative aspect-video overflow-hidden rounded-3xl bg-secondary/60 ring-1 ring-foreground/8">
            {content.posterUrl ? (
              <Image
                src={content.posterUrl}
                alt={content.name || t("untitled")}
                fill
                loading="eager"
                fetchPriority="high"
                unoptimized
                sizes="(min-width: 1024px) 38vw, 100vw"
                className="object-cover"
              />
            ) : null}
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/70 to-transparent" />
            <p className="absolute right-6 bottom-6 left-6 text-xs font-semibold tracking-[0.18em] text-white/70 uppercase">
              {t("detail.publishedWork")}
            </p>
          </div>

          <div className="pt-1 lg:pt-8">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-primary uppercase">
              <IconBook2 className="size-4" />
              {t("detail.eyebrow")}
            </p>
            <h1 className="mt-4 text-2xl leading-8 font-semibold tracking-[-0.02em]">
              {content.name || t("untitled")}
            </h1>
            {content.synopsis ? (
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                {content.synopsis}
              </p>
            ) : null}

            <div className="mt-8 flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
              {content.characters.length > 0 ? (
                <span className="rounded-full bg-secondary px-3 py-1.5">
                  {t("detail.characterCount", { count: content.characters.length })}
                </span>
              ) : null}
              {content.stillUrls.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5">
                  <IconPhoto className="size-3.5" />
                  {t("detail.stillCount", { count: content.stillUrls.length })}
                </span>
              ) : null}
              {content.bgmUrl ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5">
                  <IconHeadphones className="size-3.5" />
                  {t("detail.soundtrack")}
                </span>
              ) : null}
            </div>

            {sessionQuery.isError ? (
              <p role="alert" className="mt-5 text-sm text-destructive">
                {sessionQuery.error instanceof Error
                  ? sessionQuery.error.message
                  : t("detail.progressUnavailable")}
              </p>
            ) : null}

            <Button
              size="lg"
              className="mt-8 h-12 rounded-full px-7 text-base"
              onClick={enterGame}
              disabled={userLoading || (Boolean(user) && sessionQuery.isLoading)}
            >
              {userLoading || (Boolean(user) && sessionQuery.isLoading) ? (
                <IconLoader2 className="size-5 animate-spin" />
              ) : (
                <IconPlayerPlay className="size-5" />
              )}
              {sessionQuery.data ? t("detail.continue") : t("detail.start")}
            </Button>
          </div>
        </section>

        {content.characters.length > 0 ? (
          <section className="mt-20" aria-labelledby="cast-heading">
            <div className="max-w-2xl">
              <h2 id="cast-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                {t("detail.castTitle")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t("detail.castDescription")}
              </p>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {content.characters.map((character) => (
                <article
                  key={character.id}
                  className="flex min-w-0 items-center gap-4 rounded-2xl bg-secondary/48 p-4 ring-1 ring-foreground/6"
                >
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-full bg-secondary">
                    {character.avatarUrl ? (
                      <Image
                        src={character.avatarUrl}
                        alt=""
                        fill
                        unoptimized
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="grid size-full place-items-center text-muted-foreground">
                        <IconUser className="size-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{character.name}</h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                      {character.intro}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {content.stillUrls.length > 0 ? (
          <section className="mt-20" aria-labelledby="stills-heading">
            <h2 id="stills-heading" className="text-2xl font-semibold tracking-[-0.025em]">
              {t("detail.stillsTitle")}
            </h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {content.stillUrls.map((url, index) => (
                <div
                  key={`${url}-${index}`}
                  className="relative aspect-video overflow-hidden rounded-2xl bg-secondary ring-1 ring-foreground/6"
                >
                  <Image
                    src={url}
                    alt={t("detail.stillAlt", { index: index + 1 })}
                    fill
                    unoptimized
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
