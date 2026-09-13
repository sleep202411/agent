"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { useTranslations } from "@/src/i18n/i18n";
type Entry = {
  taskId: string;
  submissionId: string;
  points: number;
  submittedAt: string;
  recordedAt: string;
  deadline: string;
};
export function CrewTrustHistory({ userId }: { userId: string }) {
  const t = useTranslations("crewTrustHistory");
  const query = useInfiniteQuery({
    queryKey: ["crew-trust-history", userId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api.get<{ items: Entry[]; nextCursor: string | null }>("/aurora/me/crew-trust/entries", {
        signal,
        params: { cursor: pageParam, limit: 20 },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="space-y-2 text-sm">
      <h3 className="font-medium">{t("title")}</h3>
      {query.isPending ? <p role="status">{t("loading")}</p> : null}
      {query.isError ? (
        <div role="alert">
          {query.error.message}{" "}
          <button
            className="underline"
            disabled={query.isFetching}
            onClick={() =>
              void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
            }
          >
            {t("retry")}
          </button>
        </div>
      ) : null}
      {items.map((item) => (
        <article key={item.taskId} className="space-y-1 py-2">
          <p className="font-semibold">
            {item.points > 0 ? "+" : ""}
            {item.points}
          </p>
          <p>
            {t("task")}: <span className="font-mono break-all">{item.taskId}</span>
          </p>
          <p>
            {t("submission")}: <span className="font-mono break-all">{item.submissionId}</span>
          </p>
          <p>
            {t("submitted")}:{" "}
            <time dateTime={item.submittedAt}>{new Date(item.submittedAt).toLocaleString()}</time>
          </p>
          <p>
            {t("deadline")}:{" "}
            <time dateTime={item.deadline}>{new Date(item.deadline).toLocaleString()}</time>
          </p>
        </article>
      ))}
      {!query.isPending && !query.isError && !items.length ? <p>{t("empty")}</p> : null}
      {query.hasNextPage ? (
        <button
          type="button"
          className="min-h-11 underline"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
        >
          {t("more")}
        </button>
      ) : null}
    </div>
  );
}
