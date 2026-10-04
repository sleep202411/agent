"use client";

import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";

type Block = {
  id: string;
  targetType: "ip" | "creator" | "crew";
  targetId: string;
  title: string | null;
  createdAt: string;
};

export function BlockedContent({ userId }: { userId: string }) {
  const t = useTranslations("contentReports");
  const locale = useLocale();
  const client = useQueryClient();
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
    },
    []
  );
  const key = ["my-content-blocks", userId, locale];
  const query = useInfiniteQuery({
    queryKey: key,
    retry: false,
    gcTime: 0,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api.get<{ items: Block[]; nextCursor: string | null }>("/aurora/ip-commerce/me/blocks", {
        signal,
        params: { cursor: pageParam, limit: 20, locale },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  async function unblock(item: Block) {
    if (request.current || query.isFetching || query.isError) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(item.id);
    setError(null);
    try {
      await api.delete(`/aurora/ip-commerce/me/blocks/${encodeURIComponent(item.id)}`, {
        signal: controller.signal,
      });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      if (!controller.signal.aborted) {
        // Reconcile even a lost reply before allowing another mutation.
        await Promise.all([
          client.invalidateQueries({ queryKey: key, exact: true }),
          client.invalidateQueries({ queryKey: ["ip-commerce"] }),
          client.invalidateQueries({ queryKey: ["content-gps-cards", userId] }),
          client.invalidateQueries({ queryKey: ["content-gps-overview", userId] }),
        ]);
        if (!controller.signal.aborted) {
          setBusy(null);
          request.current = null;
        }
      }
    }
  }
  return (
    <section className="space-y-4" aria-label={t("blocked")}>
      <p className="text-sm text-muted-foreground">{t("blockedHint")}</p>
      {query.isPending ? <p role="status">{t("loading")}</p> : null}
      {error ? (
        <p role="alert" className="text-sm">
          {error.message}
        </p>
      ) : null}
      {query.error ? (
        <div role="alert" className="space-y-2">
          <p>{query.error.message}</p>
          <Button color="muted" disabled={query.isFetching} onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {!query.isError ? (
        <ul className="divide-y divide-white/10">
          {query.data?.pages
            .flatMap((page) => page.items)
            .map((item) => (
              <li key={item.id} className="flex items-center gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold">
                    {item.title ||
                      t(
                        item.targetType === "ip"
                          ? "blockedIp"
                          : item.targetType === "crew"
                            ? "blockedCrew"
                            : "blockedCreator"
                      )}
                  </p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {t("reference", { id: item.targetId })}
                  </p>
                </div>
                <Button
                  color="muted"
                  disabled={Boolean(busy) || query.isFetching}
                  onClick={() => void unblock(item)}
                >
                  {t(busy === item.id ? "unblocking" : "unblock")}
                </Button>
              </li>
            ))}
        </ul>
      ) : null}
      {query.isSuccess && !query.isError && !query.data.pages.some((page) => page.items.length) ? (
        <p className="py-8 text-sm text-muted-foreground">{t("blockedEmpty")}</p>
      ) : null}
      {query.hasNextPage && !query.isError ? (
        <Button
          color="muted"
          disabled={Boolean(busy) || query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {t("more")}
        </Button>
      ) : null}
    </section>
  );
}
