"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { parseCrewMoney, formatCrewMoneyInput } from "@/src/lib/crew-money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
type Definition = {
  category: string;
  purpose: string;
  occurredOn: string | null;
  currency: "USD" | "CNY";
  amountMinor: string | null;
  evidenceNote: string;
};
type Draft = {
  id: string;
  version: number;
  definition: Definition;
  submissionStatus: string | null;
};
const blank = (): Definition => ({
  category: "",
  purpose: "",
  occurredOn: null,
  currency: "USD",
  amountMinor: null,
  evidenceNote: "",
});
export default function ExpensePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useCurrentUser();
  return user ? <ExpenseForm key={`${user.id}:${id}`} crewId={id} userId={user.id} /> : null;
}
function ExpenseForm({ crewId, userId }: { crewId: string; userId: string }) {
  const t = useTranslations("crewExpenses");
  const [draft, setDraft] = useState<Draft>(() => ({
    id: crypto.randomUUID(),
    version: 0,
    definition: blank(),
    submissionStatus: null,
  }));
  const [amount, setAmount] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    []
  );
  const list = useInfiniteQuery({
    queryKey: ["crew-expenses", userId, crewId],
    initialPageParam: undefined as string | undefined,
    retry: false,
    queryFn: ({ signal, pageParam }) =>
      crewApi.get<{ items: Draft[]; nextCursor: string | null }>(
        `/crews/${crewId}/expense-drafts`,
        { signal, query: { after: pageParam, limit: 30 } }
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const frozen = busy || draft.submissionStatus === "pending";
  function load(value?: Draft) {
    setDraft(
      value ?? { id: crypto.randomUUID(), version: 0, definition: blank(), submissionStatus: null }
    );
    setAmount(
      value?.definition.amountMinor ? formatCrewMoneyInput(value.definition.amountMinor) : ""
    );
    setDirty(false);
    setError(null);
  }
  function edit(patch: Partial<Definition>) {
    setDraft((current) => ({ ...current, definition: { ...current.definition, ...patch } }));
    setDirty(true);
  }
  async function act(kind: "save" | "submit") {
    if (active.current || draft.submissionStatus === "pending") return;
    const amountMinor = amount.trim() ? parseCrewMoney(amount) : null;
    if (amount.trim() && (amountMinor === null || amountMinor.length > 15)) {
      setError(t("invalidAmount"));
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      if (kind === "save") {
        const saved = await crewApi.post<Draft>(`/crews/${crewId}/expense-drafts/${draft.id}`, {
          signal: controller.signal,
          body: {
            expectedVersion: draft.version,
            definition: { ...draft.definition, amountMinor },
          },
        });
        if (!controller.signal.aborted) {
          setDraft({ ...saved, submissionStatus: null });
          setDirty(false);
        }
      } else {
        await crewApi.post(`/crews/${crewId}/expense-drafts/${draft.id}/submit`, {
          signal: controller.signal,
          body: { expectedVersion: draft.version },
        });
        if (!controller.signal.aborted)
          setDraft((current) => ({ ...current, submissionStatus: "pending" }));
      }
      if (!controller.signal.aborted) await list.refetch();
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <Link href={`/crews/${encodeURIComponent(crewId)}/workspace?tab=income`}>{t("back")}</Link>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("note")}</p>
      <section className="space-y-3">
        <Button disabled={busy || dirty} onClick={() => load()}>
          {t("new")}
        </Button>
        {dirty ? (
          <div>
            <p className="text-sm">{t("unsaved")}</p>
            <Button
              disabled={busy}
              onClick={() =>
                load(
                  list.data?.pages.flatMap((page) => page.items).find((row) => row.id === draft.id)
                )
              }
            >
              {t("discard")}
            </Button>
          </div>
        ) : null}
        {list.error ? (
          <div role="alert">
            {list.error.message}
            <Button
              disabled={list.isFetching}
              onClick={() =>
                void (list.isFetchNextPageError
                  ? list.fetchNextPage({ cancelRefetch: false })
                  : list.refetch())
              }
            >
              {t("retry")}
            </Button>
          </div>
        ) : null}
        {list.isPending ? <p role="status">{t("loading")}</p> : null}
        {list.data?.pages
          .flatMap((page) => page.items)
          .map((row) => (
            <Button key={row.id} disabled={busy || dirty} onClick={() => load(row)}>
              {row.definition.category || t("draft")} ·{" "}
              {row.submissionStatus ? t(row.submissionStatus) : t("draft")}
            </Button>
          ))}
        {list.hasNextPage ? (
          <Button
            disabled={list.isFetching}
            onClick={() => void list.fetchNextPage({ cancelRefetch: false })}
          >
            {t("more")}
          </Button>
        ) : null}
      </section>
      <section className="space-y-4">
        {draft.submissionStatus ? <p role="status">{t(draft.submissionStatus)}</p> : null}
        <label className="block space-y-1">
          {t("category")}
          <Input
            aria-label={t("category")}
            disabled={frozen}
            maxLength={120}
            value={draft.definition.category}
            onChange={(e) => edit({ category: e.target.value })}
          />
        </label>
        <label className="block space-y-1">
          {t("purpose")}
          <Textarea
            aria-label={t("purpose")}
            disabled={frozen}
            maxLength={2000}
            value={draft.definition.purpose}
            onChange={(e) => edit({ purpose: e.target.value })}
          />
        </label>
        <label className="block space-y-1">
          {t("date")}
          <Input
            aria-label={t("date")}
            type="date"
            disabled={frozen}
            value={draft.definition.occurredOn ?? ""}
            onChange={(e) => edit({ occurredOn: e.target.value || null })}
          />
        </label>
        <label className="block space-y-1">
          {t("currency")}
          <NativeSelect
            aria-label={t("currency")}
            disabled={frozen}
            value={draft.definition.currency}
            onChange={(value) => edit({ currency: value as "USD" | "CNY" })}
          >
            <NativeSelectOption value="USD">USD</NativeSelectOption>
            <NativeSelectOption value="CNY">CNY</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="block space-y-1">
          {t("amount")}
          <Input
            aria-label={t("amount")}
            inputMode="decimal"
            disabled={frozen}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label className="block space-y-1">
          {t("evidence")}
          <Textarea
            aria-label={t("evidence")}
            disabled={frozen}
            maxLength={4000}
            value={draft.definition.evidenceNote}
            onChange={(e) => edit({ evidenceNote: e.target.value })}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Button disabled={frozen} onClick={() => void act("save")}>
            {t("save")}
          </Button>
          <Button
            disabled={frozen || dirty || draft.version === 0}
            onClick={() => void act("submit")}
          >
            {t("submit")}
          </Button>
        </div>
      </section>
    </main>
  );
}
