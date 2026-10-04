"use client";

import { useDeferredValue, useRef, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api } from "@/src/lib/api";
import {
  listIpCommerceIps,
  reportIpContent,
  type CreateIpReportInput,
} from "@/src/lib/ip-commerce/api";

type Report = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt: string;
  resolutionNote: string | null;
  description?: string | null;
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
        <ReportsSession key={user.id} userId={user.id} />
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
  const [view, setView] = useState<"initiated" | "responses">("initiated");
  const [creating, setCreating] = useState(false);
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ["my-content-reports", userId, view],
    retry: false,
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
        {(["initiated", "responses"] as const).map((tab) => (
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
        <ReportForm
          userId={userId}
          onClose={() => setCreating(false)}
          onSubmitted={() => {
            setCreating(false);
            setView("initiated");
            void client.invalidateQueries({ queryKey: ["my-content-reports", userId] });
          }}
        />
      ) : null}
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
                <p className="text-xs text-muted-foreground">{t("reference", { id: item.id })}</p>
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
      {query.isSuccess && !query.isError && !query.data.pages.some((page) => page.items.length) ? (
        <p className="py-8 text-sm text-muted-foreground">{t("empty")}</p>
      ) : null}
      {query.hasNextPage && !query.isError ? (
        <Button disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
          {t("more")}
        </Button>
      ) : null}
    </>
  );
}
function ReportForm({
  userId,
  onClose,
  onSubmitted,
}: {
  userId: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const t = useTranslations("contentReports"),
    reportT = useTranslations("newIpDetail.report"),
    locale = useLocale();
  const [search, setSearch] = useState("");
  const searchQuery = useDeferredValue(search.trim());
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState<CreateIpReportInput["reason"]>("copyright");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false),
    busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const results = useInfiniteQuery({
    queryKey: ["content-report-targets", userId, locale, searchQuery],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      listIpCommerceIps(
        { q: searchQuery || undefined, locale, cursor: pageParam, limit: 20 },
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  return (
    <form
      className="space-y-4 rounded-xl bg-white/[0.03] p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy.current || !targetId || results.isError) return;
        busy.current = true;
        setPending(true);
        setError(null);
        try {
          await reportIpContent({
            targetType: "ip",
            targetId,
            reason,
            description: description.trim() || undefined,
          });
          onSubmitted();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : reportT("failed"));
        } finally {
          busy.current = false;
          setPending(false);
        }
      }}
    >
      <h2 className="text-base font-semibold">{t("newReport")}</h2>
      <label className="block space-y-2 text-sm">
        <span>{t("search")}</span>
        <Input
          disabled={pending}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setTargetId("");
          }}
        />
      </label>
      {results.isPending ? <p role="status">{t("loading")}</p> : null}
      {results.error ? (
        <div role="alert">
          <p>{results.error.message}</p>
          <Button
            type="button"
            disabled={pending || results.isFetching}
            onClick={() => void results.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : (
        <label className="block space-y-2 text-sm">
          <span>{t("target")} *</span>
          <NativeSelect
            disabled={pending}
            value={targetId}
            onChange={setTargetId}
            aria-label={t("target")}
          >
            <NativeSelectOption value="">{t("selectTarget")}</NativeSelectOption>
            {results.data?.pages
              .flatMap((page) => page.items)
              .map((ip) => (
                <NativeSelectOption key={ip.id} value={ip.id}>
                  {ip.title} · {ip.roomNumber}
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </label>
      )}
      {results.hasNextPage && !results.isError ? (
        <Button
          type="button"
          disabled={pending || results.isFetching}
          onClick={() => void results.fetchNextPage()}
        >
          {t("more")}
        </Button>
      ) : null}
      <label className="block space-y-2 text-sm">
        <span>{reportT("reason")} *</span>
        <NativeSelect
          disabled={pending}
          value={reason}
          onChange={(value) => setReason(value as CreateIpReportInput["reason"])}
        >
          {(
            [
              "copyright",
              "unsafe_content",
              "fraud",
              "misleading",
              "privacy",
              "harassment",
              "other",
            ] as const
          ).map((key) => (
            <NativeSelectOption key={key} value={key}>
              {reportT(`reasons.${key}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="block space-y-2 text-sm">
        <span>{reportT("description")}</span>
        <Textarea
          disabled={pending}
          value={description}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t("evidenceHint")}
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" color="muted" variant="ghost" disabled={pending} onClick={onClose}>
          {reportT("cancel")}
        </Button>
        <Button type="submit" disabled={pending || !targetId || results.isError}>
          {reportT(pending ? "submitting" : "submit")}
        </Button>
      </div>
    </form>
  );
}
