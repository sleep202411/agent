"use client";

import { CrewSectionNavigation } from "../_components/crew-section-navigation";

import { useDeferredValue, useState } from "react";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useInfiniteQuery } from "@tanstack/react-query";
import { crewKeys } from "../_hooks/shared";
import { crewApi, CrewApiError } from "../_hooks/api";
import { useTranslations } from "@/src/i18n/i18n";
import { CREW_TASK_KIND_MESSAGE_KEYS, type CrewTaskKind } from "../_hooks/types";
import { TaskTrackingCard, type TrackingTask } from "./task-tracking-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

interface TaskPage {
  items: TrackingTask[];
  nextCursor: string | null;
  crews: Array<{ id: string; name: string }>;
  categories: string[];
  stats: { dueSoon: number; pendingReviews: number };
}

export default function CrewTaskCenter() {
  const deadlineT = useTranslations("crewDeadline");
  const [warningHours, setWarningHours] = useState(72);
  const t = useTranslations("crewTaskCenter");
  const taskT = useTranslations("crewTasks");
  const { user, isLoading: authLoading } = useCurrentUser();
  const { open: openAuthDialog } = useAuthDialog();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scope, setScope] = useState("mine");
  const [status, setStatus] = useState("active");
  const [crewId, setCrewId] = useState("");
  const [taskKind, setTaskKind] = useState("");
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());
  const feed = useInfiniteQuery({
    queryKey: [...crewKeys.taskCenter, user?.id ?? null, scope, status, query, crewId, taskKind],
    enabled: Boolean(user?.id),
    refetchInterval: 60_000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ scope, status, query, limit: "30" });
      if (crewId) params.set("crewId", crewId);
      if (taskKind) params.set("taskKind", taskKind);
      if (pageParam) params.set("cursor", pageParam);
      return crewApi.get<TaskPage>(`/crew-task-center?${params}`, { signal, cache: "no-store" });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const accessDenied =
    feed.error instanceof CrewApiError && [401, 403, 404].includes(feed.error.status);
  const retryNextPage = feed.isFetchNextPageError && !accessDenied;
  const items = accessDenied ? [] : (feed.data?.pages.flatMap((page) => page.items) ?? []);
  const summary = user && !feed.isError ? feed.data?.pages[0] : undefined;
  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 py-4 sm:px-6">
      <CrewSectionNavigation active="tasks" />
      <div className="space-y-3 rounded-xl bg-background p-3 sm:p-4">
        <h1 className="sr-only">{t("title")}</h1>
        <div className="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:border-r lg:border-white/10 lg:pr-4">
            <div className="flex rounded-xl bg-white/5 p-1" role="group" aria-label={t("scope")}>
              {(["mine", "managed"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={scope === value}
                  className={`min-h-11 flex-1 rounded-lg px-3 text-sm lg:min-h-8 ${scope === value ? "bg-primary text-white" : "text-muted-foreground"}`}
                  onClick={() => {
                    setScope(value);
                    setCrewId("");
                    setTaskKind("");
                  }}
                >
                  {t(value === "mine" ? "creator" : "producer")}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="min-h-11 rounded-full bg-white/5 px-4 text-sm lg:hidden"
              aria-expanded={filtersOpen}
              aria-controls="tracking-filters"
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              {t("filters")}
            </button>
            <div
              id="tracking-filters"
              className={`${filtersOpen ? "block" : "hidden"} space-y-3 lg:block`}
            >
              <nav className="flex flex-wrap gap-1 lg:flex-col" aria-label={t("status")}>
                {["active", "submitted", "revision_requested", "overdue", "approved", "all"].map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={status === value}
                      className={`min-h-11 rounded-lg px-3 text-left text-xs lg:min-h-9 ${status === value ? "bg-white/10 text-white" : "text-muted-foreground hover:bg-white/5"}`}
                      onClick={() => setStatus(value)}
                    >
                      {t(`filter_${value}`)}
                    </button>
                  )
                )}
              </nav>
              <div className="space-y-3">
                <Input
                  aria-label={t("search")}
                  placeholder={t("search")}
                  maxLength={180}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <NativeSelect
                  aria-label={t("crewFilter")}
                  value={crewId}
                  onChange={(value) => {
                    setCrewId(value);
                    setTaskKind("");
                  }}
                >
                  <NativeSelectOption value="">{t("allCrews")}</NativeSelectOption>
                  {summary?.crews?.map((crew) => (
                    <NativeSelectOption key={crew.id} value={crew.id}>
                      {crew.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label={t("categoryFilter")}
                  value={taskKind}
                  onChange={setTaskKind}
                >
                  <NativeSelectOption value="">{t("allCategories")}</NativeSelectOption>
                  {summary?.categories?.map((kind) => (
                    <NativeSelectOption key={kind} value={kind}>
                      {taskT(CREW_TASK_KIND_MESSAGE_KEYS[kind as CrewTaskKind])}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <label className="flex flex-col gap-2 text-xs text-muted-foreground">
                  {deadlineT("warningWindow")}
                  <NativeSelect
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
              </div>
            </div>
            {user && !feed.isError && summary?.stats ? (
              <dl className="space-y-3 rounded-xl bg-white/5 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt>{t("dueSoon")}</dt>
                  <dd className="font-semibold text-amber-300">{summary.stats.dueSoon}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>{t("pendingReviews")}</dt>
                  <dd className="font-semibold text-foreground">{summary.stats.pendingReviews}</dd>
                </div>
              </dl>
            ) : null}
          </aside>
          <section className="min-w-0 space-y-4" aria-label={t("title")}>
            {authLoading ? (
              <p role="status">{t("loading")}</p>
            ) : !user ? (
              <div className="space-y-3">
                <p>{t("signInRequired")}</p>
                <Button onClick={() => openAuthDialog()}>{t("signIn")}</Button>
              </div>
            ) : feed.isPending ? (
              <p role="status">{t("loading")}</p>
            ) : feed.isError && !retryNextPage ? (
              <div role="alert" className="space-y-3">
                <p>{feed.error.message}</p>
                <Button onClick={() => void feed.refetch()}>{t("retry")}</Button>
              </div>
            ) : items.length === 0 ? (
              <p className="py-8 text-muted-foreground">{t("empty")}</p>
            ) : (
              <ul className="space-y-2">
                {items.map((task) => (
                  <TaskTrackingCard
                    key={`${user?.id}:${scope}:${task.id}`}
                    task={task}
                    warningHours={warningHours}
                  />
                ))}
              </ul>
            )}
            {user && !authLoading && retryNextPage && (
              <p role="alert" className="text-sm text-destructive">
                {feed.error?.message}
              </p>
            )}
            {user && !authLoading && feed.hasNextPage && (!feed.isError || retryNextPage) && (
              <Button disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
                {retryNextPage ? t("retry") : t("loadMore")}
              </Button>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
