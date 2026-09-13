"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";
export function GameIpLink({ gameKey }: { gameKey: string }) {
  const { user } = useCurrentUser();
  const locale = useLocale();
  const t = useTranslations("ipGameAssociations");
  const gameId = gameKey.startsWith("interactive-film:")
    ? gameKey.slice("interactive-film:".length)
    : "";
  const eligible = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gameId);
  const query = useQuery({
    queryKey: ["tv-game-ip", user?.id ?? "guest", gameId],
    enabled: eligible,
    retry: false,
    queryFn: ({ signal }) =>
      api.get<{ ipId: string | null }>(
        `/aurora/ip-commerce/games/${encodeURIComponent(gameId)}/ip`,
        { signal, raw: true }
      ),
    staleTime: 0,
    gcTime: 0,
  });
  if (!eligible) return null;
  return (
    <div className="text-sm">
      {query.error ? (
        <div role="alert">
          {query.error.message}{" "}
          <button
            className="min-h-11 underline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </button>
        </div>
      ) : query.data?.ipId ? (
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={`/${locale}/ips/${encodeURIComponent(query.data.ipId)}`}
        >
          {t("viewIp")}
        </Link>
      ) : null}
    </div>
  );
}
