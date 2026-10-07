"use client";

import { RecruitmentCreatorSummary } from "./recruitment-creator-summary";
import { useState } from "react";
import Link from "next/link";
import { useTranslatePositionValue } from "../../crews/_hooks/use-position-label";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { IconMessageCircle, IconArrowLeft } from "@tabler/icons-react";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { crewApi } from "../../crews/_hooks/api";
import type { CrewApplicationDTO } from "../../crews/_hooks/types";
import { displayNameOf, useUserDisplays } from "../../crews/_hooks/use-users";
import { PositionInvitationsPanel } from "../../crews/_components/position-invitations-panel";
import { ApplicationInterviewPanel } from "../../crews/_components/application-interview-panel";
import { ApplicationAmendmentsPanel } from "../../crews/_components/application-amendments-panel";
import { ApplicationTermsPanel } from "../../crews/_components/application-terms-panel";
import { ApplicationReviewDialog } from "../../crews/_components/application-review-dialog";

type Application = CrewApplicationDTO & {
  crewName: string;
  positionType: string;
  taskId: string | null;
  ownerUserId?: string | null;
  taskTitle?: string | null;
  dueAt?: string | null;
};
export function RecruitmentInbox() {
  const requestedApplication = useSearchParams().get("application");
  const { user, isLoading } = useCurrentUser();
  const t = useTranslations("crewTerms");
  const authT = useTranslations("crewTaskCenter");
  const { open: openAuthDialog } = useAuthDialog();
  if (isLoading || !user)
    return (
      <main className="flex h-full min-h-0 flex-col overflow-hidden px-4 py-2">
        {isLoading ? (
          <p role="status">{t("loading")}</p>
        ) : (
          <div className="space-y-3">
            <p>{t("signIn")}</p>
            <Button onClick={() => openAuthDialog()}>{authT("signIn")}</Button>
          </div>
        )}
      </main>
    );
  return (
    <MyApplications
      key={`${user.id}:${requestedApplication ?? ""}`}
      userId={user.id}
      requestedApplication={requestedApplication}
    />
  );
}
function MyApplications({
  userId,
  requestedApplication,
}: {
  userId: string;
  requestedApplication: string | null;
}) {
  const t = useTranslations("crewTerms");
  const c = useTranslations("crewCommunications");
  const positionLabel = useTranslatePositionValue();
  const locale = useLocale();
  const [selected, setSelected] = useState<string | null>(requestedApplication);
  const [search, setSearch] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const sent = useRecruitmentApplications(userId, "sent");
  const received = useRecruitmentApplications(userId, "received");
  const query = {
    isError: sent.isError || received.isError,
    error: sent.error ?? received.error,
    isPending: sent.isPending || received.isPending,
    isSuccess: sent.isSuccess && received.isSuccess,
    isFetching: sent.isFetching || received.isFetching,
    hasNextPage: sent.hasNextPage || received.hasNextPage,
    data: { pages: [...(sent.data?.pages ?? []), ...(received.data?.pages ?? [])] },
    refetch: () => Promise.all([sent.refetch(), received.refetch()]),
    fetchNextPage: () =>
      Promise.all([
        ...(sent.hasNextPage ? [sent.fetchNextPage()] : []),
        ...(received.hasNextPage ? [received.fetchNextPage()] : []),
      ]),
  };
  // The selected conversation must obey the same access/error state as the inbox.
  const items = query.isError
    ? []
    : [
        ...new Map(
          query.data.pages.flatMap((page) => page.items).map((item) => [item.id, item])
        ).values(),
      ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const peerId = (item: Application) =>
    item.applicantId !== userId ? item.applicantId : item.ownerUserId;
  const detail = useQuery({
    queryKey: ["recruitment-thread", userId, selected],
    enabled: Boolean(selected),
    retry: false,
    refetchInterval: 15000,
    queryFn: ({ signal }) =>
      crewApi.get<Application>(`/applications/${encodeURIComponent(selected!)}`, {
        signal,
        cache: "no-store",
      }),
  });
  const application = !detail.isError ? detail.data : undefined;
  const displays = useUserDisplays(
    [...items, ...(application ? [application] : [])].flatMap((item) =>
      peerId(item) ? [peerId(item)!, item.applicantId] : [item.applicantId]
    )
  );
  const peerName = (item: Application) =>
    peerId(item) ? displayNameOf(peerId(item)!, displays) : item.crewName;
  const filtered = items.filter((item) =>
    `${peerName(item)} ${item.crewName} ${item.taskTitle ?? positionLabel(item.positionType)}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase())
  );
  const reviewer = Boolean(application && application.applicantId !== userId);
  const creatorSummary = application ? (
    <RecruitmentCreatorSummary
      key={application.applicantId}
      applicantId={application.applicantId}
      viewerId={userId}
      name={displayNameOf(application.applicantId, displays)}
      avatar={displays.get(application.applicantId)?.avatar}
    />
  ) : null;
  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden px-4 py-2">
      <div className="empty:hidden">
        <PositionInvitationsPanel hideWhenEmpty />
      </div>
      <div className="grid h-full min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border border-white/10 bg-background lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        <aside
          className={cn(
            "flex min-h-0 flex-col border-r border-white/10",
            selected && "hidden lg:flex"
          )}
        >
          <div className="space-y-2 border-b border-white/10 p-3">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={c("search")}
              placeholder={c("search")}
              aria-describedby="recruitment-search-hint"
            />
            <p id="recruitment-search-hint" className="sr-only">
              {c("searchHint")}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {query.isPending && <p className="p-3">{t("loading")}</p>}
            {query.isError ? (
              <div role="alert" className="p-3">
                <p>{query.error?.message}</p>
                <Button onClick={() => void query.refetch()}>{t("refresh")}</Button>
              </div>
            ) : (
              <>
                {filtered.length === 0 && query.isSuccess && (
                  <p className="p-3 text-sm text-muted-foreground">{t("empty")}</p>
                )}
                <ul className="space-y-1">
                  {filtered.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-pressed={item.id === selected}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-lg p-3 text-left",
                          item.id === selected ? "bg-white/10" : "hover:bg-white/5"
                        )}
                        onClick={() => {
                          setSelected(item.id);
                          setReviewing(false);
                        }}
                      >
                        <UserAvatar
                          name={peerName(item)}
                          src={displays.get(peerId(item) ?? "")?.avatar}
                          seed={peerId(item) ?? item.crewId}
                          size={36}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {peerName(item)}
                          </span>
                          <span
                            className={cn(
                              "mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                              item.applicantId === userId
                                ? "bg-sky-400/10 text-sky-300"
                                : "bg-amber-400/10 text-amber-300"
                            )}
                          >
                            {c(item.applicantId === userId ? "myApplicationBadge" : "myTaskBadge")}
                          </span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {item.taskTitle ?? positionLabel(item.positionType)} · {item.crewName}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {t(item.status)} · {new Date(item.createdAt).toLocaleDateString(locale)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {query.hasNextPage && !query.isError && (
              <Button disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
                {t("more")}
              </Button>
            )}
          </div>
        </aside>
        <section
          className={cn(
            "min-h-0 min-w-0 overflow-hidden",
            !selected && "hidden lg:flex lg:items-center lg:justify-center"
          )}
        >
          {selected && !application ? (
            <div className="space-y-4 p-4">
              <Button
                variant="ghost"
                size="sm"
                className="lg:hidden"
                onClick={() => setSelected(null)}
              >
                <IconArrowLeft className="size-4" />
                {c("back")}
              </Button>
              {detail.isError ? (
                <div role="alert" className="space-y-3 text-sm">
                  <p>{detail.error.message}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={detail.isFetching}
                    onClick={() => void detail.refetch()}
                  >
                    {t("refresh")}
                  </Button>
                </div>
              ) : (
                <p role="status" className="text-sm text-muted-foreground">
                  {t("loading")}
                </p>
              )}
            </div>
          ) : application ? (
            <div key={application.id} className="flex h-full min-h-0 flex-col">
              <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-background px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label={c("back")}
                    className="lg:hidden"
                    onClick={() => setSelected(null)}
                  >
                    <IconArrowLeft className="size-5" />
                  </button>
                  <UserAvatar
                    name={peerName(application)}
                    src={displays.get(peerId(application) ?? "")?.avatar}
                    seed={peerId(application) ?? application.crewId}
                    size={36}
                  />
                  <div>
                    <h2 className="text-sm font-semibold">{peerName(application)}</h2>
                    <p className="text-xs text-muted-foreground">
                      {application.crewName} · {t(application.status)}
                    </p>
                  </div>
                </div>
                {reviewer && application.status === "pending" && (
                  <Button size="sm" onClick={() => setReviewing(true)}>
                    {c("review")}
                  </Button>
                )}
              </header>
              <details className="shrink-0 border-b border-border p-4 xl:hidden">
                <summary className="cursor-pointer text-sm">{c("details")}</summary>
                <div className="max-h-[45vh] overflow-y-auto pt-4">
                  {creatorSummary}
                  {application.message && (
                    <p className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">
                      {application.message}
                    </p>
                  )}
                  {application.status === "approved" ? (
                    <ApplicationAmendmentsPanel
                      applicationId={application.id}
                      applicantId={application.applicantId}
                      crewId={application.crewId}
                      taskId={application.taskId}
                      status={application.status}
                    />
                  ) : null}
                  {application.taskId && application.status === "approved" ? (
                    <Link
                      className="mt-3 inline-block rounded-full bg-primary px-4 py-2 text-sm text-white"
                      href={`/${locale}/crews/${encodeURIComponent(application.crewId)}/workspace?tab=tasks&task=${encodeURIComponent(application.taskId)}`}
                    >
                      {c("openTask")}
                    </Link>
                  ) : null}
                </div>
              </details>
              <ApplicationInterviewPanel
                applicationId={application.id}
                applicantId={application.applicantId}
                reviewer={reviewer}
                conversation
                offer={
                  <ApplicationTermsPanel
                    acceptOffer
                    applicationId={application.id}
                    applicantId={application.applicantId}
                    status={application.status}
                    taskLinked={Boolean(application.taskId)}
                    reviewer={reviewer}
                    taskTitle={application.taskTitle ?? positionLabel(application.positionType)}
                    dueAt={application.dueAt}
                  />
                }
              />
              {reviewer && reviewing ? (
                <ApplicationReviewDialog
                  crewId={application.crewId}
                  applicationId={application.id}
                  onClose={() => {
                    setReviewing(false);
                    void query.refetch();
                    void detail.refetch();
                  }}
                />
              ) : null}
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <IconMessageCircle className="mx-auto mb-3 size-10" />
              <p>{c("select")}</p>
            </div>
          )}
        </section>
        {application && (
          <aside
            className="min-h-0 space-y-3 overflow-y-auto border-l border-border p-4 max-xl:hidden"
            aria-label={c("details")}
          >
            {creatorSummary}
            <h2 className="border-t border-border pt-4 text-xs font-semibold">{c("details")}</h2>
            <p className="text-sm font-medium">
              {application.taskTitle ?? positionLabel(application.positionType)}
            </p>
            <Link
              className="block rounded-md bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
              href={`/${locale}/crews/${encodeURIComponent(application.crewId)}`}
            >
              {application.crewName}
            </Link>
            {application.message && (
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                {application.message}
              </p>
            )}
            {application.status === "approved" ? (
              <ApplicationAmendmentsPanel
                applicationId={application.id}
                applicantId={application.applicantId}
                crewId={application.crewId}
                taskId={application.taskId}
                status={application.status}
              />
            ) : null}
            {application.taskId && application.status === "approved" ? (
              <Link
                className="mt-3 inline-block rounded-full bg-primary px-4 py-2 text-sm text-white"
                href={`/${locale}/crews/${encodeURIComponent(application.crewId)}/workspace?tab=tasks&task=${encodeURIComponent(application.taskId)}`}
              >
                {c("openTask")}
              </Link>
            ) : null}
          </aside>
        )}
      </div>
    </main>
  );
}

function useRecruitmentApplications(userId: string, scope: "sent" | "received") {
  return useInfiniteQuery({
    queryKey: ["my-crew-applications", userId, scope],
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<{ items: Application[]; nextCursor: string | null }>("/me/crew-applications", {
        query: { limit: 20, cursor: pageParam, scope },
        signal,
        cache: "no-store",
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
    refetchInterval: 15000,
  });
}
