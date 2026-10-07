"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { crewApi, CrewApiError } from "../_hooks/api";
import type { CrewTaskDTO } from "../_hooks/types";

import { FeedbackAppealControl } from "./feedback-appeal-control";

type Ratings =
  | {
      direction: "creator";
      productionAbility: number;
      understanding: number;
      communication: number;
    }
  | { direction: "manager"; managementAbility: number };
type Feedback = {
  id: string;
  taskId: string;
  submissionId: string;
  authorUserId: string;
  subjectUserId: string;
  ratings: Ratings;
  comment: string;
  response: string | null;
  createdAt: string;
  respondedAt: string | null;
  publicOnProfile?: boolean;
};
type Request = { path: string; method: "post" | "put"; body: Record<string, unknown>; key: string };
type Props = { task?: CrewTaskDTO };
export function TaskFeedbackPanel({ task }: Props) {
  const { user } = useCurrentUser();
  const t = useTranslations("crewFeedback");
  if (!user) return <p>{t("signIn")}</p>;
  const submission = task?.submissions?.reduce<CrewTaskDTO["submissions"][number] | undefined>(
    (latest, item) => (!latest || item.versionNumber > latest.versionNumber ? item : latest),
    undefined
  );
  const direction =
    task?.status === "approved" &&
    submission?.reviewedAt &&
    submission.reviewedByUserId &&
    submission.reviewedByUserId !== submission.submittedByUserId
      ? user.id === submission.reviewedByUserId
        ? "creator"
        : user.id === submission.submittedByUserId
          ? "manager"
          : null
      : null;
  const subjectId =
    direction === "creator"
      ? submission?.submittedByUserId
      : direction === "manager"
        ? submission?.reviewedByUserId
        : null;
  return (
    <FeedbackSession
      key={JSON.stringify([user.id, task?.id, submission?.id])}
      taskId={task?.id}
      userId={user.id}
      direction={direction}
      subjectId={subjectId ?? null}
    />
  );
}
function FeedbackSession({
  taskId,
  userId,
  direction,
  subjectId,
}: {
  taskId?: string;
  userId: string;
  direction: "creator" | "manager" | null;
  subjectId: string | null;
}) {
  const t = useTranslations("crewFeedback"),
    locale = useLocale();
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ["crew-task-feedback", userId, taskId ?? "mine"],
    retry: false,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<{ items: Feedback[]; nextCursor: string | null }>(
        taskId ? `/crew-tasks/${encodeURIComponent(taskId)}/feedback` : "/me/crew-task-feedback",
        { signal, cache: "no-store", query: { limit: 20, cursor: pageParam } }
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [retry, setRetry] = useState<Request | null>(null);
  const [finished, setFinished] = useState<Set<string>>(() => new Set());
  const pending = useRef(false),
    alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const readable = query.isSuccess && !query.isError;
  const items = readable
    ? query.data.pages
        .flatMap((page) => page.items)
        .filter(
          (item) =>
            (item.authorUserId === userId || item.subjectUserId === userId) &&
            (!taskId || item.taskId === taskId)
        )
    : [];
  async function write(request: Request, recovery = false) {
    if (
      !alive.current ||
      !readable ||
      pending.current ||
      finished.has(request.key) ||
      (retry && !recovery)
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await crewApi[request.method](request.path, { body: request.body });
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : t("failed"));
        setRetry(
          err instanceof CrewApiError && [400, 401, 403, 404, 409, 422].includes(err.status)
            ? null
            : request
        );
        setBusy(false);
      }
      pending.current = false;
      return;
    }
    if (!alive.current) {
      pending.current = false;
      return;
    }
    setRetry(null);
    setFinished((previous) => new Set([...previous, request.key]));
    await Promise.allSettled([
      client.invalidateQueries({ queryKey: ["crew-task-feedback", userId] }),
      client.invalidateQueries({ queryKey: ["creator-profile-reviews"] }),
    ]);
    pending.current = false;
    if (alive.current) setBusy(false);
  }
  return (
    <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t("title")}>
      <h2 className="font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted-foreground">{t("privacy")}</p>
      {query.isPending && <p>{t("loading")}</p>}
      {query.isError && <p role="alert">{query.error.message}</p>}
      {error && <p role="alert">{error}</p>}
      {query.isError && (
        <Button
          variant="outline"
          disabled={busy || query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("retry")}
        </Button>
      )}
      {readable && (
        <>
          {retry && (
            <div>
              <p>{t("retryHelp")}</p>
              <Button disabled={busy} onClick={() => void write(retry, true)}>
                {t("retry")}
              </Button>
            </div>
          )}
          {finished.size > 0 && <p role="status">{t("saved")}</p>}
          {taskId &&
            direction &&
            subjectId &&
            !finished.has("submit") &&
            !items.some(
              (item) => item.authorUserId === userId && item.subjectUserId === subjectId
            ) && (
              <FeedbackForm
                direction={direction}
                subjectId={subjectId}
                disabled={busy || Boolean(retry)}
                onSubmit={(body) =>
                  void write({
                    method: "post",
                    path: `/crew-tasks/${encodeURIComponent(taskId)}/feedback`,
                    body,
                    key: "submit",
                  })
                }
              />
            )}
          {!items.length && <p>{t("empty")}</p>}
          {items.map((item) => (
            <article key={item.id} className="space-y-2 border-t border-border pt-3">
              {!taskId && <p>{t("task", { id: item.taskId })}</p>}
              <p>{t("participants", { author: item.authorUserId, subject: item.subjectUserId })}</p>
              <p>{new Date(item.createdAt).toLocaleString(locale)}</p>
              <p className="text-xs text-muted-foreground">
                {t(item.publicOnProfile ? "publicReview" : "privateReview")}
              </p>
              {ratingValues(item.ratings).map(([key, value]) => (
                <p key={key}>
                  {t(key)}: {String(value)} / 5
                </p>
              ))}
              {item.comment && <p className="whitespace-pre-wrap">{item.comment}</p>}
              {item.response !== null ? (
                <div>
                  <p>{t("response")}</p>
                  <p className="whitespace-pre-wrap">{item.response}</p>
                  {item.respondedAt && <p>{new Date(item.respondedAt).toLocaleString(locale)}</p>}
                </div>
              ) : (
                item.subjectUserId === userId &&
                !finished.has(item.id) && (
                  <ResponseForm
                    disabled={busy || Boolean(retry)}
                    onSubmit={(response) =>
                      void write({
                        method: "put",
                        path: `/crew-task-feedback/${encodeURIComponent(item.id)}/response`,
                        body: { response },
                        key: item.id,
                      })
                    }
                  />
                )
              )}
              {item.subjectUserId === userId && (
                <FeedbackAppealControl
                  key={JSON.stringify([userId, item.id])}
                  feedbackId={item.id}
                  userId={userId}
                />
              )}
            </article>
          ))}
          {query.hasNextPage && (
            <Button disabled={busy || query.isFetching} onClick={() => void query.fetchNextPage()}>
              {t("more")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
function FeedbackForm({
  direction,
  subjectId,
  disabled,
  onSubmit,
}: {
  direction: "creator" | "manager";
  subjectId: string;
  disabled: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const t = useTranslations("crewFeedback");
  const [scores, setScores] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const dimensions =
    direction === "creator"
      ? ["productionAbility", "understanding", "communication"]
      : ["managementAbility"];
  const valid =
    comment.trim().length <= 2000 &&
    dimensions.every(
      (key) =>
        Number.isInteger(Number(scores[key])) &&
        Number(scores[key]) >= 1 &&
        Number(scores[key]) <= 5
    );
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <p>{t("evaluate", { subject: subjectId })}</p>
      <p className="text-sm text-muted-foreground">{t("immutable")}</p>
      <p className="text-sm text-muted-foreground">{t("publicNotice")}</p>
      {dimensions.map((key) => (
        <label key={key} className="block">
          {t(key)}
          <NativeSelect
            value={scores[key] ?? ""}
            aria-label={t(key)}
            disabled={disabled}
            onChange={(value) => setScores((previous) => ({ ...previous, [key]: value }))}
          >
            <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
            {[1, 2, 3, 4, 5].map((score) => (
              <NativeSelectOption key={score} value={String(score)}>
                {score}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      ))}
      <label className="block">
        {t("comment")}
        <Textarea maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      <Button
        disabled={!valid}
        onClick={() => {
          if (!disabled && valid)
            onSubmit({
              subjectUserId: subjectId,
              publicOnProfile: true,
              ratings: {
                direction,
                ...Object.fromEntries(dimensions.map((key) => [key, Number(scores[key])])),
              },
              comment: comment.trim(),
            });
        }}
      >
        {t("submit")}
      </Button>
    </fieldset>
  );
}
function ResponseForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (response: string) => void;
}) {
  const t = useTranslations("crewFeedback");
  const [response, setResponse] = useState("");
  const valid = response.trim().length >= 3 && response.trim().length <= 2000;
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <label className="block">
        {t("response")}
        <Textarea maxLength={2000} value={response} onChange={(e) => setResponse(e.target.value)} />
      </label>
      <p className="text-sm text-muted-foreground">{t("responseOnce")}</p>
      <Button
        disabled={!valid}
        onClick={() => {
          if (!disabled && valid) onSubmit(response.trim());
        }}
      >
        {t("respond")}
      </Button>
    </fieldset>
  );
}

function ratingValues(ratings: Ratings): [string, number][] {
  return ratings.direction === "creator"
    ? [
        ["productionAbility", ratings.productionAbility],
        ["understanding", ratings.understanding],
        ["communication", ratings.communication],
      ]
    : [["managementAbility", ratings.managementAbility]];
}
