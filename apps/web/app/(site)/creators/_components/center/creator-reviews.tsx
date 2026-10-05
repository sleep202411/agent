"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { IconStarFilled } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { creatorHref, encodeUserId } from "@/src/lib/user-id-codec";
import { useCreatorDetail } from "../../_hooks/use-creator";
import { useCreatorReviews, type CreatorReview } from "../../_hooks/use-creator-reviews";

export function CreatorReviews({
  creatorId,
  children,
}: {
  creatorId: string;
  children: ReactNode;
}) {
  const t = useTranslations("creatorReviews"),
    locale = useLocale();
  const query = useCreatorReviews(creatorId);
  const readable = !query.isError || query.isFetchNextPageError;
  const summary = readable ? query.data?.pages[0]?.summary : undefined;
  const rows = readable
    ? [
        ...new Map(
          (query.data?.pages.flatMap((page) => page.items) ?? []).map((row) => [row.id, row])
        ).values(),
      ]
    : [];
  return (
    <div className="space-y-8">
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(["creator", "manager"] as const).map((direction) => (
            <section
              key={direction}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted/30 p-5"
              aria-label={t(direction)}
            >
              <div>
                <h3 className="font-semibold">{t(direction)}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t(`${direction}Hint`)}</p>
              </div>
              <div className="space-y-1">
                <Stars value={summary[direction].average} />
                <p className="text-xs text-muted-foreground">
                  {t("reviewCount", { count: summary[direction].count })}
                </p>
              </div>
            </section>
          ))}
        </div>
      )}
      <section className="space-y-4" aria-label={t("services")}>
        <h3 className="text-lg font-semibold">{t("services")}</h3>
        {children}
      </section>
      <section className="space-y-5" aria-label={t("reviews")}>
        <h3 className="text-lg font-semibold">{t("reviews")}</h3>
        {query.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("loading")}
          </p>
        )}
        {query.error && (
          <div role="alert" className="space-y-2 text-sm">
            <p>{query.error.message}</p>
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() =>
                void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
              }
            >
              {t("retry")}
            </Button>
          </div>
        )}
        {summary && (
          <>
            <div className="flex flex-wrap items-center gap-8 rounded-xl bg-muted/30 p-5">
              <div className="space-y-2">
                <p className="text-3xl font-semibold tabular-nums">
                  {summary.average === null
                    ? "—"
                    : summary.average.toLocaleString(locale, { maximumFractionDigits: 2 })}
                </p>
                <Stars value={summary.average} />
                <p className="text-xs text-muted-foreground">{t("overall")}</p>
              </div>
              <div className="min-w-36 flex-1 space-y-1" aria-label={t("distribution")}>
                {[5, 4, 3, 2, 1].map((star) => (
                  <div key={star} className="flex items-center gap-2 text-xs">
                    <span>{star}</span>
                    <div className="h-1.5 flex-1 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-[#FFD84D]"
                        style={{
                          width: `${summary.total ? (100 * (summary.histogram[star - 1] ?? 0)) / summary.total : 0}%`,
                        }}
                      />
                    </div>
                    <span className="w-7 text-right tabular-nums">
                      {summary.histogram[star - 1] ?? 0}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-sm">{t("reviewCount", { count: summary.total })}</p>
            </div>
            {summary.total === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
          </>
        )}
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <Review key={row.id} row={row} />
          ))}
        </div>
        {query.hasNextPage && !query.isError && (
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.fetchNextPage()}
          >
            {t("more")}
          </Button>
        )}
      </section>
    </div>
  );
}
function Stars({ value }: { value: number | null }) {
  const t = useTranslations("creatorReviews"),
    locale = useLocale();
  if (value === null) return <span className="text-sm text-muted-foreground">{t("unrated")}</span>;
  const label = t("score", { value: value.toLocaleString(locale, { maximumFractionDigits: 2 }) });
  return (
    <span role="img" aria-label={label} className="relative inline-flex align-middle">
      <span aria-hidden="true" className="inline-flex text-muted-foreground/25">
        {[1, 2, 3, 4, 5].map((star) => (
          <IconStarFilled key={star} className="size-5 shrink-0" />
        ))}
      </span>
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 inline-flex overflow-hidden text-[#FFD84D]"
        style={{ width: `${Math.max(0, Math.min(5, value)) * 20}%` }}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <IconStarFilled key={star} className="size-5 shrink-0" />
        ))}
      </span>
    </span>
  );
}
function Review({ row }: { row: CreatorReview }) {
  const t = useTranslations("creatorReviews"),
    locale = useLocale();
  const author = useCreatorDetail(row.authorUserId);
  return (
    <article className="space-y-3 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            className="text-sm font-medium hover:underline"
            href={`/${locale}${creatorHref(row.authorUserId)}`}
          >
            {author.data?.name || t("reviewer", { id: encodeUserId(row.authorUserId) })}
          </Link>
          <p className="text-xs text-muted-foreground">{t(row.direction)}</p>
        </div>
        <time className="text-xs text-muted-foreground" dateTime={row.createdAt}>
          {new Date(row.createdAt).toLocaleDateString(locale)}
        </time>
      </header>
      <Stars value={row.scoreMilli / 1000} />
      {row.comment && (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{row.comment}</p>
      )}
      {row.timelinessScore !== null && (
        <p className="text-xs text-muted-foreground">
          {t("timeliness", { score: row.timelinessScore })}
        </p>
      )}
    </article>
  );
}
