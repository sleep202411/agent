"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { crewApi } from "../_hooks/api";
import type { CrewApplicationDTO } from "../_hooks/types";
import { CrewSectionNavigation } from "../_components/crew-section-navigation";
import { ApplicationTermsPanel } from "../_components/application-terms-panel";

export default function MyApplicationsPage() {
  const { user, isLoading } = useCurrentUser();
  const t = useTranslations("crewTerms");
  if (isLoading) return <p>{t("loading")}</p>;
  if (!user) return <p>{t("signIn")}</p>;
  return <MyApplications key={user.id} userId={user.id} />;
}
function MyApplications({ userId }: { userId: string }) {
  const t = useTranslations("crewTerms");
  const [selected, setSelected] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["my-crew-applications", userId],
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<{
        items: (CrewApplicationDTO & {
          crewName: string;
          positionType: string;
          taskId: string | null;
        })[];
        nextCursor: string | null;
      }>("/me/crew-applications", {
        query: { limit: 20, cursor: pageParam },
        signal,
        cache: "no-store",
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const application = items.find((item) => item.id === selected);
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <CrewSectionNavigation active="applications" />
      <h1 className="mb-4 text-xl font-semibold">{t("myApplications")}</h1>
      {query.isPending && <p>{t("loading")}</p>}
      {query.isError ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button onClick={() => void query.refetch()}>{t("refresh")}</Button>
        </div>
      ) : (
        <>
          {items.length === 0 && query.isSuccess && <p>{t("empty")}</p>}
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <Button
                  variant="outline"
                  aria-pressed={item.id === selected}
                  onClick={() => setSelected(item.id)}
                >
                  {item.crewName} · {item.positionType} ·{" "}
                  {t("application", { date: item.createdAt.slice(0, 10) })} · {t(item.status)}
                </Button>
              </li>
            ))}
          </ul>
          {application && (
            <ApplicationTermsPanel
              applicationId={application.id}
              applicantId={application.applicantId}
              status={application.status}
              taskLinked={Boolean(application.taskId)}
            />
          )}
        </>
      )}
      {query.hasNextPage && (
        <Button disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
          {t("more")}
        </Button>
      )}
    </main>
  );
}
