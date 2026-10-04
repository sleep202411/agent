"use client";
import { ChannelVideos } from "./channel-videos";
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/src/lib/api";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { listMyIpCommerceIps } from "@/src/lib/ip-commerce/api";
import { localizePath } from "@/src/i18n/locale-url";
import { ipRoomPath } from "@/src/lib/ip-commerce/urls";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/src/i18n/config";

type Entry = {
  workId: string;
  title: string;
  roomNumber: string;
  status: "pending" | "approved" | "rejected";
  version: number;
};
type Page = {
  community: boolean;
  open: boolean;
  canManage: boolean;
  items: Entry[];
  nextCursor?: string | null;
};
export function ChannelSubmissions({ ipId }: { ipId: string }) {
  const { user } = useCurrentUser();
  return (
    <ChannelContents
      key={`${ipId}:${user?.id ?? "guest"}`}
      ipId={ipId}
      signedIn={!!user}
      viewer={user?.id ?? "guest"}
    />
  );
}
function ChannelContents({
  ipId,
  signedIn,
  viewer,
}: {
  ipId: string;
  signedIn: boolean;
  viewer: string;
}) {
  const t = useTranslations("channelSubmissions");
  const locale = useLocale() as Locale;
  const client = useQueryClient();
  const auth = useAuthDialog();
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState("");
  const endpoint = `/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}/submissions`;
  const key = ["channel-submissions", ipId, viewer, locale];
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api.get<Page>(endpoint, { signal, cache: "no-store", params: { locale, cursor: pageParam } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const mine = useInfiniteQuery({
    queryKey: ["channel-submit-works", viewer, locale],
    enabled: signedIn && choosing,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      listMyIpCommerceIps({ locale, cursor: pageParam, limit: 50 }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const mutation = useMutation({
    mutationFn: (
      action:
        | { kind: "submit"; workId: string }
        | { kind: "settings"; open: boolean }
        | { kind: "review"; entry: Entry; status: "approved" | "rejected" }
    ) => {
      if (action.kind === "submit") return api.post(endpoint, { data: { workId: action.workId } });
      if (action.kind === "settings")
        return api.patch(`${endpoint}/settings`, { data: { open: action.open } });
      return api.patch(endpoint, {
        data: {
          workId: action.entry.workId,
          status: action.status,
          expectedVersion: action.entry.version,
        },
      });
    },
    onSuccess: async () => {
      setChoosing(false);
      setSelected("");
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const data = query.data?.pages[0];
  if (query.isError && !query.isFetchNextPageError)
    return (
      <p role="alert">
        {query.error.message}
        <Button onClick={() => query.refetch()}>{t("retry")}</Button>
      </p>
    );
  if (!data?.community) return null;
  const entries = query.data!.pages.flatMap((page) => page.items);
  const works =
    mine.data?.pages
      .flatMap((page) => page.items)
      .filter(
        (work) =>
          work.id !== ipId && work.status === "published" && work.listingVisibility === "public"
      ) ?? [];
  return (
    <section className="space-y-4 rounded-xl border border-white/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <span className="text-sm text-white/60">{t(data.open ? "open" : "closed")}</span>
      </div>
      <p className="text-sm text-white/60">{t("description")}</p>
      {data.canManage && (
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ kind: "settings", open: !data.open })}
        >
          {t(data.open ? "close" : "enable")}
        </Button>
      )}
      {data.open && (
        <Button
          disabled={mutation.isPending}
          onClick={() => (signedIn ? setChoosing(!choosing) : auth.open())}
        >
          {t("submit")}
        </Button>
      )}
      {choosing && data.open && (
        <div className="space-y-3">
          <label className="block">
            {t("choose")}
            <NativeSelect
              className="mt-2 block w-full rounded-md border border-white/20 bg-neutral-900 p-2"
              value={selected}
              disabled={mutation.isPending}
              onChange={setSelected}
            >
              <option value="">{t("choose")}</option>
              {works.map((work) => (
                <option key={work.id} value={work.id}>
                  {work.title}
                </option>
              ))}
            </NativeSelect>
          </label>
          {mine.isLoading && <p>{t("loading")}</p>}
          {mine.isError && (
            <div role="alert">
              <p>{mine.error.message}</p>
              {!mine.isFetchNextPageError && (
                <Button disabled={mine.isFetching} onClick={() => mine.refetch()}>
                  {t("retry")}
                </Button>
              )}
            </div>
          )}
          {!mine.isLoading && !mine.isError && !works.length && <p>{t("noWorks")}</p>}
          {mine.hasNextPage && (
            <Button disabled={mine.isFetchingNextPage} onClick={() => mine.fetchNextPage()}>
              {t(mine.isFetchNextPageError ? "retry" : "more")}
            </Button>
          )}
          <Button
            disabled={!works.some((work) => work.id === selected) || mutation.isPending}
            onClick={() => mutation.mutate({ kind: "submit", workId: selected })}
          >
            {t("send")}
          </Button>
        </div>
      )}
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
      {!entries.length && <p className="text-sm text-white/60">{t("empty")}</p>}
      <ul className="space-y-3">
        {entries.map((entry) => (
          <li
            key={entry.workId}
            className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3"
          >
            <Link
              className="flex-1 hover:underline"
              href={localizePath(ipRoomPath(entry.roomNumber), locale)}
            >
              {entry.title}
            </Link>
            <span className="text-sm text-white/60">{t(entry.status)}</span>
            {data.canManage && entry.status === "pending" && (
              <>
                <Button
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ kind: "review", entry, status: "approved" })}
                >
                  {t("approve")}
                </Button>
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ kind: "review", entry, status: "rejected" })}
                >
                  {t("reject")}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {query.isFetchNextPageError && <p role="alert">{query.error.message}</p>}
      {query.hasNextPage && (
        <Button disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          {t(query.isFetchNextPageError ? "retry" : "more")}
        </Button>
      )}
      <ChannelVideos ipId={ipId} open={data.open} />
    </section>
  );
}
