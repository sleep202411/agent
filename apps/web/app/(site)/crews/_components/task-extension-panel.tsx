"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { crewApi, CrewApiError } from "../_hooks/api";
import { crewKeys, crewAccountQueries } from "../_hooks/shared";
import type { CrewTaskDTO } from "../_hooks/types";

type Extension = {
  id: string;
  requesterUserId: string;
  taskVersion: number;
  previousDueAt: string;
  requestedDueAt: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  decisionReason: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
};
type Props = { task: CrewTaskDTO; canManage: boolean };
type Write = { path: string; body: Record<string, unknown> };
export function TaskExtensionPanel(props: Props) {
  const { user } = useCurrentUser();
  if (!user || (!props.canManage && !props.task.assignees.some((a) => a.userId === user.id)))
    return null;
  return (
    <ExtensionSession key={JSON.stringify([user.id, props.task.id])} {...props} userId={user.id} />
  );
}
function ExtensionSession({ task, canManage, userId }: Props & { userId: string }) {
  const t = useTranslations("crewExtensions");
  const locale = useLocale();
  const client = useQueryClient();
  const base = `/crew-tasks/${encodeURIComponent(task.id)}/extensions`;
  const query = useInfiniteQuery({
    queryKey: ["task-extensions", task.id, userId],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<{ items: Extension[]; nextBeforeId: string | null }>(base, {
        signal,
        cache: "no-store",
        query: { limit: 20, beforeId: pageParam },
      }),
    getNextPageParam: (page) => page.nextBeforeId ?? undefined,
  });
  const [reason, setReason] = useState("");
  const [due, setDue] = useState("");
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<Write | null>(null);
  const pending = useRef(false),
    alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const readable = query.isSuccess && !query.isError;
  const items = readable ? query.data.pages.flatMap((page) => page.items) : [];
  const assigned = task.assignees.some((a) => a.userId === userId);
  const unfinished = !["submitted", "approved", "cancelled"].includes(task.status);
  const stale = draftVersion !== null && draftVersion !== task.version;
  const canRequest =
    assigned &&
    unfinished &&
    Boolean(task.dueAt) &&
    !items.some((row) => row.requesterUserId === userId && row.status === "pending");
  const formatTime = (date: string) => new Date(date).toLocaleString(locale);
  function discard() {
    if (pending.current || retry) return;
    setReason("");
    setDue("");
    setDraftVersion(null);
    setError("");
  }
  async function write(request: Write, recovery = false) {
    if (!alive.current || pending.current || !readable || (retry && !recovery)) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await crewApi.post(request.path, { body: request.body });
      if (!alive.current) return;
      setRetry(null);
      setReason("");
      setDue("");
      setDraftVersion(null);
      await Promise.all([
        query.refetch(),
        ...[
          crewKeys.task(task.id),
          crewKeys.tasks(task.crewId),
          crewKeys.taskCenter,
          crewKeys.taskSummary(task.crewId),
          crewKeys.taskActivity(task.crewId),
        ].map((key) => client.invalidateQueries(crewAccountQueries(key, userId))),
      ]);
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof Error ? err.message : t("failed"));
      setRetry(
        err instanceof CrewApiError && [400, 401, 403, 404, 409, 422].includes(err.status)
          ? null
          : request
      );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function request() {
    if (!canRequest || stale || !task.dueAt) return;
    const date = new Date(due);
    if (
      !reason.trim() ||
      !Number.isFinite(date.getTime()) ||
      date.getTime() <= Date.now() ||
      date.getTime() <= new Date(task.dueAt).getTime() ||
      (task.startAt && date.getTime() < new Date(task.startAt).getTime())
    ) {
      setError(t("invalid"));
      return;
    }
    void write({
      path: base,
      body: {
        requestId: crypto.randomUUID(),
        expectedVersion: draftVersion ?? task.version,
        requestedDueAt: date.toISOString(),
        reason: reason.trim(),
      },
    });
  }
  function decision(row: Extension, action: "approve" | "reject" | "withdraw", note: string) {
    if (
      row.status !== "pending" ||
      (action === "withdraw"
        ? row.requesterUserId !== userId
        : !canManage || row.requesterUserId === userId)
    )
      return;
    if (action === "approve" && new Date(row.requestedDueAt).getTime() <= Date.now()) {
      setError(t("staleRequest"));
      return;
    }
    if (!note.trim()) {
      setError(t("reasonRequired"));
      return;
    }
    void write({
      path: `${base}/${encodeURIComponent(row.id)}/decision`,
      body: { action, reason: note.trim() },
    });
  }
  return (
    <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t("title")}>
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted-foreground">{t("help")}</p>
      {query.isPending && <p>{t("loading")}</p>}
      {query.isError && <p role="alert">{query.error.message}</p>}
      {error && <p role="alert">{error}</p>}
      <Button
        variant="outline"
        disabled={busy || query.isFetching}
        onClick={() => void query.refetch()}
      >
        {t("refresh")}
      </Button>
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
          {canRequest && (
            <fieldset disabled={busy || Boolean(retry)} className="space-y-2">
              <p>{t("current", { date: formatTime(task.dueAt!) })}</p>
              <label className="block">
                {t("date", { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
                <Input
                  type="datetime-local"
                  value={due}
                  onChange={(e) => {
                    setDraftVersion((v) => v ?? task.version);
                    setDue(e.target.value);
                  }}
                />
              </label>
              <label className="block">
                {t("reason")}
                <Textarea
                  maxLength={4000}
                  value={reason}
                  onChange={(e) => {
                    setDraftVersion((v) => v ?? task.version);
                    setReason(e.target.value);
                  }}
                />
              </label>
              {stale && <p role="alert">{t("staleDraft")}</p>}
              <Button disabled={stale} onClick={request}>
                {t("request")}
              </Button>
              <Button variant="outline" onClick={discard}>
                {t("discard")}
              </Button>
            </fieldset>
          )}
          {!items.length && <p>{t("empty")}</p>}
          {items.map((row) => (
            <ExtensionRow
              key={row.id}
              row={row}
              task={task}
              canManage={canManage}
              userId={userId}
              busy={busy || Boolean(retry)}
              onDecision={decision}
            />
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
function ExtensionRow({
  row,
  task,
  canManage,
  userId,
  busy,
  onDecision,
}: {
  row: Extension;
  task: CrewTaskDTO;
  canManage: boolean;
  userId: string;
  busy: boolean;
  onDecision: (row: Extension, action: "approve" | "reject" | "withdraw", reason: string) => void;
}) {
  const t = useTranslations("crewExtensions"),
    locale = useLocale();
  const [reason, setReason] = useState("");
  const own = row.requesterUserId === userId;
  const stale =
    task.version !== row.taskVersion ||
    !task.dueAt ||
    new Date(task.dueAt).getTime() !== new Date(row.previousDueAt).getTime() ||
    !task.assignees.some((a) => a.userId === row.requesterUserId) ||
    ["submitted", "approved", "cancelled"].includes(task.status) ||
    Boolean(
      task.startAt && new Date(row.requestedDueAt).getTime() < new Date(task.startAt).getTime()
    );
  return (
    <article className="space-y-2 border-t border-border pt-3">
      <p>
        {row.requesterUserId} · {t(row.status)}
      </p>
      <p>
        {new Date(row.previousDueAt).toLocaleString(locale)} →{" "}
        {new Date(row.requestedDueAt).toLocaleString(locale)}
      </p>
      <p className="whitespace-pre-wrap">{row.reason}</p>
      {row.decisionReason && (
        <p className="whitespace-pre-wrap">
          {row.decidedByUserId} · {row.decisionReason}
        </p>
      )}
      {row.decidedAt && <p>{new Date(row.decidedAt).toLocaleString(locale)}</p>}
      {row.status === "pending" && (own || canManage) && (
        <fieldset disabled={busy} className="space-y-2">
          {stale && <p>{t("staleRequest")}</p>}
          <label className="block">
            {t("decisionReason")}
            <Textarea maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {own ? (
            <Button variant="outline" onClick={() => onDecision(row, "withdraw", reason)}>
              {t("withdraw")}
            </Button>
          ) : (
            <>
              <Button disabled={stale} onClick={() => onDecision(row, "approve", reason)}>
                {t("approve")}
              </Button>
              <Button variant="outline" onClick={() => onDecision(row, "reject", reason)}>
                {t("reject")}
              </Button>
            </>
          )}
        </fieldset>
      )}
    </article>
  );
}
