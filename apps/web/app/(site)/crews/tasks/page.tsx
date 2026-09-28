"use client";

import { CrewSectionNavigation } from "../_components/crew-section-navigation";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useInfiniteQuery } from "@tanstack/react-query";
import { TaskUnreadMarker } from "../_components/task-unread-marker";
import { crewKeys } from "../_hooks/shared";
import { crewApi } from "../_hooks/api";
import type { CrewTaskPriority, CrewTaskStatus } from "../_hooks/use-crew";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { TaskDeadline } from "../_components/task-deadline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

interface TaskPage {
  items: Array<{
    id: string;
    title: string;
    number: number;
    status: CrewTaskStatus;
    workflowState: { name: string; systemKey: string | null; semantic: CrewTaskStatus };
    priority: CrewTaskPriority;
    dueAt: string | null;
    crew: { id: string; name: string };
  }>;
  nextCursor: string | null;
}

export default function CrewTaskCenter() {
  const deadlineT = useTranslations("crewDeadline");
  const [warningHours, setWarningHours] = useState(48);
  const t = useTranslations("crewTaskCenter");
  const { user, isLoading: authLoading } = useCurrentUser();
  const { open: openAuthDialog } = useAuthDialog();
  const taskT = useTranslations("crewTasks");
  const locale = useLocale() as Locale;
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());
  const feed = useInfiniteQuery({
    queryKey: [...crewKeys.taskCenter, user?.id ?? null, scope, status, query],
    enabled: Boolean(user?.id),
    refetchInterval: 60_000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ scope, status, query, limit: "30" });
      if (pageParam) params.set("cursor", pageParam);
      return crewApi.get<TaskPage>(`/crew-task-center?${params}`, { signal, cache: "no-store" });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6">
      <CrewSectionNavigation active="tasks" />
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-2">
          <Link
            className="text-sm text-muted-foreground hover:text-foreground"
            href={localizePath("/crews", locale)}
          >
            {t("back")}
          </Link>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </header>
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
          <label className="flex min-w-0 flex-col gap-2 text-sm text-muted-foreground">
            {deadlineT("warningWindow")}
            <NativeSelect
              className="data-[size=default]:h-11 sm:data-[size=default]:h-10"
              value={String(warningHours)}
              onChange={(value) => setWarningHours(Number(value))}
              aria-label={deadlineT("warningWindow")}
            >
              {[24, 48, 72].map((hours) => (
                <NativeSelectOption key={hours} value={String(hours)}>
                  {deadlineT("hours", { count: hours })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="flex min-w-0 flex-col gap-2 text-sm text-muted-foreground">
            {t("scope")}
            <NativeSelect
              className="data-[size=default]:h-11 sm:data-[size=default]:h-10"
              value={scope}
              aria-label={t("scope")}
              onChange={setScope}
            >
              <NativeSelectOption value="all">{t("allTasks")}</NativeSelectOption>
              <NativeSelectOption value="mine">{t("mine")}</NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="flex min-w-0 flex-col gap-2 text-sm text-muted-foreground">
            {t("status")}
            <NativeSelect
              className="data-[size=default]:h-11 sm:data-[size=default]:h-10"
              value={status}
              aria-label={t("status")}
              onChange={setStatus}
            >
              <NativeSelectOption value="active">{t("active")}</NativeSelectOption>
              <NativeSelectOption value="all">{t("allStatuses")}</NativeSelectOption>
            </NativeSelect>
          </label>
          <Input
            className="h-11 w-full sm:h-10"
            aria-label={t("search")}
            placeholder={t("search")}
            maxLength={180}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {authLoading ? (
          <p role="status">{t("loading")}</p>
        ) : !user ? (
          <div className="space-y-3">
            <p>{t("signInRequired")}</p>
            <Button onClick={() => openAuthDialog()}>{t("signIn")}</Button>
          </div>
        ) : feed.isPending ? (
          <p role="status">{t("loading")}</p>
        ) : feed.isError && !feed.isFetchNextPageError ? (
          <div role="alert" className="space-y-3">
            <p>{feed.error.message}</p>
            <Button onClick={() => void feed.refetch()}>{t("retry")}</Button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl bg-card/40">
            {items.map((task) => (
              <li key={task.id}>
                <Link
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 hover:bg-secondary/40"
                  href={localizePath(
                    `/crews/${task.crew.id}/workspace?tab=tasks&task=${task.id}`,
                    locale
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-muted-foreground">
                      {task.crew.name} · TASK-{task.number}
                    </span>
                    <span className="block truncate font-medium">
                      {task.title}
                      <TaskUnreadMarker taskId={task.id} />
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {task.workflowState.systemKey
                      ? taskT(`status.${task.workflowState.systemKey}`)
                      : task.workflowState.name}{" "}
                    · {taskT(`priority.${task.priority}`)}
                  </span>
                  <TaskDeadline
                    dueAt={task.dueAt}
                    status={task.status}
                    warningHours={warningHours}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {user && !authLoading && feed.isFetchNextPageError && (
          <p role="alert" className="text-sm text-destructive">
            {feed.error?.message}
          </p>
        )}
        {user &&
          !authLoading &&
          feed.hasNextPage &&
          (!feed.isError || feed.isFetchNextPageError) && (
            <Button disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
              {feed.isFetchNextPageError ? t("retry") : t("loadMore")}
            </Button>
          )}
      </div>
    </main>
  );
}
