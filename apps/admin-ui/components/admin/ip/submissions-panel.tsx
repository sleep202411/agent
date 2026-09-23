"use client";
import { useEffect, useState } from "react";
import { requestEnvelope, toErrorMessage } from "./shared";
import { useAdminOperation } from "../use-admin-operation";
type Entry = { workId: string; title: string; status: string; version: number };
export function IpSubmissionsPanel({ ipId }: { ipId: string }) {
  const [items, setItems] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [next, setNext] = useState<string | null>();
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { busy, begin } = useAdminOperation();
  const endpoint = `/api/admin/ip-commerce/ips/${encodeURIComponent(ipId)}/submissions`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    requestEnvelope<{ items: Entry[]; nextCursor?: string | null }>(
      endpoint + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""),
      { signal: controller.signal }
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setItems(data.items);
          setNext(data.nextCursor);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(toErrorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, cursor, refresh]);
  async function decide(entry: Entry, status: "approved" | "rejected") {
    const op = begin();
    if (!op) return;
    setError(null);
    try {
      await requestEnvelope(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        signal: op.signal,
        body: JSON.stringify({ workId: entry.workId, status, expectedVersion: entry.version }),
      });
      if (op.current()) setRefresh((x) => x + 1);
    } catch (e) {
      if (op.current()) setError(toErrorMessage(e));
    } finally {
      op.finish();
    }
  }
  return (
    <section className="space-y-2 border-t border-slate-200 pt-3">
      <h3 className="text-sm font-semibold">Community submissions / 社区投稿</h3>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((entry) => (
              <li key={entry.workId} className="flex items-center gap-2 text-sm">
                <span className="flex-1">
                  {entry.title} · {entry.status}
                </span>
                {entry.status === "pending" && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => void decide(entry, "approved")}
                      className="rounded border px-2 py-1"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void decide(entry, "rejected")}
                      className="rounded border px-2 py-1"
                    >
                      Reject
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!items.length && <p className="text-sm text-slate-500">No submissions.</p>}
        </>
      )}
      <div className="flex gap-2">
        <button
          disabled={busy || loading}
          onClick={() => {
            setCursor(undefined);
            setRefresh((x) => x + 1);
          }}
          className="text-sm underline"
        >
          Refresh
        </button>
        {next && (
          <button
            disabled={busy || loading}
            onClick={() => setCursor(next)}
            className="text-sm underline"
          >
            Next page
          </button>
        )}
      </div>
    </section>
  );
}
