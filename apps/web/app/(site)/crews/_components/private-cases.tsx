"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";

import {
  isCaseParticipant,
  usePrivateCases,
  usePrivateCaseHistory,
  type PrivateCase,
} from "../_hooks/use-private-cases";
import { CaseEvidence } from "./case-evidence";
import { useCaseAttachments } from "../_hooks/use-case-attachments";
import { usePrivateCaseWrite } from "../_hooks/use-private-case-write";

export function PrivateCasesScreen({ caseId }: { caseId?: string }) {
  const { user, isLoading } = useCurrentUser();
  const t = useTranslations("crewCases");
  const reportsT = useTranslations("contentReports");
  const locale = useLocale();
  return (
    <main className="mx-auto w-full max-w-[1800px] space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Button asChild variant="outline" color="muted">
          <Link href={`/${locale}/resolution-center/content`}>{reportsT("title")}</Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t("privacy")}</p>
      {isLoading ? (
        <p>{t("loading")}</p>
      ) : !user ? (
        <p>{t("signIn")}</p>
      ) : caseId ? (
        <CaseDetail key={JSON.stringify([user.id, caseId])} userId={user.id} caseId={caseId} />
      ) : (
        <CaseList key={user.id} userId={user.id} />
      )}
    </main>
  );
}
function CaseList({ userId }: { userId: string }) {
  const [view, setView] = useState<"initiated" | "responses">("initiated");
  const query = usePrivateCases(userId, view);
  const t = useTranslations("crewCases"),
    locale = useLocale();
  const items = query.isSuccess
    ? query.data.pages.flatMap((p) => p.items).filter((item) => isCaseParticipant(item, userId))
    : [];
  return (
    <section className="space-y-3">
      <nav
        className="flex flex-wrap items-center gap-2 border-b border-border pb-3"
        aria-label={t("title")}
      >
        {(["initiated", "responses"] as const).map((tab) => (
          <Button
            key={tab}
            variant={view === tab ? "solid" : "ghost"}
            color="muted"
            aria-pressed={view === tab}
            onClick={() => setView(tab)}
          >
            {t(tab)}
          </Button>
        ))}
        <Link
          href={`/${locale}/resolution-center/new`}
          className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm text-white"
        >
          {t("newCase")}
        </Link>
      </nav>
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
        {t("refresh")}
      </Button>
      {query.isPending && <p>{t("loading")}</p>}
      {query.isError && <p role="alert">{query.error.message}</p>}
      {query.isSuccess && !items.length && <p>{t("empty")}</p>}
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="space-y-1 py-3">
            <Link
              className="font-medium text-foreground hover:text-primary"
              href={`/${locale}/resolution-center/${encodeURIComponent(item.id)}`}
            >
              {item.title}
            </Link>
            <p>{t(`status.${item.status}`)}</p>
            <p className="text-sm text-muted-foreground">
              {new Date(item.createdAt).toLocaleString(locale)}
            </p>
          </li>
        ))}
      </ul>
      {query.isSuccess && query.hasNextPage && (
        <Button disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
          {t("moreCases")}
        </Button>
      )}
    </section>
  );
}
function CaseDetail({ userId, caseId }: { userId: string; caseId: string }) {
  const query = usePrivateCaseHistory(userId, caseId);
  const t = useTranslations("crewCases"),
    locale = useLocale();
  const [draftKey, setDraftKey] = useState(0);
  const pages = query.data?.pages ?? [];
  const readable =
    pages.length > 0 &&
    pages.every((page) => page.id === caseId && isCaseParticipant(page, userId));
  const retainedRow = readable ? pages[0] : null;
  const row = query.isSuccess ? retainedRow : null;
  const events = readable
    ? [...new Map(pages.flatMap((p) => p.events).map((e) => [e.id, e])).values()]
    : [];
  return (
    <section className="space-y-4">
      <Link
        className="text-sm text-muted-foreground hover:text-foreground"
        href={`/${locale}/resolution-center`}
      >
        {t("back")}
      </Link>
      <div>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t("refresh")}
        </Button>
      </div>
      {query.isPending && <p>{t("loading")}</p>}
      {query.isError && <p role="alert">{query.error.message}</p>}
      {query.isSuccess && !readable && <p role="alert">{t("unavailable")}</p>}
      {row && (
        <>
          <h2 className="text-lg font-semibold">{row.title}</h2>
          <p>{t(`status.${row.status}`)}</p>
          <p>{t("parties", { opener: row.openedByUserId, respondent: row.respondentUserId })}</p>
          <p>{row.ownerAdminId ? t("owner", { id: row.ownerAdminId }) : t("unassigned")}</p>
          <p className="text-sm text-muted-foreground">{t("task", { id: row.taskId })}</p>
        </>
      )}
      {retainedRow && (
        <div hidden={!query.isSuccess}>
          <CaseResponse
            key={draftKey}
            row={retainedRow}
            userId={userId}
            enabled={query.isSuccess}
            onReset={() => setDraftKey((k) => k + 1)}
          />
        </div>
      )}
      {row && (
        <>
          <h3 className="font-semibold">{t("history")}</h3>
          <ol className="space-y-4">
            {events.map((event) => (
              <li key={event.id} className="space-y-1 border-t border-border pt-3">
                <p>
                  {t(`event.${event.action}`)} · {t("version", { version: event.version })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {event.actorId} · {new Date(event.createdAt).toLocaleString(locale)}
                </p>
                <p className="whitespace-pre-wrap break-words">{event.message}</p>
                {event.submissionIds.length > 0 && (
                  <p className="break-all text-sm">
                    {t("submissionRefs", { ids: event.submissionIds.join(", ") })}
                  </p>
                )}
                {event.attachmentIds.length > 0 && (
                  <p className="text-sm">
                    {t("attachmentRefs", { count: event.attachmentIds.length })}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {query.hasNextPage && (
            <Button disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
              {t("moreHistory")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
function CaseResponse({
  row,
  userId,
  onReset,
  enabled,
}: {
  row: PrivateCase;
  userId: string;
  onReset: () => void;
  enabled: boolean;
}) {
  const t = useTranslations("crewCases");
  const client = useQueryClient();
  const [draft] = useState(() => ({
    version: row.version,
    action: row.status === "resolved" ? "appeal" : "message",
  }));
  const [message, setMessage] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const attachments = useCaseAttachments(userId, row.id, enabled);
  const shareable = attachments.isSuccess
    ? attachments.data.pages
        .flatMap((p) => p.items)
        .filter((item) => item.ready && !item.shared)
        .map((item) => item.id)
    : [];
  const validAttachments =
    attachmentIds.length <= 20 && attachmentIds.every((id) => shareable.includes(id));

  const mutation = usePrivateCaseWrite<PrivateCase>(
    async () => client.invalidateQueries({ queryKey: ["crew-cases", userId] }),
    t("failed")
  );
  const stale = row.version !== draft.version;
  const disabled = !enabled || mutation.busy || Boolean(mutation.retry) || Boolean(mutation.saved);
  if (!enabled) return null;
  return (
    <section className="space-y-2" aria-label={t("discussion")}>
      <p className="text-sm text-muted-foreground">{t("boundary")}</p>
      <CaseEvidence
        userId={userId}
        caseId={row.id}
        disabled={disabled}
        selected={attachmentIds}
        onSelect={setAttachmentIds}
        onBusy={setUploadBusy}
      />
      {attachmentIds.length > 0 && <p>{t("sharingCount", { count: attachmentIds.length })}</p>}
      {!validAttachments && !mutation.retry && (
        <div>
          <p role="alert">{t("evidenceChanged")}</p>
          <Button
            disabled={disabled || uploadBusy}
            variant="outline"
            onClick={() => setAttachmentIds([])}
          >
            {t("clearEvidence")}
          </Button>
        </div>
      )}

      {mutation.error && <p role="alert">{mutation.error}</p>}
      {mutation.saved ? (
        <>
          <p role="status">{t("saved")}</p>
          <Button
            variant="outline"
            disabled={!enabled || mutation.busy || row.version < mutation.saved.version}
            onClick={onReset}
          >
            {t("another")}
          </Button>
        </>
      ) : (
        <>
          <p>{t("version", { version: draft.version })}</p>
          {stale && <p role="status">{t("stale")}</p>}
          <label className="block">
            {draft.action === "appeal" ? t("reopenReason") : t("message")}
            <Textarea
              value={message}
              disabled={disabled}
              maxLength={4000}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          {mutation.retry ? (
            <>
              <p>{t("retryHelp")}</p>
              <Button
                disabled={mutation.busy}
                onClick={() => void mutation.send(mutation.retry!, true)}
              >
                {t("retryWrite")}
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={disabled || uploadBusy || stale || !validAttachments || !message.trim()}
                onClick={() => {
                  if (
                    !disabled &&
                    !stale &&
                    !uploadBusy &&
                    validAttachments &&
                    message.trim().length >= 1 &&
                    message.trim().length <= 4000
                  )
                    void mutation.send({
                      path: `/crew-disputes/${encodeURIComponent(row.id)}/events`,
                      body: {
                        requestKey: crypto.randomUUID(),
                        expectedVersion: draft.version,
                        action: draft.action,
                        message: message.trim(),
                        ...(attachmentIds.length ? { attachmentIds: [...attachmentIds] } : {}),
                      },
                    });
                }}
              >
                {draft.action === "appeal" ? t("reopen") : t("send")}
              </Button>
              {stale && (
                <Button variant="outline" disabled={disabled || uploadBusy} onClick={onReset}>
                  {t("discard")}
                </Button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
