"use client";

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
import { isCrewTaskOverdue } from "../_lib/task-dates";
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
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ scope, status, query, limit: "30" });
      if (pageParam) params.set("cursor", pageParam);
      return crewApi.get<TaskPage>(`/crew-task-center?${params}`);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
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
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          {t("scope")}
          <NativeSelect
            className="block rounded-md bg-secondary p-2"
            value={scope}
            aria-label={t("scope")}
            onChange={setScope}
          >
            <NativeSelectOption value="all">{t("allTasks")}</NativeSelectOption>
            <NativeSelectOption value="mine">{t("mine")}</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm">
          {t("status")}
          <NativeSelect
            className="block rounded-md bg-secondary p-2"
            value={status}
            aria-label={t("status")}
            onChange={setStatus}
          >
            <NativeSelectOption value="active">{t("active")}</NativeSelectOption>
            <NativeSelectOption value="all">{t("allStatuses")}</NativeSelectOption>
          </NativeSelect>
        </label>
        <Input
          className="w-full sm:w-72"
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
                {task.dueAt && (
                  <time
                    className={
                      isCrewTaskOverdue(task)
                        ? "text-sm text-red-300"
                        : "text-sm text-muted-foreground"
                    }
                    dateTime={task.dueAt}
                  >
                    {new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(
                      new Date(task.dueAt)
                    )}
                  </time>
                )}
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
      {user && !authLoading && feed.hasNextPage && (!feed.isError || feed.isFetchNextPageError) && (
        <Button disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
          {feed.isFetchNextPageError ? t("retry") : t("loadMore")}
        </Button>
      )}
    </main>
  );
}
