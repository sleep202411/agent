"use client";
import { ExpenseReceiptLink } from "./expense-receipt-link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Submission = {
  id: string;
  version: number;
  crewId: string;
  claimantUserId: string;
  submittedAt: string;
  definition: {
    category: string;
    purpose: string;
    occurredOn: string;
    currency: "USD" | "CNY";
    amountMinor: string;
    evidenceNote: string;
    receiptIds?: string[];
  };
};
type Page = { items: Submission[]; nextCursor: string | null };
function amount(value: string) {
  const minor = BigInt(value);
  return `${(minor / BigInt(100)).toLocaleString("en-US")}.${(minor % BigInt(100)).toString().padStart(2, "0")}`;
}

export function ExpenseQueuePanel() {
  const [rows, setRows] = useState<Submission[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const active = useRef<AbortController | null>(null);
  const retryCursor = useRef<string | undefined>(undefined);
  const load = useCallback(async (after?: string) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    retryCursor.current = after;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/crew-expense-submissions?limit=50${after ? `&after=${encodeURIComponent(after)}` : ""}`,
        { signal: controller.signal, cache: "no-store" }
      );
      const result = await response.json();
      if (!response.ok || result.code !== 200)
        throw new Error(result.message ?? result.msg ?? `Request failed (${response.status})`);
      if (controller.signal.aborted) return;
      const page = result.data as Page;
      setRows((previous) =>
        after
          ? [
              ...previous,
              ...page.items.filter(
                (row) => !previous.some((old) => old.id === row.id && old.version === row.version)
              ),
            ]
          : page.items
      );
      setCursor(page.nextCursor);
      setLoaded(true);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void load();
    });
    return () => {
      mounted = false;
      active.current?.abort();
      active.current = null;
    };
  }, [load]);
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Expense submissions</h1>
        <Button disabled={pending} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Pending requests. Submission does not confirm reimbursement approval or payment.
      </p>
      {error && (
        <div role="alert" className="flex items-center gap-3 text-destructive">
          <span>{error}</span>
          <Button disabled={pending} onClick={() => void load(retryCursor.current)}>
            Retry
          </Button>
        </div>
      )}
      {pending && <p role="status">Loading submissions...</p>}
      {loaded && !rows.length && <p>No pending submissions.</p>}
      {!!rows.length && (
        <div className="overflow-x-auto" aria-busy={pending}>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Submitted expense revisions awaiting review</caption>
            <thead>
              <tr className="border-b">
                {["Crew / claimant", "Expense", "Amount", "Submitted", "Details"].map((label) => (
                  <th key={label} scope="col" className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.id}:${row.version}`} className="border-b align-top">
                  <td className="p-3">
                    <div className="break-all">{row.crewId}</div>
                    <div className="break-all text-muted-foreground">{row.claimantUserId}</div>
                  </td>
                  <td className="p-3">
                    <div>{row.definition.category}</div>
                    <time>{row.definition.occurredOn}</time>
                  </td>
                  <td className="whitespace-nowrap p-3">
                    {row.definition.currency} {amount(row.definition.amountMinor)}
                  </td>
                  <td className="p-3">
                    <time dateTime={row.submittedAt}>{row.submittedAt}</time>
                    <div>Pending</div>
                  </td>
                  <td className="p-3">
                    <details>
                      <summary className="cursor-pointer">View revision {row.version}</summary>
                      <dl className="mt-2 space-y-1">
                        <dt>Submission</dt>
                        <dd className="break-all">{row.id}</dd>
                        <dt>Purpose</dt>
                        <dd className="whitespace-pre-wrap break-words">
                          {row.definition.purpose}
                        </dd>
                        <dt>Evidence notes</dt>
                        <dd className="whitespace-pre-wrap break-words">
                          {row.definition.evidenceNote || "No notes supplied."}
                        </dd>
                      </dl>
                      {(row.definition.receiptIds ?? []).map((id, index) => (
                        <ExpenseReceiptLink
                          key={`${row.id}:${row.version}:${id}`}
                          draftId={row.id}
                          version={row.version}
                          id={id}
                          index={index + 1}
                        />
                      ))}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <Button disabled={pending} onClick={() => void load(cursor)}>
          Load more
        </Button>
      )}
    </section>
  );
}
