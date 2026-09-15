"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import type { CrewMemberDTO } from "../../_hooks/types";
import { displayNameOf, useUserDisplays } from "../../_hooks/use-users";
import { useAccountability, useAccountabilityAction } from "../../_hooks/use-accountability";

export function ProjectAccountability(props: { crewId: string; members: CrewMemberDTO[] }) {
  const { user } = useCurrentUser();
  return <ProjectSession key={`${props.crewId}:${user?.id}`} {...props} userId={user?.id} />;
}
function ProjectSession({
  crewId,
  members,
  userId,
}: {
  crewId: string;
  members: CrewMemberDTO[];
  userId?: string;
}) {
  const t = useTranslations("crewAccountability");
  const [page, setPage] = useState(1);
  const query = useAccountability(crewId, page);
  const data = query.data;
  const displays = useUserDisplays([
    ...members.map((m) => m.userId),
    ...(data?.participants.map((p) => p.userId) ?? []),
    ...(data?.reliability.map((r) => r.userId) ?? []),
    ...(data?.commitments.map((r) => r.userId) ?? []),
    ...(data?.feedback.flatMap((f) => [f.authorUserId, f.subjectUserId]) ?? []),
  ]);
  const [subject, setSubject] = useState("");
  const base = `/crews/${encodeURIComponent(crewId)}`;
  return (
    <details className="min-w-0 rounded-xl bg-white/[0.025] p-4 text-xs leading-relaxed text-zinc-300 sm:p-5">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-100 focus-visible:outline-2 focus-visible:outline-white">
        {t("projectTitle")}
      </summary>
      <div className="mt-4 min-w-0 space-y-5 [overflow-wrap:anywhere]">
        {query.isLoading && !data ? <p role="status">{t("loading")}</p> : null}
        {query.isError && (
          <div role="alert">
            <p>{query.error.message}</p>
            <Button size="sm" onClick={() => void query.refetch()}>
              {t("retry")}
            </Button>
          </div>
        )}
        {data && (
          <fieldset disabled={query.isError} className="min-w-0 space-y-5">
            <div className="space-y-2">
              <h4 className="font-semibold">{t("reliability")}</h4>
              <p className="text-zinc-400">{t("reliabilityHelp")}</p>
              {!data.reliability.length ? (
                <p>{t("noEvidence")}</p>
              ) : (
                <div className="max-w-full overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        {[
                          "creator",
                          "onTime",
                          "completedTasks",
                          "scheduleChanges",
                          "withdrawn",
                          "declined",
                          "at_risk",
                          "overdue",
                        ].map((key) => (
                          <th className="whitespace-nowrap px-3 py-2 font-medium" key={key}>
                            {t(key)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.reliability.map((r) => (
                        <tr className="border-t border-white/[0.05]" key={r.userId}>
                          <td className="px-3 py-2">{displayNameOf(r.userId, displays)}</td>
                          <td className="px-3 py-2">
                            {r.measured >= 5
                              ? `${Math.round((r.onTime / r.measured) * 100)}%`
                              : t("insufficientHistory")}{" "}
                            <span className="text-zinc-500">
                              ({r.onTime}/{r.measured})
                            </span>
                          </td>
                          <td className="px-3 py-2">{r.completed}</td>
                          <td className="px-3 py-2">{r.scheduleChanges}</td>
                          <td className="px-3 py-2">{r.withdrawn}</td>
                          <td className="px-3 py-2">{r.declined}</td>
                          <td className="px-3 py-2">{r.atRisk}</td>
                          <td className="px-3 py-2">{r.overdue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold">{t("taskRegister")}</h4>
              {data.commitments.map((r) => (
                <div key={r.id} className="border-b border-white/[0.05] py-2">
                  <p>
                    {r.task?.number} · {r.task?.title} · {displayNameOf(r.userId, displays)} ·{" "}
                    {t(
                      r.releasedAt
                        ? "handedOver"
                        : r.status === "withdrawn" && !r.acceptedAt
                          ? "declined"
                          : r.status
                    )}
                  </p>
                  {r.promisedDueAt && (
                    <p>
                      {t("promisedDeadline")}: {new Date(r.promisedDueAt).toLocaleString()}
                    </p>
                  )}
                  {r.reason && <p className="whitespace-pre-wrap break-words">{r.reason}</p>}
                  {r.handoverNote && (
                    <p>
                      {t("handover")}: {r.handoverNote}
                    </p>
                  )}
                </div>
              ))}
              {!data.commitments.length && <p className="text-zinc-400">{t("noEvidence")}</p>}
            </div>
            <div className="space-y-3">
              <h4 className="font-semibold">{t("projectWithdrawals")}</h4>
              <p className="text-zinc-400">{t("withdrawalHelp")}</p>
              {data.participants
                .filter((p) => p.withdrawalAt)
                .map((p) => (
                  <div key={p.id} className="space-y-2 border-b border-white/[0.05] py-2">
                    <p>
                      {displayNameOf(p.userId, displays)} ·{" "}
                      {p.withdrawalAt && new Date(p.withdrawalAt).toLocaleString()} ·{" "}
                      {t(p.resolvedAt ? "resolved" : "handoverPending")}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{p.withdrawalReason}</p>
                    {p.resolution && <p>{p.resolution}</p>}
                    {data.canManage && !p.resolvedAt && (
                      <RecordedAction
                        key={p.id}
                        path={`${base}/withdrawals/${encodeURIComponent(p.userId)}/resolve`}
                        field="note"
                        label={t("resolveWithdrawal")}
                      />
                    )}
                  </div>
                ))}
              {!data.completed &&
                !members.find((m) => m.userId === userId)?.isOwner &&
                !data.participants.some((p) => p.userId === userId && p.withdrawalAt) && (
                  <RecordedAction
                    path={`${base}/withdrawal`}
                    field="reason"
                    label={t("withdrawProject")}
                  />
                )}
            </div>
            <div className="space-y-3">
              <h4 className="font-semibold">{t("peerFeedback")}</h4>
              <p className="text-zinc-400">{t("feedbackHelp")}</p>
              {data.feedback.map((f) => (
                <div key={f.id} className="space-y-2 border-b border-white/[0.05] py-3">
                  <p>
                    {displayNameOf(f.authorUserId, displays)} →{" "}
                    {displayNameOf(f.subjectUserId, displays)} · {f.rating}/5 ·{" "}
                    {new Date(f.createdAt).toLocaleDateString()}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{f.comment}</p>
                  {f.response && (
                    <p className="whitespace-pre-wrap break-words">
                      {t("response")}: {f.response}
                    </p>
                  )}
                  {userId === f.subjectUserId && !f.response && (
                    <RecordedAction
                      key={f.id}
                      path={`/crew-peer-feedback/${encodeURIComponent(f.id)}/response`}
                      field="response"
                      label={t("respond")}
                    />
                  )}
                </div>
              ))}
              {data.completed ? (
                <>
                  <label className="block">
                    {t("creator")}
                    <NativeSelect
                      className="ml-2 rounded-md bg-zinc-900 p-2"
                      aria-label={t("creator")}
                      value={subject}
                      onChange={setSubject}
                    >
                      <NativeSelectOption value="">{t("chooseCreator")}</NativeSelectOption>
                      {members
                        .filter((m) => m.userId !== userId)
                        .map((m) => (
                          <NativeSelectOption value={m.userId} key={m.userId}>
                            {displayNameOf(m.userId, displays)}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </label>
                  {!!subject && (
                    <>
                      <RecordedAction
                        key={`feedback:${subject}`}
                        path={`${base}/peer-feedback`}
                        field="comment"
                        extra={{ subjectUserId: subject }}
                        withRating
                        label={t("sendFeedback")}
                      />
                    </>
                  )}
                </>
              ) : (
                <p>{t("completionRequired")}</p>
              )}
            </div>
            {(page > 1 || data.hasMore) && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t("previous")}
                </Button>
                <span>{t("page", { page })}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!data.hasMore}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("next")}
                </Button>
              </div>
            )}
          </fieldset>
        )}
      </div>
    </details>
  );
}
function RecordedAction({
  path,
  field,
  extra,
  label,
  withRating = false,
}: {
  path: string;
  field?: string;
  extra?: Record<string, unknown>;
  label: string;
  withRating?: boolean;
}) {
  const t = useTranslations("crewAccountability");
  const action = useAccountabilityAction();
  const [text, setText] = useState("");
  const [rating, setRating] = useState("5");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy.current) return;
        busy.current = true;
        setError("");
        try {
          await action.mutateAsync({
            path,
            body: {
              ...extra,
              ...(withRating ? { rating: Number(rating) } : {}),
              ...(field ? { [field]: text.trim() } : {}),
            },
          });
          if (alive.current) {
            setText("");
            setSaved(true);
          }
        } catch (err) {
          if (alive.current) setError(err instanceof Error ? err.message : t("failed"));
        } finally {
          if (alive.current) busy.current = false;
        }
      }}
    >
      {withRating && (
        <label className="block">
          {t("rating")}
          <NativeSelect
            className="ml-2 rounded-md bg-zinc-900 p-2"
            aria-label={t("rating")}
            value={rating}
            onChange={setRating}
            disabled={action.isPending || saved}
          >
            {[5, 4, 3, 2, 1].map((n) => (
              <NativeSelectOption key={n} value={String(n)}>
                {n}/5
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      )}
      {field && (
        <Textarea
          aria-label={label}
          placeholder={t("contextRequired")}
          maxLength={2000}
          value={text}
          disabled={action.isPending || saved}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={action.isPending || saved || (!!field && text.trim().length < 3)}
      >
        {saved ? t("saved") : label}
      </Button>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
