"use client";
import { useState } from "react";
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
  const locale = useLocale() as Locale;
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const queries = useQueries({
    queries: (["text-game", "interactive-film"] as TvGameKind[]).map((kind) => ({
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
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:flex-row">
      <aside className="space-y-3 md:w-72 md:shrink-0 md:overflow-y-auto" aria-label={t("catalog")}>
        <input
          aria-label={t("search")}
          placeholder={t("search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded-lg bg-white/10 p-3 text-white"
        />
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
        {filtered.map((entry) => (
          <button
            type="button"
            key={entry.id}
            aria-pressed={game?.id === entry.id}
            onClick={() => setSelected(entry.id)}
            className="block min-h-11 w-full rounded-lg bg-white/5 p-3 text-left text-white hover:bg-white/15 aria-pressed:bg-white/20"
          >
            {entry.title}
          </button>
        ))}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col gap-3" aria-label={t("player")}>
        {game ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2>{game.title}</h2>
              <Link className="min-h-11 underline" href={localizePath(game.href, locale)}>
                {t("open")}
              </Link>
            </div>
            <GameIpLink gameKey={game.id} />
            <iframe
              key={game.id}
              src={localizePath(game.href, locale)}
              title={game.title}
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
