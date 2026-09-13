"use client";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";
type Game = {
  gameId: string;
  title: string;
  version: number;
  linked: boolean;
  linkedElsewhere: boolean;
};
type Page = { items: Game[]; nextCursor: string | null };
export function IpGameAssociations({ ipId }: { ipId: string }) {
  const { user } = useCurrentUser();
  return user ? <Editor key={`${user.id}:${ipId}`} ipId={ipId} account={user.id} /> : null;
}
function Editor({ ipId, account }: { ipId: string; account: string }) {
  const t = useTranslations("ipGameAssociations");
  const operation = useRef<AbortController | null>(null);
  const retries = useRef(
    new Map<string, { requestId: string; expectedVersion: number; active: boolean }>()
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}`;
  const query = useInfiniteQuery({
    queryKey: ["ip-owned-games", account, ipId],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      api.get<Page>(
        `${path}/owned-games${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        { signal, raw: true }
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = null;
    },
    []
  );
  async function change(game: Game) {
    if (operation.current || query.isFetching) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(null);
    const key = `${game.gameId}:${game.version}:${!game.linked}`;
    const request = retries.current.get(key) ?? {
      requestId: crypto.randomUUID(),
      expectedVersion: game.version,
      active: !game.linked,
    };
    retries.current.set(key, request);
    try {
      await api.post(`${path}/games/${encodeURIComponent(game.gameId)}`, {
        data: request,
        signal: controller.signal,
        raw: true,
      });
      if (controller.signal.aborted) return;
      retries.current.delete(key);
      await query.refetch();
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setPending(false);
      }
    }
  }
  const games = [
    ...new Map(
      query.data?.pages.flatMap((page) => page.items).map((game) => [game.gameId, game]) ?? []
    ).values(),
  ];
  const button = "min-h-11 rounded-full px-4 underline disabled:opacity-50";
  return (
    <section aria-label={t("title")} className="space-y-3 text-sm">
      <h3 className="font-medium">{t("title")}</h3>
      <p className="text-muted-foreground">{t("description")}</p>
      {query.isPending && <p role="status">{t("loading")}</p>}
      {(error || query.error) && (
        <p role="alert" className="text-red-400">
          {error || query.error?.message}
        </p>
      )}
      {query.data && !games.length && <p>{t("empty")}</p>}
      {games.map((game) => (
        <div
          key={game.gameId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/5 p-3"
        >
          <span className="min-w-0 break-words">{game.title}</span>
          {game.linkedElsewhere ? (
            <span>{t("elsewhere")}</span>
          ) : (
            <button
              className={button}
              disabled={pending || query.isFetching}
              onClick={() => void change(game)}
            >
              {t(game.linked ? "unlink" : "link")}
            </button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          disabled={pending || query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("refresh")}
        </button>
        {(query.hasNextPage || query.isFetchNextPageError) && (
          <button
            className={button}
            disabled={pending || query.isFetching}
            onClick={() => void query.fetchNextPage()}
          >
            {t(query.isFetchNextPageError ? "retry" : "more")}
          </button>
        )}
      </div>
    </section>
  );
}
