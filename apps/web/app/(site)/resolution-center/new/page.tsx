"use client";
import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
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
        <DisputeTaskSelection key={user.id} userId={user.id} />
      ) : (
        <Button onClick={() => auth.open()}>{t("signIn")}</Button>
      )}
    </main>
  );
}
function DisputeTaskSelection({ userId }: { userId: string }) {
  const t = useTranslations("crewCases");
  const [scope, setScope] = useState("mine");
  const [taskId, setTaskId] = useState("");
  const tasks = useInfiniteQuery({
    queryKey: ["dispute-task-options", userId, scope],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      crewApi.get<{ items: TrackingTask[]; nextCursor: string | null }>("/crew-task-center", {
        signal,
        cache: "no-store",
        query: { scope, status: "all", limit: 30, cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const detail = useCrewTask(taskId, Boolean(taskId) && !tasks.isError);
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("selectTaskHint")}</p>
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
