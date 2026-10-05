"use client";
import { useState } from "react";
import Link from "next/link";
import { ContentReportForm } from "../content/content-report-form";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { crewApi } from "../../crews/_hooks/api";
import { useCrewTask } from "../../crews/_hooks/use-tasks";
import { TaskDisputeControl } from "../../crews/_components/task-dispute-control";
import type { TrackingTask } from "../../crews/tasks/task-tracking-card";

export default function NewDispute() {
  const { user, isLoading } = useCurrentUser();
  const t = useTranslations("crewCases"),
    locale = useLocale();
  const auth = useAuthDialog();
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <Link href={`/${locale}/resolution-center`} className="text-sm text-muted-foreground">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("newCase")}</h1>
      {isLoading ? (
        <p role="status">{t("loading")}</p>
      ) : user ? (
        <ResolutionSession key={user.id} userId={user.id} />
      ) : (
        <Button onClick={() => auth.open()}>{t("signIn")}</Button>
      )}
    </main>
  );
}
function ResolutionSession({ userId }: { userId: string }) {
  const t = useTranslations("crewCases");
  const locale = useLocale();
  const client = useQueryClient();
  const [view, setView] = useState<"task" | "content" | "purchase">("task");
  const [contentVisited, setContentVisited] = useState(false);
  const [purchaseVisited, setPurchaseVisited] = useState(false);
  const [purchaseSubmitted, setPurchaseSubmitted] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <nav aria-label={t("relatedRecordType")} className="flex flex-wrap gap-2">
        <Button
          color="muted"
          variant={view === "task" ? "solid" : "ghost"}
          aria-pressed={view === "task"}
          onClick={() => setView("task")}
        >
          {t("taskRecordType")}
        </Button>
        <Button
          color="muted"
          variant={view === "content" ? "solid" : "ghost"}
          aria-pressed={view === "content"}
          onClick={() => {
            setContentVisited(true);
            setView("content");
          }}
        >
          {t("contentRecordType")}
        </Button>
        <Button
          color="muted"
          variant={view === "purchase" ? "solid" : "ghost"}
          aria-pressed={view === "purchase"}
          onClick={() => {
            setPurchaseVisited(true);
            setView("purchase");
          }}
        >
          {t("purchaseRecordType")}
        </Button>
      </nav>
      <div hidden={view !== "task"}>
        <DisputeTaskSelection userId={userId} />
      </div>
      {purchaseVisited && (
        <div hidden={view !== "purchase"}>
          {purchaseSubmitted ? (
            <div className="space-y-3">
              <p role="status">{t("contentReportSubmitted", { id: purchaseSubmitted })}</p>
              <Link
                href={`/${locale}/resolution-center/content`}
                className="text-sm underline underline-offset-4"
              >
                {t("viewContentReports")}
              </Link>
              <Button variant="ghost" color="muted" onClick={() => setPurchaseSubmitted(null)}>
                {t("anotherContentReport")}
              </Button>
            </div>
          ) : (
            <ContentReportForm
              purchase
              userId={userId}
              onClose={() => {
                setPurchaseVisited(false);
                setView("task");
              }}
              onSubmitted={(report) => {
                setPurchaseSubmitted(report.id);
                void client.invalidateQueries({ queryKey: ["my-content-reports", userId] });
              }}
            />
          )}
        </div>
      )}
      {contentVisited && (
        <div hidden={view !== "content"}>
          {submitted ? (
            <div className="space-y-3">
              <p role="status">{t("contentReportSubmitted", { id: submitted })}</p>
              <Link
                href={`/${locale}/resolution-center/content`}
                className="text-sm underline underline-offset-4"
              >
                {t("viewContentReports")}
              </Link>
              <Button variant="ghost" color="muted" onClick={() => setSubmitted(null)}>
                {t("anotherContentReport")}
              </Button>
            </div>
          ) : (
            <ContentReportForm
              userId={userId}
              onClose={() => {
                setContentVisited(false);
                setView("task");
              }}
              onSubmitted={(report) => {
                setSubmitted(report.id);
                void client.invalidateQueries({ queryKey: ["my-content-reports", userId] });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
function DisputeTaskSelection({ userId }: { userId: string }) {
  const t = useTranslations("crewCases");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("mine");
  const [taskId, setTaskId] = useState("");
  const tasks = useInfiniteQuery({
    queryKey: ["dispute-task-options", userId, scope, query],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      crewApi.get<{ items: TrackingTask[]; nextCursor: string | null }>("/crew-task-center", {
        signal,
        cache: "no-store",
        query: { scope, status: "all", limit: 30, cursor: pageParam, ...(query ? { query } : {}) },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const detail = useCrewTask(taskId, Boolean(taskId) && !tasks.isError);
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("selectTaskHint")}</p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setTaskId("");
          setQuery(search.trim());
        }}
      >
        <label className="grid flex-1 gap-1 text-sm" htmlFor="case-record-search">
          {t("recordSearch")}
          <Input
            id="case-record-search"
            value={search}
            maxLength={180}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("recordSearchHint")}
          />
        </label>
        <Button type="submit" disabled={tasks.isFetching}>
          {t("searchRecords")}
        </Button>
      </form>
      <nav className="flex gap-2">
        {(["mine", "managed"] as const).map((value) => (
          <Button
            key={value}
            variant={scope === value ? "solid" : "ghost"}
            color="muted"
            aria-pressed={scope === value}
            onClick={() => {
              setScope(value);
              setTaskId("");
            }}
          >
            {t(value === "managed" ? "producer" : value)}
          </Button>
        ))}
      </nav>
      {tasks.isPending ? <p role="status">{t("loading")}</p> : null}
      {tasks.error ? (
        <div role="alert">
          <p>{tasks.error.message}</p>
          <Button disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>
            {t("refresh")}
          </Button>
        </div>
      ) : (
        <NativeSelect aria-label={t("relatedTask")} value={taskId} onChange={setTaskId}>
          <NativeSelectOption value="">{t("relatedTask")}</NativeSelectOption>
          {tasks.data?.pages
            .flatMap((p) => p.items)
            .map((task) => (
              <NativeSelectOption key={task.id} value={task.id}>
                {task.crew.name} · {task.title}
              </NativeSelectOption>
            ))}
        </NativeSelect>
      )}
      {!tasks.isPending &&
        !tasks.isError &&
        !tasks.data?.pages.some((page) => page.items.length) && (
          <p className="text-sm text-muted-foreground">{t("noMatchingTasks")}</p>
        )}
      {tasks.hasNextPage && !tasks.isError ? (
        <Button disabled={tasks.isFetching} onClick={() => void tasks.fetchNextPage()}>
          {t("moreTasks")}
        </Button>
      ) : null}
      {taskId && !tasks.isError ? (
        detail.isError ? (
          <div role="alert">
            <p>{detail.error.message}</p>
            <Button onClick={() => void detail.refetch()}>{t("refresh")}</Button>
          </div>
        ) : detail.data ? (
          <TaskDisputeControl key={taskId} task={detail.data} initiallyOpen />
        ) : (
          <p role="status">{t("loading")}</p>
        )
      ) : null}
    </section>
  );
}
