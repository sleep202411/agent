"use client";
import { ReceiptLink } from "./receipt-link";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
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
  receiptIds?: string[];
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
  const locale = useLocale();
  const t = useTranslations("crewExpenses");
  const [draft, setDraft] = useState<Draft>(() => ({
    id: crypto.randomUUID(),
    version: 0,
    definition: blank(),
    submissionStatus: null,
  }));
  const savedDraft = useRef<Draft | undefined>(undefined);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const uploadIdentity = useRef<string | null>(null);
  const uploadedBytes = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
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
  const uploadedReceipts = useInfiniteQuery({
    queryKey: ["crew-expense-receipts", userId, crewId, draft.id],
    enabled: draft.version > 0,
    initialPageParam: undefined as string | undefined,
    retry: false,
    queryFn: ({ signal, pageParam }) =>
      crewApi.get<{ items: { id: string; name: string }[]; nextCursor: string | null }>(
        `/crews/${crewId}/expense-drafts/${draft.id}/receipts`,
        { signal, query: { after: pageParam } }
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const frozen = busy || draft.submissionStatus === "pending";
  function load(value?: Draft) {
    savedDraft.current = value;
    setReceiptFile(null);
    uploadIdentity.current = null;
    uploadedBytes.current = false;
    if (fileInput.current) fileInput.current.value = "";
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
  async function uploadReceipt() {
    if (active.current || !receiptFile || !draft.version || frozen) return;
    if (
      !["application/pdf", "image/png", "image/jpeg"].includes(receiptFile.type) ||
      receiptFile.size > 10 * 1024 * 1024 ||
      receiptFile.size === 0
    ) {
      setError(t("receiptInvalid"));
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    const id = uploadIdentity.current ?? crypto.randomUUID();
    uploadIdentity.current = id;
    const path = `/crews/${crewId}/expense-drafts/${draft.id}/receipts/${id}`;
    try {
      if (!uploadedBytes.current) {
        const upload = await crewApi.post<{ url: string; headers: Record<string, string> }>(path, {
          signal: controller.signal,
          body: {
            name: receiptFile.name,
            contentType: receiptFile.type,
            sizeBytes: receiptFile.size,
          },
        });
        if (controller.signal.aborted) return;
        const response = await fetch(upload.url, {
          method: "PUT",
          headers: upload.headers,
          body: receiptFile,
          signal: controller.signal,
          credentials: "omit",
        });
        if (!response.ok) throw Error(`Receipt upload failed (${response.status})`);
        uploadedBytes.current = true;
      }
      await crewApi.post(`${path}/confirm`, { signal: controller.signal, body: {} });
      if (controller.signal.aborted) return;
      setDraft((current) => ({
        ...current,
        definition: {
          ...current.definition,
          receiptIds: [...new Set([...(current.definition.receiptIds ?? []), id])],
        },
      }));
      setDirty(true);
      void uploadedReceipts.refetch();
      setReceiptFile(null);
      uploadIdentity.current = null;
      uploadedBytes.current = false;
      if (fileInput.current) fileInput.current.value = "";
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
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
          savedDraft.current = { ...saved, submissionStatus: null };
          setDraft(savedDraft.current);
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
      <Link href={`/${locale}/crews/${encodeURIComponent(crewId)}/workspace?tab=income`}>
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("note")}</p>
      <section className="space-y-3">
        <Button disabled={busy || dirty} onClick={() => load()}>
          {t("new")}
        </Button>
        {dirty ? (
          <div>
            <p className="text-sm">{t("unsaved")}</p>
            <Button disabled={busy} onClick={() => load(savedDraft.current)}>
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
        <section aria-label={t("receipts")} className="space-y-2">
          <h2>{t("receipts")}</h2>
          <p className="text-sm text-muted-foreground">{t("receiptHelp")}</p>
          <Input
            ref={fileInput}
            aria-label={t("receiptFile")}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            disabled={
              frozen || draft.version === 0 || (draft.definition.receiptIds?.length ?? 0) >= 10
            }
            onChange={(event) => {
              setReceiptFile(event.target.files?.[0] ?? null);
              uploadIdentity.current = null;
              uploadedBytes.current = false;
            }}
          />
          <Button
            disabled={frozen || !receiptFile || draft.version === 0}
            onClick={() => void uploadReceipt()}
          >
            {t("uploadReceipt")}
          </Button>
          {uploadedReceipts.error ? (
            <div role="alert">
              {uploadedReceipts.error.message}
              <Button
                disabled={uploadedReceipts.isFetching}
                onClick={() =>
                  void (uploadedReceipts.isFetchNextPageError
                    ? uploadedReceipts.fetchNextPage({ cancelRefetch: false })
                    : uploadedReceipts.refetch())
                }
              >
                {t("retry")}
              </Button>
            </div>
          ) : null}
          {uploadedReceipts.data?.pages
            .flatMap((page) => page.items)
            .filter((row) => !draft.definition.receiptIds?.includes(row.id))
            .map((row) => (
              <Button
                key={row.id}
                disabled={frozen || (draft.definition.receiptIds?.length ?? 0) >= 10}
                onClick={() =>
                  edit({ receiptIds: [...(draft.definition.receiptIds ?? []), row.id] })
                }
              >
                {t("attachReceipt")}: {row.name}
              </Button>
            ))}
          {uploadedReceipts.hasNextPage ? (
            <Button
              disabled={uploadedReceipts.isFetching}
              onClick={() => void uploadedReceipts.fetchNextPage({ cancelRefetch: false })}
            >
              {t("more")}
            </Button>
          ) : null}
          {(draft.definition.receiptIds ?? []).map((id, index) => (
            <div key={`${draft.id}:${id}`}>
              <ReceiptLink
                path={`/crews/${crewId}/expense-drafts/${draft.id}/receipts/${id}/read`}
                index={index + 1}
              />
              <Button
                disabled={frozen}
                onClick={() =>
                  edit({ receiptIds: draft.definition.receiptIds?.filter((value) => value !== id) })
                }
              >
                {t("removeReceipt")}
              </Button>
            </div>
          ))}
        </section>
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
      {draft.version > 0 ? (
        <ExpenseHistory
          key={draft.id}
          crewId={crewId}
          userId={userId}
          draftId={draft.id}
          version={draft.version}
          status={draft.submissionStatus}
        />
      ) : null}
    </main>
  );
}

function ExpenseHistory({
  crewId,
  userId,
  draftId,
  version,
  status,
}: {
  crewId: string;
  userId: string;
  draftId: string;
  version: number;
  status: string | null;
}) {
  const t = useTranslations("crewExpenses");
  const history = useInfiniteQuery({
    queryKey: ["crew-expense-history", userId, crewId, draftId, version, status],
    initialPageParam: undefined as number | undefined,
    retry: false,
    queryFn: ({ signal, pageParam }) =>
      crewApi.get<{
        items: (Draft & { createdAt: string; submittedAt: string | null })[];
        nextCursor: number | null;
      }>(`/crews/${crewId}/expense-drafts/${draftId}/history`, {
        signal,
        query: { beforeVersion: pageParam, limit: 10 },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  return (
    <section aria-label={t("history")} className="space-y-3">
      <h2 className="text-lg font-semibold">{t("history")}</h2>
      {history.isPending ? <p role="status">{t("loading")}</p> : null}
      {history.error ? (
        <div role="alert">
          {history.error.message}
          <Button
            disabled={history.isFetching}
            onClick={() =>
              void (history.isFetchNextPageError
                ? history.fetchNextPage({ cancelRefetch: false })
                : history.refetch())
            }
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {history.data?.pages
        .flatMap((page) => page.items)
        .map((row) => (
          <details key={row.version}>
            <summary className="cursor-pointer py-2">
              {t("revision")} {row.version} · {row.definition.category || t("draft")} ·{" "}
              {t(row.submissionStatus ?? "draft")}
            </summary>
            {(row.definition.receiptIds ?? []).map((id, index) => (
              <ReceiptLink
                key={id}
                path={`/crews/${crewId}/expense-drafts/${draftId}/receipts/${id}/read`}
                index={index + 1}
              />
            ))}
            <dl className="grid gap-2 text-sm">
              <div>
                <dt>{t("savedAt")}</dt>
                <dd>
                  <time dateTime={row.createdAt}>{row.createdAt}</time>
                </dd>
              </div>
              <div>
                <dt>{t("purpose")}</dt>
                <dd className="whitespace-pre-wrap break-words">{row.definition.purpose}</dd>
              </div>
              <div>
                <dt>{t("date")}</dt>
                <dd>{row.definition.occurredOn ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("amount")}</dt>
                <dd>
                  {row.definition.amountMinor === null
                    ? "—"
                    : formatCrewMoneyInput(row.definition.amountMinor)}{" "}
                  {row.definition.currency}
                </dd>
              </div>
              <div>
                <dt>{t("evidence")}</dt>
                <dd className="whitespace-pre-wrap break-words">{row.definition.evidenceNote}</dd>
              </div>
            </dl>
          </details>
        ))}
      {history.hasNextPage ? (
        <Button
          disabled={history.isFetching}
          onClick={() => void history.fetchNextPage({ cancelRefetch: false })}
        >
          {t("more")}
        </Button>
      ) : null}
    </section>
  );
}
