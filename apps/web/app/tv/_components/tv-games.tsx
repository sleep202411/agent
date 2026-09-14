"use client";
import { IconDeviceGamepad, IconSearch } from "@tabler/icons-react";
import { Fragment, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/src/lib/api";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { parseTvGames, type TvGameKind } from "../_hooks/tv-games";

import { GameIpLink } from "./game-ip-link";

export function TvGames() {
  const { user } = useCurrentUser();
  return <GameCatalog key={user?.id ?? "guest"} account={user?.id ?? "guest"} />;
}
function GameCatalog({ account }: { account: string }) {
  const t = useTranslations("tvGames");
  const catalogText = useTranslations("games");
  const locale = useLocale() as Locale;
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const queries = useQueries({
    queries: (["interactive-film", "text-game"] as TvGameKind[]).map((kind) => ({
      queryKey: ["tv-games", account, kind],
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        parseTvGames(
          kind,
          await api.get<unknown>(
            `/api/player/${kind}${kind === "interactive-film" ? "/games" : ""}`,
            { signal }
          )
        ),
      staleTime: 60_000,
      retry: false,
    })),
  });
  const games = queries.flatMap((query) => query.data ?? []);
  const filtered = games.filter((game) =>
    game.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  const game = games.find((entry) => entry.id === selected);
  const ownsLibrary = game?.id.startsWith("text-game:") ?? false;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col text-sm lg:flex-row">
      {!ownsLibrary && (
        <aside
          className="min-w-0 shrink-0 border-b border-white/[0.06] lg:w-[280px] lg:overflow-y-auto lg:border-b-0 lg:border-r"
          aria-label={t("catalog")}
        >
          <header className="space-y-2 border-b border-white/[0.06] px-3 py-2">
            <h2 className="flex h-9 items-center text-sm font-semibold text-white">{t("games")}</h2>
            <label className="relative block">
              <IconSearch
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/35"
              />
              <input
                type="search"
                aria-label={t("search")}
                placeholder={t("search")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-11 w-full rounded-md border border-white/10 bg-white/[0.04] py-1.5 pl-8 pr-3 text-sm text-white placeholder:text-white/35 outline-none focus-visible:border-white/30 focus-visible:ring-1 focus-visible:ring-white/20 lg:h-9"
              />
            </label>
          </header>
          <div className="max-h-72 space-y-1 overflow-y-auto p-2 lg:max-h-none">
            {queries.some((query) => query.isPending) && <p role="status">{t("loading")}</p>}
            {queries.some((query) => query.isError) && (
              <div role="alert">
                <p>{t("failed")}</p>
                <button
                  type="button"
                  onClick={() => {
                    for (const query of queries) void query.refetch();
                  }}
                  className="min-h-11 underline"
                >
                  {t("retry")}
                </button>
              </div>
            )}
            {!queries.some((query) => query.isPending || query.isError) && !filtered.length && (
              <p>{t("empty")}</p>
            )}
            {filtered.map((entry, index) => (
              <Fragment key={entry.id}>
                {(index === 0 ||
                  filtered[index - 1]?.id.split(":")[0] !== entry.id.split(":")[0]) && (
                  <h3 className="px-3 pb-1 pt-3 text-xs font-semibold text-white/50">
                    {catalogText(
                      entry.id.startsWith("interactive-film:") ? "films.title" : "textGames.title"
                    )}
                  </h3>
                )}
                <button
                  type="button"
                  key={entry.id}
                  aria-pressed={game?.id === entry.id}
                  onClick={() => setSelected(entry.id)}
                  aria-label={entry.title}
                  title={entry.title}
                  className="flex min-h-16 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-white/80 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-pressed:bg-white/[0.08] aria-pressed:text-white"
                >
                  <GameCover key={`${entry.id}:${entry.coverUrl ?? ""}`} url={entry.coverUrl} />
                  <span className="min-w-0 flex-1 line-clamp-2 break-words text-sm font-medium leading-5">
                    {entry.title}
                  </span>
                </button>
              </Fragment>
            ))}
          </div>
        </aside>
      )}
      <section className="flex min-w-0 flex-1 flex-col gap-3 p-4" aria-label={t("player")}>
        {game ? (
          <>
            {ownsLibrary ? (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="min-h-11 self-start rounded-full px-3 text-sm text-white/70 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
              >
                {t("backToGames")}
              </button>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="min-w-0 break-words text-lg font-semibold">{game.title}</h2>
                  <Link
                    className="flex min-h-11 shrink-0 items-center text-sm underline"
                    href={localizePath(game.href, locale)}
                  >
                    {t("open")}
                  </Link>
                </div>
                <GameIpLink gameKey={game.id} />
              </>
            )}
            <iframe
              key={game.id}
              src={localizePath(game.href, locale)}
              title={ownsLibrary ? t("player") : game.title}
              allow="fullscreen"
              allowFullScreen
              className="min-h-[65dvh] w-full flex-1 border-0"
            />
          </>
        ) : (
          <p className="p-6 text-white/60">{t("choose")}</p>
        )}
      </section>
    </div>
  );
}

function GameCover({ url }: { url?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden
      className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/[0.06] text-white/35"
    >
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <IconDeviceGamepad className="size-5" />
      )}
    </span>
  );
}
