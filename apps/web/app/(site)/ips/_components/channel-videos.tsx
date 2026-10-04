"use client";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/src/lib/api";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { CommunityVideoDialog } from "./community-video-dialog";
type Entry = {
  id: string;
  title: string;
  description: string;
  status: "pending" | "approved" | "rejected";
  version: number;
  url: string | null;
};
type Page = { items: Entry[]; canManage: boolean; nextCursor: string | null };
export function ChannelVideos({ ipId, open }: { ipId: string; open: boolean }) {
  const t = useTranslations("communityVideo");
  const { user } = useCurrentUser();
  const client = useQueryClient();
  const [dialog, setDialog] = useState(false);
  const endpoint = `/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}/video-submissions`;
  const query = useInfiniteQuery({
    queryKey: ["channel-videos", ipId, user?.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api.get<Page>(endpoint, { signal, cache: "no-store", params: { cursor: pageParam } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 240_000,
  });
  const decision = useMutation({
    mutationFn: ({ entry, status }: { entry: Entry; status: "approved" | "rejected" }) =>
      api.patch(endpoint, { data: { id: entry.id, expectedVersion: entry.version, status } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["channel-videos", ipId] });
    },
  });
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t("videos")}</h3>
        {open ? (
          <Button size="sm" variant="outline" onClick={() => setDialog(true)}>
            {t("title")}
          </Button>
        ) : null}
      </div>
      {query.isError ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : query.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : (
        query.data.pages
          .flatMap((page) => page.items)
          .map((entry) => (
            <article key={entry.id} className="space-y-2 rounded-lg bg-white/5 p-3">
              <h4 className="text-sm font-medium">{entry.title}</h4>
              {entry.url ? (
                <video
                  controls
                  preload="none"
                  src={entry.url}
                  className="aspect-video w-full rounded-md bg-black"
                  aria-label={entry.title}
                />
              ) : (
                <p className="text-xs text-muted-foreground">{t("moderation")}</p>
              )}
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {entry.description}
              </p>
              <p className="text-xs">{t(entry.status)}</p>
              {query.data.pages[0]?.canManage && entry.status === "pending" ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={decision.isPending}
                    onClick={() => decision.mutate({ entry, status: "approved" })}
                  >
                    {t("approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decision.isPending}
                    onClick={() => decision.mutate({ entry, status: "rejected" })}
                  >
                    {t("reject")}
                  </Button>
                </div>
              ) : null}
            </article>
          ))
      )}
      {decision.error ? <p role="alert">{decision.error.message}</p> : null}
      {query.hasNextPage ? (
        <Button
          variant="ghost"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("more")}
        </Button>
      ) : null}
      <CommunityVideoDialog open={dialog} onOpenChange={setDialog} />
    </section>
  );
}
