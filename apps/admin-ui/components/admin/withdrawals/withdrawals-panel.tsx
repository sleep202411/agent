"use client";
import { useEffect, useRef, useState } from "react";
import { adminUiApiPath, parseAdminEnvelope } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = {
  id: string;
  userId: string;
  currency: string;
  amountMinor: string;
  status: string;
  version: number;
  recipientLabel: string;
  processingAdminId: string | null;
  paymentReference: string | null;
  resolutionReason: string | null;
  createdAt: string;
  paidAt: string | null;
};
type Detail = Row & {
  earnings: { id: string; title: string; crewName: string; withdrawalAmountMinor: string }[];
  events: { id: string; action: string; actorId: string; createdAt: string }[];
};
type Overview = {
  currency: string;
  paidAmountMinor: string;
  pendingAmountMinor: string;
  paidThisMonthAmountMinor: string;
  availableAmountMinor: string;
};
type Recipient = {
  fullName: string;
  accountNumber: string;
  address: string;
  swift: string;
  branchAddress: string;
};
type Queue = { items: Row[]; total: number; pageSize: number };
async function api<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  return parseAdminEnvelope<T>(
    await fetch(adminUiApiPath(`/api/admin/creator-withdrawals${path}`), {
      method: body === undefined ? "GET" : "POST",
      signal,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}
export function withdrawalMoney(amount: string, currency: string) {
  const n = BigInt(amount);
  const sign = n < BigInt(0) ? "−" : "";
  const abs = n < BigInt(0) ? -n : n;
  return `${currency} ${sign}${(abs / BigInt(100)).toLocaleString("en-US")}.${(abs % BigInt(100)).toString().padStart(2, "0")}`;
}
const time = (value: string) => new Date(value).toLocaleString();
export function WithdrawalsPanel({
  adminId,
  canTakeOver = false,
}: {
  adminId: string;
  canTakeOver?: boolean;
}) {
  const [query, setQuery] = useState({
    status: "pending",
    currency: "USD",
    userId: "",
    page: 1,
    revision: 0,
  });
  const [search, setSearch] = useState("");
  const [data, setData] = useState<{ queue: Queue; overview: Overview[] } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ currency: query.currency, page: String(query.page) });
    if (query.status) params.set("status", query.status);
    if (query.userId) params.set("userId", query.userId);
    Promise.all([
      api<Queue>(`?${params}`, controller.signal),
      api<Overview[]>("/overview", controller.signal),
    ])
      .then(([queue, overview]) => {
        if (!controller.signal.aborted) {
          setData({ queue, overview });
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [query]);
  function reload(update: Partial<typeof query> = {}) {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
    setDetail(null);
    setRecipient(null);
    setReference("");
    setReason("");
    setError("");
    setData(null);
    setLoading(true);
    setQuery((q) => ({ ...q, ...update, revision: q.revision + 1 }));
  }
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      await work(controller.signal);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  async function decide(action: "process" | "pay" | "reject" | "takeover") {
    if (!detail) return;
    await run(async (signal) => {
      await api(`/${detail.id}/decision`, signal, {
        action,
        expectedVersion: detail.version,
        ...(action === "pay"
          ? { paymentReference: reference.trim() }
          : action === "takeover"
            ? { reason: reason.trim(), transferHistoryReviewed: true }
            : action === "reject"
              ? { reason: reason.trim() }
              : {}),
      });
      if (!signal.aborted) reload();
    });
  }
  const total = data?.overview.find((r) => r.currency === query.currency);
  const canProcess = detail?.status === "pending";
  const canPay = detail?.status === "processing" && detail.processingAdminId === adminId;
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Withdrawal management</h1>
        <p className="text-sm text-muted-foreground">
          Creator payouts for the current site. Record payments after making the bank transfer.
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Currency
          <select
            aria-label="Currency"
            className="ml-2 rounded-md border bg-background p-2"
            disabled={busy}
            value={query.currency}
            onChange={(e) => reload({ currency: e.target.value, page: 1 })}
          >
            <option>USD</option>
            <option>CNY</option>
          </select>
        </label>
        <label className="text-sm">
          Status
          <select
            aria-label="Status"
            className="ml-2 rounded-md border bg-background p-2"
            disabled={busy}
            value={query.status}
            onChange={(e) => reload({ status: e.target.value, page: 1 })}
          >
            {["", "pending", "processing", "paid", "rejected", "cancelled"].map((s) => (
              <option key={s} value={s}>
                {s || "All"}
              </option>
            ))}
          </select>
        </label>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            reload({ userId: search.trim(), page: 1 });
          }}
        >
          <Input
            aria-label="Creator ID"
            placeholder="Creator ID"
            maxLength={64}
            value={search}
            disabled={busy}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button variant="outline" disabled={busy}>
            Search
          </Button>
        </form>
        <Button variant="outline" disabled={busy} onClick={() => reload()}>
          Refresh
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading withdrawals…</p>
      ) : (
        data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(
                [
                  ["Total paid", total?.paidAmountMinor],
                  ["Awaiting payment", total?.pendingAmountMinor],
                  ["Paid this month (UTC)", total?.paidThisMonthAmountMinor],
                  ["Available, not requested", total?.availableAmountMinor],
                ] as const
              ).map(([label, value]) => (
                <section key={label} className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="mt-2 text-xl font-semibold tabular-nums">
                    {withdrawalMoney(value ?? "0", query.currency)}
                  </p>
                </section>
              ))}
            </div>
            {detail && (
              <section aria-label="Withdrawal details" className="space-y-4 rounded-lg border p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <h2 className="font-semibold">
                    {detail.recipientLabel} · {withdrawalMoney(detail.amountMinor, detail.currency)}
                  </h2>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setDetail(null);
                      setRecipient(null);
                    }}
                  >
                    Close details
                  </Button>
                </div>
                <p className="break-all text-sm">
                  Request {detail.id} · Creator {detail.userId} · {detail.status}
                </p>
                {detail.paymentReference && <p>Transfer reference: {detail.paymentReference}</p>}
                {detail.resolutionReason && <p>{detail.resolutionReason}</p>}
                <h3 className="text-sm font-semibold">Task earnings in this withdrawal</h3>
                <ul className="space-y-2 text-sm">
                  {detail.earnings.map((e, i) => (
                    <li key={`${e.id}:${i}`} className="flex justify-between gap-4">
                      <span>
                        {e.crewName} · {e.title}
                      </span>
                      <span className="whitespace-nowrap tabular-nums">
                        {withdrawalMoney(e.withdrawalAmountMinor, detail.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                {!recipient ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async (signal) => {
                        const r = await api<{ recipient: Recipient }>(
                          `/${detail.id}/recipient`,
                          signal,
                          {}
                        );
                        if (!signal.aborted) setRecipient(r.recipient);
                      }).catch(() => {})
                    }
                  >
                    View bank details
                  </Button>
                ) : (
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    {(
                      [
                        ["Account holder", recipient.fullName],
                        ["Account number", recipient.accountNumber],
                        ["Address", recipient.address],
                        ["SWIFT", recipient.swift],
                        ["Branch address", recipient.branchAddress],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="break-words whitespace-pre-wrap">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">Activity</summary>
                  <ol className="mt-2 space-y-1 text-sm">
                    {detail.events.map((e) => (
                      <li key={e.id}>
                        {time(e.createdAt)} · {e.action} · {e.actorId}
                      </li>
                    ))}
                  </ol>
                </details>
                {canProcess && (
                  <Button disabled={busy} onClick={() => void decide("process").catch(() => {})}>
                    Start processing
                  </Button>
                )}
                {canPay && (
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="max-w-sm"
                      aria-label="Transfer reference"
                      placeholder="Transfer reference"
                      maxLength={180}
                      disabled={busy}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                    />
                    <ConfirmDialog
                      title="Confirm bank payment"
                      description={
                        <>
                          {`Confirm that ${withdrawalMoney(detail.amountMinor, detail.currency)} has already been paid to ${detail.recipientLabel}. Reference: ${reference.trim()}`}
                          {error && (
                            <span role="alert" className="mt-2 block text-destructive">
                              {error}
                            </span>
                          )}
                        </>
                      }
                      confirmLabel="Confirm paid"
                      cancelLabel="Cancel"
                      trigger={<Button disabled={busy || !reference.trim()}>Mark as paid</Button>}
                      onConfirm={() => decide("pay")}
                    />
                  </div>
                )}
                {detail.status === "processing" && !canPay && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      This request is being processed by another administrator.
                    </p>
                    {canTakeOver && (
                      <div className="flex flex-wrap gap-2">
                        <Input
                          aria-label="Handover reason"
                          placeholder="Reason for handover"
                          maxLength={2000}
                          disabled={busy}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                        <ConfirmDialog
                          title="Take over this withdrawal?"
                          description={
                            <>
                              {withdrawalMoney(detail.amountMinor, detail.currency)} ·{" "}
                              {detail.recipientLabel}. Reason: {reason.trim()}. Confirm that you
                              have checked the previous operator’s transfer records. Taking over
                              does not send money or change the reserved amount. Verify whether a
                              transfer already occurred before making any payment.
                              {error && (
                                <span role="alert" className="mt-2 block text-destructive">
                                  {error}
                                </span>
                              )}
                            </>
                          }
                          confirmLabel="Reviewed transfers — take over"
                          cancelLabel="Cancel"
                          trigger={
                            <Button variant="outline" disabled={busy || !reason.trim()}>
                              Take over
                            </Button>
                          }
                          onConfirm={() => decide("takeover")}
                        />
                      </div>
                    )}
                  </div>
                )}
                {(canProcess || canPay) && (
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="max-w-sm"
                      aria-label="Rejection reason"
                      placeholder="Reason for rejection"
                      maxLength={2000}
                      disabled={busy}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <ConfirmDialog
                      title="Reject withdrawal"
                      description={
                        <>
                          The reserved earnings will become available for a new withdrawal. Confirm
                          that no bank transfer has been made.
                          {error && (
                            <span role="alert" className="mt-2 block text-destructive">
                              {error}
                            </span>
                          )}
                        </>
                      }
                      confirmLabel="Reject"
                      cancelLabel="Cancel"
                      destructive
                      trigger={
                        <Button variant="outline" disabled={busy || !reason.trim()}>
                          Reject request
                        </Button>
                      }
                      onConfirm={() => decide("reject")}
                    />
                  </div>
                )}
              </section>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  {["Request", "Creator", "Amount", "Requested", "Status", ""].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.queue.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">
                      <span className="block max-w-40 truncate" title={row.id}>
                        {row.id}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-64 whitespace-normal break-words">
                      {row.recipientLabel}
                      <div className="text-xs text-muted-foreground">{row.userId}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {withdrawalMoney(row.amountMinor, row.currency)}
                    </TableCell>
                    <TableCell>{time(row.createdAt)}</TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setDetail(null);
                          setRecipient(null);
                          setReference("");
                          setReason("");
                          void run(async (signal) => {
                            const r = await api<Detail>(`/${row.id}`, signal);
                            if (!signal.aborted) setDetail(r);
                          }).catch(() => {});
                        }}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!data.queue.items.length && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No withdrawals match these filters.
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {data.queue.total} requests · Page {query.page}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={busy || query.page === 1}
                  onClick={() => reload({ page: query.page - 1 })}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || query.page * data.queue.pageSize >= data.queue.total}
                  onClick={() => reload({ page: query.page + 1 })}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
