"use client";

import { useState } from "react";
import Link from "next/link";
import { BlockedContent } from "./blocked-content";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { api } from "@/src/lib/api";
import { ContentReportForm } from "./content-report-form";

type Report = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt: string;
  resolutionNote: string | null;
  description?: string | null;
  purchaseOrderId?: string | null;
};
export default function ContentReports() {
  const { user, isLoading } = useCurrentUser();
  const t = useTranslations("contentReports"),
    locale = useLocale();
  const auth = useAuthDialog();
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
      <Link href={`/${locale}/resolution-center`} className="text-sm text-muted-foreground">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {isLoading ? (
        <p role="status">{t("loading")}</p>
      ) : user ? (
        <ReportsSession key={`${user.id}:${locale}`} userId={user.id} />
      ) : (
        <Button onClick={() => auth.open()}>{t("signIn")}</Button>
      )}
    </main>
  );
}
function ReportsSession({ userId }: { userId: string }) {
  const t = useTranslations("contentReports"),
    reportT = useTranslations("newIpDetail.report"),
    locale = useLocale();
  const [view, setView] = useState<"initiated" | "responses" | "blocked">("initiated");
  const [creating, setCreating] = useState(false);
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ["my-content-reports", userId, view],
    retry: false,
    enabled: view !== "blocked",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api.get<{ items: Report[]; nextCursor: string | null }>("/aurora/ip-commerce/me/reports", {
        signal,
        params: { view, cursor: pageParam, limit: 20 },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  return (
    <>
      <nav className="flex flex-wrap gap-2 border-b border-white/10 pb-3" aria-label={t("title")}>
        {(["initiated", "responses", "blocked"] as const).map((tab) => (
          <Button
            key={tab}
            color="muted"
            variant="ghost"
            className={view === tab ? "bg-white/10 text-white" : "text-muted-foreground"}
            aria-pressed={view === tab}
            onClick={() => setView(tab)}
          >
            {t(tab)}
          </Button>
        ))}
        <Button className="ml-auto" onClick={() => setCreating(true)}>
          {t("newReport")}
        </Button>
      </nav>
      {creating ? (
        <ContentReportForm
          userId={userId}
          onClose={() => setCreating(false)}
          onSubmitted={() => {
            setCreating(false);
            setView("initiated");
            void client.invalidateQueries({ queryKey: ["my-content-reports", userId] });
          }}
        />
      ) : null}
      {view === "blocked" ? (
        <BlockedContent userId={userId} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t(view === "responses" ? "responsesHint" : "initiatedHint")}
          </p>
          {query.isPending ? <p role="status">{t("loading")}</p> : null}
          {query.error ? (
            <div role="alert">
              <p>{query.error.message}</p>
              <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
                {t("retry")}
              </Button>
            </div>
          ) : null}
          {!query.isError ? (
            <ul className="divide-y divide-white/10">
              {query.data?.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <li key={item.id} className="space-y-2 py-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-sm font-semibold">{reportT(`reasons.${item.reason}`)}</h2>
                      <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs">
                        {t(`status.${item.status}`)}
                      </span>
                      <time className="ml-auto text-xs text-muted-foreground">
                        {new Date(item.createdAt).toLocaleDateString(locale)}
                      </time>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("reference", { id: item.id })}
                    </p>
                    {item.purchaseOrderId ? (
                      <p className="break-all text-xs text-muted-foreground">
                        {t("purchaseReference", { id: item.purchaseOrderId })}
                      </p>
                    ) : null}
                    {item.description ? (
                      <p className="whitespace-pre-wrap break-words text-sm">{item.description}</p>
                    ) : null}
                    {item.resolutionNote ? (
                      <p className="whitespace-pre-wrap break-words rounded-lg bg-white/5 p-3 text-sm">
                        {item.resolutionNote}
                      </p>
                    ) : null}
                  </li>
                ))}
            </ul>
          ) : null}
          {query.isSuccess &&
          !query.isError &&
          !query.data.pages.some((page) => page.items.length) ? (
            <p className="py-8 text-sm text-muted-foreground">{t("empty")}</p>
          ) : null}
          {query.hasNextPage && !query.isError ? (
            <Button disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
              {t("more")}
            </Button>
          ) : null}
        </>
      )}
    </>
  );
}
