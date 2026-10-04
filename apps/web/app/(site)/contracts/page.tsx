"use client";
import { TaskContractLink } from "../crews/_components/task-contract-link";
import { crewKeys } from "../crews/_hooks/shared";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { crewApi, isCrewCursorError } from "../crews/_hooks/api";
import { CrewAgreementsDialog } from "../crews/[id]/workspace/_components/members/crew-agreements-dialog";

type Contract = {
  id: string;
  crewId: string;
  title: string;
  status: string;
  updatedAt: string;
  crew: { name: string };
};
export default function MyContracts() {
  const { user, isLoading } = useCurrentUser();
  const t = useTranslations("myContracts");
  const auth = useAuthDialog();
  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {isLoading ? (
        <p role="status">{t("loading")}</p>
      ) : user ? (
        <ContractsSession key={user.id} userId={user.id} />
      ) : (
        <Button onClick={() => auth.open()}>{t("signIn")}</Button>
      )}
    </main>
  );
}
function ContractsSession({ userId }: { userId: string }) {
  const t = useTranslations("myContracts");
  const [section, setSection] = useState<"agreements" | "files">("agreements");
  return (
    <>
      <nav className="flex gap-2" aria-label={t("title")}>
        {(["agreements", "files"] as const).map((tab) => (
          <Button
            key={tab}
            color="muted"
            variant={section === tab ? "solid" : "ghost"}
            aria-pressed={section === tab}
            onClick={() => setSection(tab)}
          >
            {t(tab)}
          </Button>
        ))}
      </nav>
      {section === "agreements" ? (
        <AgreementsSession userId={userId} />
      ) : (
        <TaskContracts userId={userId} />
      )}
    </>
  );
}
function TaskContracts({ userId }: { userId: string }) {
  const t = useTranslations("myContracts");
  const query = useInfiniteQuery({
    queryKey: [...crewKeys.taskCenter, userId, "contract-files"],
    initialPageParam: undefined as string | undefined,
    retry: false,
    queryFn: ({ signal, pageParam }) =>
      crewApi.get<{
        items: {
          id: string;
          title: string;
          crew: { id: string; name: string };
          contractAssetNodeId: string | null;
        }[];
        nextCursor: string | null;
      }>("/crew-task-center", {
        signal,
        cache: "no-store",
        query: { scope: "all", status: "all", hasContract: "true", cursor: pageParam, limit: 30 },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("filesDescription")}</p>
      {query.isPending ? <p role="status">{t("loading")}</p> : null}
      {query.error ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button
            disabled={query.isFetching}
            onClick={() =>
              void (query.isFetchNextPageError &&
              !isCrewCursorError(query.error, "CREW_TASK_CURSOR_INVALID")
                ? query.fetchNextPage()
                : query.refetch())
            }
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {!query.isError && query.isSuccess && !items.length ? (
        <p className="py-8 text-sm text-muted-foreground">{t("filesEmpty")}</p>
      ) : null}
      {!query.isError ? (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.crew.name}</p>
              </div>
              {item.contractAssetNodeId ? (
                <TaskContractLink crewId={item.crew.id} assetId={item.contractAssetNodeId} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {query.hasNextPage && !query.isError ? (
        <Button disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
          {t("more")}
        </Button>
      ) : null}
    </section>
  );
}
function AgreementsSession({ userId }: { userId: string }) {
  const t = useTranslations("myContracts"),
    a = useTranslations("crewAgreements"),
    locale = useLocale();
  const [selected, setSelected] = useState<Contract | null>(null);
  const [view, setView] = useState<"all" | "active" | "signed" | "attention">("all");
  const query = useInfiniteQuery({
    queryKey: ["my-contracts", userId, view],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      crewApi.get<{ items: Contract[]; nextCursor: string | null }>("/me/crew-agreements", {
        signal,
        cache: "no-store",
        query: { view, cursor: pageParam, limit: 30 },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <nav className="flex flex-wrap gap-2" aria-label={t("title")}>
        {(["all", "active", "signed", "attention"] as const).map((tab) => (
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
      </nav>
      {query.isPending ? <p role="status">{t("loading")}</p> : null}
      {query.error ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button
            disabled={query.isFetching}
            onClick={() =>
              void (query.isFetchNextPageError &&
              !isCrewCursorError(query.error, "CREW_AGREEMENT_CURSOR_INVALID")
                ? query.fetchNextPage()
                : query.refetch())
            }
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {!query.isError && query.isSuccess && !items.length ? (
        <p className="py-8 text-sm text-muted-foreground">{t("empty")}</p>
      ) : null}
      {!query.isError ? (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelected(item)}
                className="flex w-full flex-wrap items-center gap-3 rounded-lg px-3 py-4 text-left hover:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.crew.name}</p>
                </div>
                <span className="text-xs">{a(`status.${item.status}`)}</span>
                <time className="text-xs text-muted-foreground">
                  {new Date(item.updatedAt).toLocaleDateString(locale)}
                </time>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {query.hasNextPage && !query.isError ? (
        <Button disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
          {t("more")}
        </Button>
      ) : null}
      {selected ? (
        <ContractDetails
          key={selected.id}
          contract={selected}
          onClose={() => {
            setSelected(null);
            void query.refetch();
          }}
        />
      ) : null}
    </>
  );
}
function ContractDetails({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  return (
    <CrewAgreementsDialog
      crewId={contract.crewId}
      members={[]}
      isOwner={false}
      focusAgreementId={contract.id}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    />
  );
}
