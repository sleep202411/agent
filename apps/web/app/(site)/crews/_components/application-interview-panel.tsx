"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { crewApi, CrewApiError } from "../_hooks/api";

type Action = "schedule" | "confirm" | "complete" | "cancel" | "message";
type State = "not_started" | "proposed" | "confirmed" | "completed" | "cancelled";
interface InterviewPage {
  applicationStatus: string;
  canUpdate: boolean;
  canMessage?: boolean;
  version: number;
  state: State;
  scheduledAt: string | null;
  items: {
    id: string;
    version: number;
    actorUserId: string;
    action: Action;
    message: string;
    createdAt: string;
    scheduledAt: string | null;
  }[];
  nextBeforeVersion: number | null;
}
interface Update {
  expectedVersion: number;
  requestKey: string;
  action: Action;
  message: string;
  scheduledAt?: string;
}
interface Props {
  applicationId: string;
  applicantId: string;
  reviewer?: boolean;
  conversation?: boolean;
  offer?: ReactNode;
  onReady?: (ready: boolean) => void;
  onUpdated?: () => void;
}
export function ApplicationInterviewPanel(props: Props) {
  const { user } = useCurrentUser();
  return (
    <InterviewSession
      key={`${user?.id}:${props.applicationId}`}
      {...props}
      userId={user?.id ?? ""}
    />
  );
}
function InterviewSession({
  applicationId,
  applicantId,
  reviewer,
  conversation = false,
  offer,
  userId,
  onReady,
  onUpdated,
}: Props & { userId: string }) {
  const t = useTranslations("crewInterview");
  const c = useTranslations("crewCommunications");
  const locale = useLocale();
  const query = useInfiniteQuery({
    queryKey: ["crew-application-interview", applicationId, userId],
    enabled: Boolean(userId),
    retry: false,
    refetchInterval: conversation ? 15000 : false,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<InterviewPage>(`/applications/${encodeURIComponent(applicationId)}/interview`, {
        signal,
        cache: "no-store",
        query: { limit: 20, beforeVersion: pageParam },
      }),
    getNextPageParam: (page) => page.nextBeforeVersion ?? undefined,
  });
  const current = query.data?.pages[0];
  const [message, setMessage] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<Update | null>(null);
  const draftVersion = useRef<number | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const readable = query.isSuccess && !query.isError;
  const resolved = Boolean(
    readable && current && !["proposed", "confirmed"].includes(current.state)
  );
  useEffect(() => {
    onReady?.(resolved && !busy && !retry);
  }, [resolved, busy, retry, onReady]);
  const applicant = userId === applicantId;
  const editable =
    readable && (current?.canMessage ?? current?.canUpdate) && (applicant || reviewer);
  const formatTime = (value: string) => new Date(value).toLocaleString(locale);
  function beginDraft() {
    draftVersion.current ??= current?.version ?? null;
  }
  function discard() {
    if (pending.current || retry) return;
    setMessage("");
    setTime("");
    setError("");
    draftVersion.current = null;
  }
  async function write(action: Action, recovery?: Update) {
    if (pending.current || !readable || !current || !userId || (!recovery && (!editable || retry)))
      return;
    if (!recovery && action !== "message" && !current.canUpdate) return;
    let body = recovery;
    if (!body) {
      if (!message.trim()) {
        setError(t("messageRequired"));
        return;
      }
      const scheduled = action === "schedule" ? new Date(time) : null;
      if (
        scheduled &&
        (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now())
      ) {
        setError(t("futureRequired"));
        return;
      }
      body = {
        expectedVersion: draftVersion.current ?? current.version,
        requestKey: crypto.randomUUID(),
        action,
        message: message.trim(),
        ...(scheduled ? { scheduledAt: scheduled.toISOString() } : {}),
      };
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await crewApi.post(`/applications/${encodeURIComponent(applicationId)}/interview`, { body });
      if (!alive.current) return;
      setRetry(null);
      setMessage("");
      setTime("");
      draftVersion.current = null;
      await query.refetch();
      if (alive.current) onUpdated?.();
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof Error ? err.message : t("failed"));
      // A definitive rejection did not write; an ambiguous response must reuse the exact request.
      const rejected =
        err instanceof CrewApiError && [400, 401, 403, 404, 409, 422].includes(err.status);
      setRetry(rejected ? null : body);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className={
        conversation ? "flex min-h-0 flex-1 flex-col gap-3 px-4 py-4" : "space-y-3 px-4 py-3"
      }
      aria-label={conversation ? c("conversation") : t("title")}
    >
      {!conversation && <h3 className="text-sm font-semibold">{t("title")}</h3>}
      {query.isPending && <p>{t("loading")}</p>}
      {query.isError && <p role="alert">{query.error.message}</p>}
      {(!conversation || query.isError) && (
        <Button
          type="button"
          variant={conversation ? "ghost" : "outline"}
          className={conversation ? "self-start" : undefined}
          disabled={busy || query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("refresh")}
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      {readable && current && (
        <>
          {!conversation || current.state !== "not_started" ? (
            <p className={conversation ? "text-xs text-muted-foreground" : undefined}>
              {t(current.state)}
              {!conversation ? <> · {t("version", { version: current.version })}</> : null}
            </p>
          ) : null}
          {current.scheduledAt && <p>{formatTime(current.scheduledAt)}</p>}
          {!editable && <p>{t("readOnly")}</p>}
          {retry && (
            <div className="space-y-2">
              <p>{t("retryHelp")}</p>
              <Button type="button" disabled={busy} onClick={() => void write(retry.action, retry)}>
                {t("retry")}
              </Button>
            </div>
          )}
          {editable && (
            <fieldset
              disabled={busy || Boolean(retry)}
              className={
                conversation
                  ? "order-last shrink-0 space-y-2 border-t border-border bg-background pt-3"
                  : "space-y-3"
              }
            >
              <label className="block text-sm">
                {conversation ? c("message") : t("messageLabel")}
                <Textarea
                  placeholder={conversation ? c("messagePlaceholder") : undefined}
                  maxLength={4000}
                  value={message}
                  onChange={(event) => {
                    beginDraft();
                    setMessage(event.target.value);
                  }}
                />
              </label>
              {!conversation && <p className="text-xs text-muted-foreground">{t("sharedNote")}</p>}
              {current.canUpdate && !conversation && !applicant && reviewer && (
                <label className="block text-sm">
                  {t("timeLabel", { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
                  <Input
                    type="datetime-local"
                    value={time}
                    onChange={(event) => {
                      beginDraft();
                      setTime(event.target.value);
                    }}
                  />
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                {current.canUpdate && !conversation && !applicant && reviewer && (
                  <Button type="button" onClick={() => void write("schedule")}>
                    {t("schedule")}
                  </Button>
                )}
                {current.canUpdate && applicant && current.state === "proposed" && (
                  <Button type="button" onClick={() => void write("confirm")}>
                    {t("confirm")}
                  </Button>
                )}
                {current.canUpdate && !applicant && reviewer && current.state === "confirmed" && (
                  <Button type="button" onClick={() => void write("complete")}>
                    {t("complete")}
                  </Button>
                )}
                {current.canUpdate && ["proposed", "confirmed"].includes(current.state) && (
                  <Button type="button" variant="outline" onClick={() => void write("cancel")}>
                    {t("cancel")}
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => void write("message")}>
                  {conversation ? c("send") : t("message")}
                </Button>
                {(!conversation || message || time) && (
                  <Button type="button" variant="ghost" onClick={discard}>
                    {t("discard")}
                  </Button>
                )}
              </div>
            </fieldset>
          )}
          <div
            className={
              conversation
                ? "min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain"
                : "space-y-3"
            }
          >
            <ol className="space-y-3 text-sm">
              {query.data.pages
                .flatMap((page) => page.items)
                .sort((a, b) => (conversation ? a.version - b.version : b.version - a.version))
                .map((event) => (
                  <li
                    key={event.id}
                    className={
                      conversation
                        ? `max-w-[90%] rounded-xl border border-white/10 p-3 ${event.actorUserId === userId ? "ml-auto bg-primary/10" : "mr-auto bg-white/5"}`
                        : undefined
                    }
                  >
                    <p>
                      {!conversation || event.action !== "message" ? (
                        <>{t(event.action)} · </>
                      ) : null}
                      {t(event.actorUserId === applicantId ? "applicant" : "reviewer")} ·{" "}
                      {formatTime(event.createdAt)}
                    </p>
                    {event.scheduledAt && <p>{formatTime(event.scheduledAt)}</p>}
                    <p className="mt-2 whitespace-pre-wrap break-words">{event.message}</p>
                  </li>
                ))}
            </ol>
            {offer}
            {query.hasNextPage && (
              <Button
                type="button"
                variant="outline"
                disabled={query.isFetching}
                onClick={() => void query.fetchNextPage()}
              >
                {t("older")}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
