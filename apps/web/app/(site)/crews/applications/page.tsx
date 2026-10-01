"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { IconMessageCircle, IconArrowLeft } from "@tabler/icons-react";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { crewApi } from "../_hooks/api";
import type { CrewApplicationDTO } from "../_hooks/types";
import { displayNameOf, useUserDisplays } from "../_hooks/use-users";
import { CrewSectionNavigation } from "../_components/crew-section-navigation";
import { PositionInvitationsPanel } from "../_components/position-invitations-panel";
import { ApplicationInterviewPanel } from "../_components/application-interview-panel";
import { ApplicationAmendmentsPanel } from "../_components/application-amendments-panel";
import { ApplicationTermsPanel } from "../_components/application-terms-panel";
import { ApplicationReviewDialog } from "../_components/application-review-dialog";

type Application = CrewApplicationDTO & {
  crewName: string;
  positionType: string;
  taskId: string | null;
  ownerUserId?: string | null;
  taskTitle?: string | null;
  dueAt?: string | null;
};
export default function MyApplicationsPage() {
  const { user, isLoading } = useCurrentUser();
  const t = useTranslations("crewTerms");
  const authT = useTranslations("crewTaskCenter");
  const { open: openAuthDialog } = useAuthDialog();
  if (isLoading || !user)
    return (
      <main className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6">
        <CrewSectionNavigation active="applications" />
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
  return <MyApplications key={user.id} userId={user.id} />;
}
function MyApplications({ userId }: { userId: string }) {
  const t = useTranslations("crewTerms");
  const c = useTranslations("crewCommunications");
  const locale = useLocale();
  const [scope, setScope] = useState<"sent" | "received">("sent");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const query = useInfiniteQuery({
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
  // The selected conversation must obey the same access/error state as the inbox.
  const items = query.isError ? [] : (query.data?.pages.flatMap((page) => page.items) ?? []);
  const peerId = (item: Application) =>
    scope === "received" ? item.applicantId : item.ownerUserId;
  const displays = useUserDisplays(items.flatMap((item) => (peerId(item) ? [peerId(item)!] : [])));
  const peerName = (item: Application) =>
    peerId(item) ? displayNameOf(peerId(item)!, displays) : item.crewName;
  const filtered = items.filter((item) =>
    `${peerName(item)} ${item.crewName} ${item.taskTitle ?? item.positionType}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase())
  );
  const application = items.find((item) => item.id === selected);
  const reviewer = scope === "received" && application?.applicantId !== userId;
  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6">
      <CrewSectionNavigation active="applications" />
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{c("title")}</h1>
        <Link
          href={`/${locale}/messages`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <IconMessageCircle className="size-4" />
          {c("allMessages")}
        </Link>
      </header>
      <details className="mb-4 rounded-lg bg-white/[0.025] p-3">
        <summary className="cursor-pointer text-sm">{c("invitations")}</summary>
        <PositionInvitationsPanel />
      </details>
      <div className="grid min-h-[600px] grid-cols-1 overflow-hidden rounded-xl border border-white/10 bg-[#101012] lg:h-[calc(100dvh-320px)] lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside
          className={cn(
            "flex min-h-0 flex-col border-r border-white/10",
            application && "hidden lg:flex"
          )}
        >
          <div className="space-y-3 border-b border-white/10 p-4">
            <div className="flex gap-2" aria-label={c("direction")}>
              {(["sent", "received"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={scope === value}
                  className={cn(
                    "rounded-full px-3 py-2 text-xs",
                    scope === value ? "bg-white/10 text-white" : "text-muted-foreground"
                  )}
                  onClick={() => {
                    setScope(value);
                    setSelected(null);
                    setReviewing(false);
                  }}
                >
                  {c(value)}
                </button>
              ))}
            </div>
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={c("search")}
              placeholder={c("search")}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {query.isPending && <p className="p-3">{t("loading")}</p>}
            {query.isError ? (
              <div role="alert" className="p-3">
                <p>{query.error.message}</p>
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
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {item.taskTitle ?? item.positionType} · {item.crewName}
                          </span>
                          <span className="mt-2 block text-xs text-muted-foreground">
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
            "min-h-0 min-w-0 overflow-y-auto",
            !application && "hidden lg:flex lg:items-center lg:justify-center"
          )}
        >
          {application ? (
            <div key={application.id}>
              <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#101012] p-4">
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
                {reviewer && (
                  <Button size="sm" onClick={() => setReviewing(true)}>
                    {c("review")}
                  </Button>
                )}
              </header>
              <div className="m-4 rounded-xl border border-primary/25 bg-white/[0.025] p-2">
                <div className="px-4 py-3">
                  <p className="mb-1 text-xs text-muted-foreground">{c("offer")}</p>
                  <h3 className="font-semibold">
                    {application.taskTitle ?? application.positionType}
                  </h3>
                  {application.dueAt ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {c("deadline")}: {new Date(application.dueAt).toLocaleDateString(locale)}
                    </p>
                  ) : null}
                </div>
                <ApplicationTermsPanel
                  applicationId={application.id}
                  applicantId={application.applicantId}
                  status={application.status}
                  taskLinked={Boolean(application.taskId)}
                  reviewer={reviewer}
                />
              </div>
              <ApplicationInterviewPanel
                applicationId={application.id}
                applicantId={application.applicantId}
                reviewer={reviewer}
                conversation
              />
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
                  className="m-4 inline-block rounded-full bg-primary px-4 py-2 text-sm text-white"
                  href={`/${locale}/crews/${encodeURIComponent(application.crewId)}/workspace?tab=tasks&task=${encodeURIComponent(application.taskId)}`}
                >
                  {c("openTask")}
                </Link>
              ) : null}
              {reviewer && reviewing ? (
                <ApplicationReviewDialog
                  crewId={application.crewId}
                  applicationId={application.id}
                  onClose={() => {
                    setReviewing(false);
                    void query.refetch();
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
      </div>
    </main>
  );
}
